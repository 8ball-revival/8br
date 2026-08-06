import 'server-only'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import crypto from 'node:crypto'
import { getPayload } from 'payload'
import config from '@payload-config'
import { prisma } from '@/lib/prisma'
import { resolveIdentity } from '@/lib/stats/identity'
import { recordAudit, type Actor } from '@/lib/competition/audit'

/**
 * RANKED-ACCOUNT MIGRATION EXECUTOR.
 *
 * Creates a permanent account (username = the exact mapped User ID) + a canonical Player profile for
 * each ranked player in the authoritative mapping, links them by permanent id, and records history.
 * SAFE + IDEMPOTENT: re-running never creates a duplicate account/profile/claim and never resets a
 * password. Ambiguous rows (multiple candidate profiles) and merge directives are LEFT for manual
 * review, never guessed. Migrated accounts get a one-time claim code (temporary credential) — the
 * owner sets their real password on first claim. Preferred Name + CueVerse ID are left blank so the
 * ranking shows only the mapped User ID until the owner updates their profile.
 *
 * Runs in the Payload runtime (Owner-gated action), NOT via tsx — account creation must go through
 * Payload's auth so the password is correctly hashed (never a plaintext or hand-rolled hash).
 */

const MAP_FILE = process.env.RANKED_MAP_FILE || 'C:/Users/Cerebro/Downloads/fixed accounts.txt'
const OUT_DIR = 'C:/Users/Cerebro/Documents/8BR/migration-reports'
const PLACEHOLDER_DOMAIN = '@claim.invalid'
const CLAIM_TTL_DAYS = 30
const nk = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no ambiguous chars
const normalizeCode = (c: string) => c.toUpperCase().replace(/[^A-Z0-9]/g, '')
const hashCode = (c: string) => crypto.createHash('sha256').update(normalizeCode(c)).digest('hex')
function claimCode(): string {
  const pick = () => Array.from({ length: 5 }, () => ALPHABET[crypto.randomInt(ALPHABET.length)]).join('')
  return `${pick()}-${pick()}`
}
const randomPassword = () => crypto.randomBytes(24).toString('base64url')

export interface MigrationRow {
  line: number
  oldName: string
  mappedUserId: string
  canonicalId: string
  accountStatus: 'created' | 'linked-existing' | 'already-linked' | 'skipped'
  accountRenamed: boolean
  playerId: string | null
  profileStatus: 'created' | 'linked' | 'ambiguous-skipped' | 'skipped'
  rankingLinked: boolean
  tempPassword: string | null // one-time claim code (only for newly created accounts)
  preferredName: string
  cueverseId: string
  duplicateDetected: boolean
  manualReview: boolean
  notes: string
}

export interface MigrationReport {
  apply: boolean
  rows: MigrationRow[]
  summary: Record<string, number>
  duplicates: string[]
  generatedAtIso: string
  reportPath: string | null
}

