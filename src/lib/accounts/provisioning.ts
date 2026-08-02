import 'server-only'
import crypto from 'node:crypto'
import { getPayload } from 'payload'
import config from '@payload-config'
import { prisma } from '@/lib/prisma'
import { recordAudit, type Actor } from '@/lib/competition/audit'

const CLAIM_TTL_DAYS = 90
const PLACEHOLDER_DOMAIN = '@claim.invalid'

async function payload() {
  return getPayload({ config: await config })
}

/** Derive a valid Payload login id from a CueVerse ID (usernames are [a-z0-9_-]{3,24}). */
export function toLoginId(cueverseId: string): string | null {
  const s = cueverseId.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 24)
  return s.length >= 3 ? s : null
}

// One-time claim code — unambiguous alphabet, shown as XXXXX-XXXXX.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
function generateCode(): string {
  const b = crypto.randomBytes(10)
  let out = ''
  for (let i = 0; i < 10; i++) out += ALPHABET[b[i] % ALPHABET.length]
  return `${out.slice(0, 5)}-${out.slice(5, 10)}`
}
const normalizeCode = (code: string) => code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
const hashCode = (code: string) => crypto.createHash('sha256').update(normalizeCode(code)).digest('hex')
const randomPassword = () => crypto.randomBytes(24).toString('base64url')

export interface GenerateResult {
  created: { playerId: string; primaryName: string; loginId: string; code: string; expiresAt: string }[]
  skipped: { playerId: string; primaryName: string; reason: string }[]
}

/**
 * Bulk-create UNCLAIMED accounts for the given Player profiles. Each account: username =
 * login id derived from the CueVerse ID, placeholder email + random password (replaced on
 * claim), linked immediately to the profile, with a single-use claim code (hash stored,
 * plaintext returned once). Deduplicates: skips profiles that already have an account or
 * whose login id is taken. Never touches an existing (claimed) account.
 */
export async function generateAccounts(actor: Actor, playerIds: string[]): Promise<GenerateResult> {
  const p = await payload()
  const created: GenerateResult['created'] = []
  const skipped: GenerateResult['skipped'] = []
  const expiresAt = new Date(Date.now() + CLAIM_TTL_DAYS * 24 * 60 * 60 * 1000)

  for (const playerId of [...new Set(playerIds)]) {
    const player = await prisma.player.findUnique({ where: { id: playerId } })
    if (!player) { skipped.push({ playerId, primaryName: playerId, reason: 'Profile not found' }); continue }
    if (player.linkedUserId) { skipped.push({ playerId, primaryName: player.primaryName, reason: 'Already has an account' }); continue }
    if (!player.cueverseId) { skipped.push({ playerId, primaryName: player.primaryName, reason: 'No CueVerse ID' }); continue }
    const loginId = toLoginId(player.cueverseId)
    if (!loginId) { skipped.push({ playerId, primaryName: player.primaryName, reason: `CueVerse ID "${player.cueverseId}" is not a valid login id` }); continue }

    const taken = await p.find({ collection: 'users', where: { username: { equals: loginId } }, limit: 1, overrideAccess: true })
    if (taken.totalDocs > 0) { skipped.push({ playerId, primaryName: player.primaryName, reason: `Login id "${loginId}" already exists` }); continue }

    const code = generateCode()
    try {
      const user = await p.create({
        collection: 'users',
        data: { username: loginId, email: `claim.${loginId}${PLACEHOLDER_DOMAIN}`, password: randomPassword(), roles: ['member'] },
        overrideAccess: true,
      })
      await prisma.$transaction(async (tx) => {
        await tx.player.update({ where: { id: playerId }, data: { linkedUserId: String(user.id), linkStatus: 'VERIFIED', linkedAt: new Date() } })
        await tx.accountClaim.create({ data: { userId: Number(user.id), playerId, status: 'UNCLAIMED', claimCodeHash: hashCode(code), claimCodeExpiresAt: expiresAt } })
      })
      created.push({ playerId, primaryName: player.primaryName, loginId, code, expiresAt: expiresAt.toISOString() })
    } catch (e) {
      skipped.push({ playerId, primaryName: player.primaryName, reason: e instanceof Error ? e.message : 'Create failed' })
    }
  }

  await recordAudit(actor, { action: 'account.bulkGenerate', entity: 'AccountClaim', newValue: { created: created.length, skipped: skipped.length } })
  return { created, skipped }
}

/** Regenerate the one-time claim code for an unclaimed account (invalidates the old one). */
export async function regenerateClaimCode(actor: Actor, userId: number): Promise<{ ok: boolean; error?: string; code?: string; expiresAt?: string }> {
  const claim = await prisma.accountClaim.findUnique({ where: { userId } })
  if (!claim) return { ok: false, error: 'Account not found.' }
  if (claim.status === 'CLAIMED') return { ok: false, error: 'This account is already claimed.' }
  const code = generateCode()
  const expiresAt = new Date(Date.now() + CLAIM_TTL_DAYS * 24 * 60 * 60 * 1000)
  await prisma.accountClaim.update({ where: { userId }, data: { claimCodeHash: hashCode(code), claimCodeExpiresAt: expiresAt } })
  await recordAudit(actor, { action: 'account.regenerateCode', entity: 'AccountClaim', entityId: userId })
  return { ok: true, code, expiresAt: expiresAt.toISOString() }
}

export async function setAccountDisabled(actor: Actor, userId: number, disabled: boolean): Promise<{ ok: boolean; error?: string }> {
  const claim = await prisma.accountClaim.findUnique({ where: { userId } })
  if (!claim) return { ok: false, error: 'Account not found.' }
  await prisma.accountClaim.update({ where: { userId }, data: { disabledAt: disabled ? new Date() : null } })
  await recordAudit(actor, { action: disabled ? 'account.disable' : 'account.restore', entity: 'AccountClaim', entityId: userId })
  return { ok: true }
}

export interface ProvisionedAccount {
  userId: number
  loginId: string
  playerName: string
  playerId: string
  status: 'UNCLAIMED' | 'CLAIMED'
  emailAdded: boolean
  disabled: boolean
  claimedAt: string | null
  createdAt: string
  codeExpiresAt: string | null
}

/** Admin list of all provisioned accounts (no secrets — codes are never returned here). */
export async function listProvisionedAccounts(): Promise<ProvisionedAccount[]> {
  const claims = await prisma.accountClaim.findMany({ orderBy: { createdAt: 'desc' } })
  if (claims.length === 0) return []
  const p = await payload()
  const users = await p.find({ collection: 'users', where: { id: { in: claims.map((c) => c.userId) } }, limit: 1000, overrideAccess: true })
  const uById = new Map(users.docs.map((u) => [Number(u.id), u]))
  const players = await prisma.player.findMany({ where: { id: { in: claims.map((c) => c.playerId) } }, select: { id: true, primaryName: true } })
  const pById = new Map(players.map((pl) => [pl.id, pl]))
  return claims.map((c) => {
    const u = uById.get(c.userId)
    const email = (u?.email as string | undefined) ?? ''
    return {
      userId: c.userId,
      loginId: (u?.username as string | undefined) ?? String(c.userId),
      playerName: pById.get(c.playerId)?.primaryName ?? c.playerId,
      playerId: c.playerId,
      status: c.status,
      emailAdded: !!email && !email.endsWith(PLACEHOLDER_DOMAIN),
      disabled: c.disabledAt != null,
      claimedAt: c.claimedAt ? c.claimedAt.toISOString() : null,
      createdAt: c.createdAt.toISOString(),
      codeExpiresAt: c.claimCodeExpiresAt ? c.claimCodeExpiresAt.toISOString() : null,
    }
  })
}

/** The profile a login id would claim (for the /claim-account confirmation step). */
export async function getClaimTarget(loginId: string): Promise<{ ok: boolean; playerName?: string; error?: string }> {
  const p = await payload()
  const users = await p.find({ collection: 'users', where: { username: { equals: loginId.trim().toLowerCase() } }, limit: 1, overrideAccess: true })
  const user = users.docs[0]
  if (!user) return { ok: false, error: 'No account with that login id.' }
  const claim = await prisma.accountClaim.findUnique({ where: { userId: Number(user.id) } })
  if (!claim) return { ok: false, error: 'That account is not a pre-created account.' }
  const player = await prisma.player.findUnique({ where: { id: claim.playerId }, select: { primaryName: true } })
  return { ok: true, playerName: player?.primaryName }
}

/**
 * Claim an unclaimed account: verify the one-time code, set the real password + recovery
 * email, mark CLAIMED, invalidate the code, and return a session token to sign in.
 */
export async function claimAccount(
  loginId: string,
  code: string,
  password: string,
  email: string,
): Promise<{ ok: boolean; error?: string; token?: string; exp?: number }> {
  const p = await payload()
  const uname = loginId.trim().toLowerCase()
  const users = await p.find({ collection: 'users', where: { username: { equals: uname } }, limit: 1, overrideAccess: true })
  const user = users.docs[0]
  if (!user) return { ok: false, error: 'Invalid login id or claim code.' }

  const claim = await prisma.accountClaim.findUnique({ where: { userId: Number(user.id) } })
  if (!claim) return { ok: false, error: 'Invalid login id or claim code.' }
  if (claim.disabledAt) return { ok: false, error: 'This account has been disabled. Contact an administrator.' }
  if (claim.status === 'CLAIMED' || !claim.claimCodeHash) return { ok: false, error: 'This account has already been claimed.' }
  if (claim.claimCodeExpiresAt && claim.claimCodeExpiresAt.getTime() < Date.now()) return { ok: false, error: 'This claim code has expired. Ask an administrator to regenerate it.' }
  if (hashCode(code) !== claim.claimCodeHash) return { ok: false, error: 'Invalid login id or claim code.' }

  try {
    await p.update({ collection: 'users', id: user.id, data: { password, email: email.trim().toLowerCase() }, overrideAccess: true })
  } catch (e) {
    const msg = e instanceof Error ? e.message : ''
    if (/unique|already|duplicate/i.test(msg)) return { ok: false, error: 'That email is already in use by another account.' }
    return { ok: false, error: 'Could not complete the claim. Check your details and try again.' }
  }

  await prisma.accountClaim.update({ where: { userId: Number(user.id) }, data: { status: 'CLAIMED', claimedAt: new Date(), claimCodeHash: null, claimCodeExpiresAt: null } })

  try {
    const res = await p.login({ collection: 'users', data: { username: uname, password } })
    return { ok: true, token: res.token, exp: res.exp }
  } catch {
    return { ok: true } // claimed successfully; they can sign in manually
  }
}