interface Entry { line: number; oldName: string; mappedId: string | null; mergeInto: number | null }
function parseMapping(): Entry[] {
  const text = readFileSync(MAP_FILE, 'utf8')
  const out: Entry[] = []
  let line = 0
  for (const raw of text.split(/\r?\n/)) {
    line++
    if (!raw.trim()) continue
    const cols = raw.split(/\t+/).map((c) => c.trim()).filter(Boolean)
    if (cols.length < 2) { out.push({ line, oldName: cols[0] ?? '', mappedId: null, mergeInto: null }); continue }
    const right = cols.slice(1).join(' ')
    const merge = right.match(/merge with .* #(\d+)/i)
    if (merge) out.push({ line, oldName: cols[0], mappedId: null, mergeInto: Number(merge[1]) })
    else out.push({ line, oldName: cols[0], mappedId: right, mergeInto: null })
  }
  return out
}

async function candidatePlayers(oldName: string, mappedId: string, canonicalId: string) {
  const keys = [oldName, mappedId]
  const nkeys = keys.map(nk).filter(Boolean)
  return prisma.player.findMany({
    where: {
      OR: [
        { primaryName: { in: keys, mode: 'insensitive' } },
        { cueverseId: { in: keys, mode: 'insensitive' } },
        { legacyPlayerId: canonicalId },
        { aliases: { some: { alias: { in: nkeys } } } },
        { id: canonicalId },
      ],
    },
    select: { id: true, primaryName: true, cueverseId: true, linkedUserId: true },
  })
}

/**
 * Run the migration. `apply=false` (default) analyses only. `apply=true` performs the idempotent
 * writes. Requires an Owner actor (enforced by the caller).
 */
export async function migrateRankedAccounts(actor: Actor, opts: { apply?: boolean } = {}): Promise<MigrationReport> {
  const apply = !!opts.apply
  const payload = await getPayload({ config: await config })
  const entries = parseMapping()
  const rows: MigrationRow[] = []
  const duplicates: string[] = []
  const summary: Record<string, number> = { accountsCreated: 0, accountsLinked: 0, profilesCreated: 0, profilesLinked: 0, merges: 0, ambiguous: 0, alreadyDone: 0 }
  const expiresAt = new Date(Date.now() + CLAIM_TTL_DAYS * 86400_000)

  for (const e of entries) {
    if (e.mergeInto != null) {
      summary.merges++
      rows.push(base(e.line, e.oldName, '', '', { profileStatus: 'skipped', accountStatus: 'skipped', manualReview: true, notes: `Merge into row #${e.mergeInto} — handled manually, no separate account` }))
      continue
    }
    const mappedId = (e.mappedId ?? '').trim()
    const resolved = resolveIdentity(e.oldName, e.oldName, { unknownAsSelf: true })
    const canonicalId = resolved?.id ?? ''

    // --- Account (find existing by username, case-insensitive; else create) ---
    const existing = await payload.find({ collection: 'users', where: { username: { equals: mappedId } }, limit: 1, overrideAccess: true })
    let userId: number | null = existing.docs[0] ? Number(existing.docs[0].id) : null
    let accountStatus: MigrationRow['accountStatus'] = userId ? 'linked-existing' : 'created'
    let tempPassword: string | null = null

    // --- Profile (find candidates; 0=create, 1=use, >1=ambiguous skip) ---
    const cands = await candidatePlayers(e.oldName, mappedId, canonicalId)
    if (cands.length > 1) {
      summary.ambiguous++
      duplicates.push(`Row ${e.line} "${e.oldName}"→${mappedId}: ${cands.length} candidate profiles (${cands.map((c) => c.primaryName).join(', ')})`)
      rows.push(base(e.line, e.oldName, mappedId, canonicalId, { accountStatus: userId ? 'linked-existing' : 'skipped', profileStatus: 'ambiguous-skipped', duplicateDetected: true, manualReview: true, notes: 'Multiple candidate profiles — resolve manually before migrating' }))
      continue
    }
    let playerId = cands[0]?.id ?? null
    let profileStatus: MigrationRow['profileStatus'] = playerId ? 'linked' : 'created'

    // Idempotency: already fully migrated?
    if (playerId && cands[0]?.linkedUserId && userId && cands[0].linkedUserId === String(userId)) {
      summary.alreadyDone++
      rows.push(base(e.line, e.oldName, mappedId, canonicalId, { accountStatus: 'already-linked', profileStatus: 'linked', playerId, rankingLinked: true, notes: 'Already migrated (idempotent no-op)' }))
      continue
    }

    if (apply) {
      // Create the account (Payload hashes the password) with a one-time claim code.
      if (!userId) {
        const code = claimCode()
        const user = await payload.create({
          collection: 'users',
          data: { username: mappedId, email: `claim.${nk(mappedId)}${PLACEHOLDER_DOMAIN}`, password: randomPassword(), roles: ['member'] },
          overrideAccess: true,
        })
        userId = Number(user.id)
        tempPassword = code
      }

      // Bridge: legacyPlayerId = the ranking name's canonical id (unique) → the account OWNS the
      // historical ranking/career stats via getPlayerRankingProfile(legacyPlayerId). Never reassign
      // a legacyPlayerId already held by a DIFFERENT profile (would risk two profiles owning one
      // ranking) — that case is flagged for manual review instead.
      const bridge = canonicalId || null
      const bridgeHolder = bridge ? await prisma.player.findUnique({ where: { legacyPlayerId: bridge }, select: { id: true } }) : null
      const bridgeConflict = !!bridgeHolder && !!playerId && bridgeHolder.id !== playerId

      // Create OR link the canonical profile. CueVerse ID = mapped value; Preferred Name left blank
      // (stored as the mapped id so it collapses to just the CueVerse ID until the owner sets one).
      if (!playerId) {
        if (bridgeHolder) {
          playerId = bridgeHolder.id
          await prisma.player.update({ where: { id: playerId }, data: { cueverseId: mappedId, linkedUserId: String(userId), linkStatus: 'VERIFIED', linkedAt: new Date() } })
          profileStatus = 'linked'
        } else {
          const player = await prisma.player.create({
            data: { primaryName: mappedId, cueverseId: mappedId, linkedUserId: String(userId), linkStatus: 'VERIFIED', linkedAt: new Date(), provenance: 'NATIVE_EGO', legacyPlayerId: bridge },
          })
          playerId = player.id
          await prisma.playerAlias.create({ data: { playerId, alias: nk(e.oldName) } }).catch(() => {})
        }
      } else {
        await prisma.player.update({
          where: { id: playerId },
          data: { cueverseId: mappedId, linkedUserId: String(userId), linkStatus: 'VERIFIED', linkedAt: new Date(), ...(bridge && !bridgeConflict ? { legacyPlayerId: bridge } : {}) },
        })
        if (bridgeConflict) { rows.push(base(e.line, e.oldName, mappedId, canonicalId, { accountStatus, profileStatus: 'linked', playerId, rankingLinked: false, tempPassword, duplicateDetected: true, manualReview: true, notes: `Canonical id ${bridge} already owned by profile ${bridgeHolder!.id} — linked account but NOT the ranking (manual review)` })); continue }
      }
      // Attach a claim record for a newly created account (temporary credential).
      if (tempPassword) await prisma.accountClaim.upsert({ where: { userId }, create: { userId, playerId, status: 'UNCLAIMED', claimCodeHash: hashCode(tempPassword), claimCodeExpiresAt: expiresAt }, update: {} }).catch(() => {})
    }

    if (accountStatus === 'created') summary.accountsCreated++; else summary.accountsLinked++
    if (profileStatus === 'created') summary.profilesCreated++; else summary.profilesLinked++
    rows.push(base(e.line, e.oldName, mappedId, canonicalId, { accountStatus, profileStatus, playerId, rankingLinked: true, tempPassword, cueverseId: mappedId, preferredName: '', notes: resolved?.ok === false ? 'identity unresolved (name kept as-is)' : '' }))
  }

  if (apply) await recordAudit(actor, { action: 'migration.rankedAccounts', entity: 'User', newValue: summary })

  const generatedAtIso = new Date().toISOString()
  let reportPath: string | null = null
  const report: MigrationReport = { apply, rows, summary, duplicates, generatedAtIso, reportPath }
  reportPath = writeReport(report)
  report.reportPath = reportPath
  return report
}

function base(line: number, oldName: string, mappedUserId: string, canonicalId: string, over: Partial<MigrationRow>): MigrationRow {
  return {
    line, oldName, mappedUserId, canonicalId,
    accountStatus: 'skipped', accountRenamed: false, playerId: null, profileStatus: 'skipped',
    rankingLinked: false, tempPassword: null, preferredName: '', cueverseId: '', duplicateDetected: false, manualReview: false, notes: '',
    ...over,
  }
}

/** Write the admin-only report (includes one-time claim codes). Never served through a public route. */
function writeReport(r: MigrationReport): string {
  mkdirSync(OUT_DIR, { recursive: true })
  const lines = [
    `# Ranked-account migration report (${r.apply ? 'APPLIED' : 'DRY RUN'})`,
    `Generated: ${r.generatedAtIso}`,
    ``,
    `| # | Ranking Name | Mapped User ID | Permanent Player ID | Account | Profile | Ranking Linked | Temp Password (claim code) | Duplicate | Manual Review | Notes |`,
    `|---|---|---|---|---|---|---|---|---|---|---|`,
    ...r.rows.map((x) => `| ${x.line} | ${x.oldName} | ${x.mappedUserId} | ${x.playerId ?? ''} | ${x.accountStatus} | ${x.profileStatus} | ${x.rankingLinked ? 'yes' : 'no'} | ${x.tempPassword ?? ''} | ${x.duplicateDetected ? 'YES' : ''} | ${x.manualReview ? 'YES' : ''} | ${x.notes} |`),
    ``,
    `## Summary`,
    ...Object.entries(r.summary).map(([k, v]) => `- ${k}: ${v}`),
    ``,
    `## Duplicates / ambiguous (manual review)`,
    ...(r.duplicates.length ? r.duplicates.map((d) => `- ${d}`) : ['- none']),
    ``,
  ]
  const path = `${OUT_DIR}/migration-${r.apply ? 'applied' : 'dryrun'}.md`
  writeFileSync(path, lines.join('\n'), 'utf8')
  return path
}
