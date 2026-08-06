import 'server-only'
import type { Player } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { recordAudit, type Actor } from '@/lib/competition/audit'

/**
 * Player-profile + account-linking service. A Player row is the permanent competitive
 * identity (its `legacyPlayerId` is the canonical id used by the stats resolver, so
 * rankings/HoF/records keep deriving from Seasons/Cups — nothing is duplicated here).
 * A Payload account may CLAIM exactly one profile (Player.linkedUserId, @unique).
 */

const nk = (s: string | null | undefined) => (s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')

export interface ProfileView {
  id: string
  legacyPlayerId: string | null
  primaryName: string
  cueverseId: string | null
  cueverseIdChangedAt: Date | null
  discord: string | null
  timeZone: string | null
  active: boolean
  linkStatus: string
  linkedUserId: string | null
  aliases: string[]
}

const toView = (p: Player & { aliases?: { alias: string }[] }): ProfileView => ({
  id: p.id,
  legacyPlayerId: p.legacyPlayerId,
  primaryName: p.primaryName,
  cueverseId: p.cueverseId,
  cueverseIdChangedAt: p.cueverseIdChangedAt,
  discord: p.discord,
  timeZone: p.timeZone,
  active: p.active,
  linkStatus: p.linkStatus,
  linkedUserId: p.linkedUserId,
  aliases: (p.aliases ?? []).map((a) => a.alias),
})

/** The profile a Payload account owns, if any. */
export async function getProfileByUserId(userId: number): Promise<ProfileView | null> {
  const p = await prisma.player.findUnique({ where: { linkedUserId: String(userId) }, include: { aliases: true } })
  return p ? toView(p) : null
}

export async function getProfileById(id: string): Promise<ProfileView | null> {
  const p = await prisma.player.findUnique({ where: { id }, include: { aliases: true } })
  return p ? toView(p) : null
}

/**
 * Link an account to a canonical profile (staff action). Enforces 1:1 both ways, then
 * the account ADOPTS the profile's tournament history: any admin-added, account-less
 * entrants for this profile become owned by the account, and the account's own
 * self-registrations are tagged with the profile. This is how a player who competed
 * before signing up gains access to their entries/history once linked.
 */
export async function linkAccountToProfile(actor: Actor, userId: number, playerId: string): Promise<{ ok: boolean; error?: string }> {
  const profile = await prisma.player.findUnique({ where: { id: playerId } })
  if (!profile) return { ok: false, error: 'Profile not found.' }
  if (profile.linkedUserId && profile.linkedUserId !== String(userId))
    return { ok: false, error: 'That profile is already linked to another account.' }
  const accountProfile = await prisma.player.findUnique({ where: { linkedUserId: String(userId) } })
  if (accountProfile && accountProfile.id !== playerId)
    return { ok: false, error: 'This account already owns a different profile — unlink it first.' }

  await prisma.$transaction(async (tx) => {
    await tx.player.update({ where: { id: playerId }, data: { linkedUserId: String(userId), linkStatus: 'VERIFIED', linkedAt: new Date() } })

    // 1) The account adopts account-less entrants for this profile.
    const profileEntries = await tx.registration.findMany({ where: { playerId } })
    for (const pe of profileEntries) {
      if (pe.userId != null) continue
      const accountRow = await tx.registration.findUnique({ where: { seasonId_userId: { seasonId: pe.seasonId, userId } } })
      if (accountRow && accountRow.id !== pe.id) {
        // Account already self-registered this season: keep the profile entry (it may be
        // seeded into groups), drop the duplicate account row unless it's in a group.
        const accInGroup = await tx.groupPlayer.count({ where: { registrationId: accountRow.id } })
        if (accInGroup === 0) {
          await tx.registration.delete({ where: { id: accountRow.id } })
          await tx.registration.update({ where: { id: pe.id }, data: { userId } })
        }
      } else {
        await tx.registration.update({ where: { id: pe.id }, data: { userId } })
      }
    }

    // 2) The account's own self-registrations (no profile yet) get tagged with the profile.
    const accountOwn = await tx.registration.findMany({ where: { userId, playerId: null } })
    for (const ao of accountOwn) {
      const dup = await tx.registration.findUnique({ where: { seasonId_playerId: { seasonId: ao.seasonId, playerId } } })
      if (!dup) await tx.registration.update({ where: { id: ao.id }, data: { playerId } })
    }
  })
  await recordAudit(actor, { action: 'profile.link', entity: 'Player', entityId: playerId, newValue: { linkedUserId: userId, primaryName: profile.primaryName }, reason: `Linked account ${userId} to ${profile.primaryName}` })
  return { ok: true }
}

/** Unlink an account from its profile (staff action). Entrants remain — admin-added
 *  entries revert to account-less (they belong to the profile, not the login); the
 *  account's own self-registrations keep their entry but drop the profile link. */
export async function unlinkAccount(actor: Actor, playerId: string): Promise<{ ok: boolean; error?: string }> {
  const profile = await prisma.player.findUnique({ where: { id: playerId } })
  if (!profile) return { ok: false, error: 'Profile not found.' }
  const uid = profile.linkedUserId
  await prisma.$transaction(async (tx) => {
    await tx.player.update({ where: { id: playerId }, data: { linkedUserId: null, linkStatus: 'UNLINKED', linkedAt: null } })
    if (uid) {
      await tx.registration.updateMany({ where: { userId: Number(uid), addedByAdmin: true }, data: { userId: null } })
      await tx.registration.updateMany({ where: { userId: Number(uid), addedByAdmin: false }, data: { playerId: null } })
    }
  })
  await recordAudit(actor, { action: 'profile.unlink', entity: 'Player', entityId: playerId, oldValue: { linkedUserId: uid }, reason: 'Unlinked account' })
  return { ok: true }
}

export interface AccountProfileFields {
  preferredName?: string | null // OPTIONAL — falls back to the CueVerse ID for display
  cueverseId: string
  discord?: string | null
  timeZone?: string | null
}

export type ProvisionOutcome =
  | { ok: true; playerId: string; linked: boolean }
  | { ok: false; error: string; needsStaff?: boolean }

/**
 * ONE ACCOUNT = ONE PLAYER PROFILE. Create-or-link exactly one canonical Player for a new
 * account, at signup. Never creates a duplicate:
 *  - a profile already owned by this account → returned as-is (idempotent);
 *  - an existing UNLINKED profile whose CueVerse ID (or alias) matches → linked via the
 *    shared linking workflow (adopts prior account-less entries), missing public fields
 *    backfilled without clobbering historical values;
 *  - the CueVerse ID already held by ANOTHER account → refused (taken);
 *  - MULTIPLE unlinked candidates → refused as ambiguous and routed to staff (never guessed);
 *  - no match → a new NATIVE profile is created and linked.
 * Email is never stored here — it stays on the private Payload account.
 */
export async function createOrLinkAccountProfile(userId: number, username: string, f: AccountProfileFields): Promise<ProvisionOutcome> {
  const cueverseId = f.cueverseId.trim()
  if (!cueverseId) return { ok: false, error: 'CueVerse ID is required.' }
  // Preferred Name is optional — when absent, the profile name defaults to the CueVerse ID so
  // public pages have a value to show (and the shared formatter collapses "id (id)" to just "id").
  const preferredName = f.preferredName?.trim() || cueverseId
  const key = nk(cueverseId)

  // Idempotent: this account already owns a profile.
  const own = await prisma.player.findUnique({ where: { linkedUserId: String(userId) } })
  if (own) return { ok: true, playerId: own.id, linked: true }

  // Candidate profiles by CueVerse ID (case-insensitive) or a matching alias.
  const byId = await prisma.player.findMany({ where: { cueverseId: { equals: cueverseId, mode: 'insensitive' } } })
  const byAlias = await prisma.playerAlias.findMany({ where: { alias: key }, include: { player: true } })
  const candidates = new Map<string, Player>()
  for (const p of byId) candidates.set(p.id, p)
  for (const a of byAlias) if (a.player) candidates.set(a.player.id, a.player)
  const list = [...candidates.values()]

  if (list.some((p) => p.linkedUserId && p.linkedUserId !== String(userId)))
    return { ok: false, error: 'That CueVerse ID is already in use by another account.' }

  const unlinked = list.filter((p) => !p.linkedUserId)
  if (unlinked.length > 1)
    return { ok: false, error: 'Multiple existing player profiles match that CueVerse ID — staff must link the correct one. Your account was not created; please contact staff.', needsStaff: true }

  const selfActor: Actor = { userId, username }
  if (unlinked.length === 1) {
    const p = unlinked[0]
    const linkRes = await linkAccountToProfile(selfActor, userId, p.id)
    if (!linkRes.ok) return { ok: false, error: linkRes.error ?? 'Could not link your profile.' }
    // Backfill missing public fields only — never overwrite existing historical identity.
    await prisma.player.update({
      where: { id: p.id },
      data: {
        discord: p.discord ?? (f.discord?.trim() || null),
        timeZone: p.timeZone ?? (f.timeZone?.trim() || null),
        cueverseId: p.cueverseId ?? cueverseId,
      },
    })
    return { ok: true, playerId: p.id, linked: true }
  }

  // No existing profile — create a fresh native one, linked to the account.
  const created = await prisma.player.create({
    data: {
      primaryName: preferredName,
      cueverseId,
      discord: f.discord?.trim() || null,
      timeZone: f.timeZone?.trim() || null,
      linkedUserId: String(userId),
      linkStatus: 'VERIFIED',
      linkedAt: new Date(),
      active: true,
      provenance: 'NATIVE_EGO',
    },
  })
  await prisma.playerAlias.create({ data: { playerId: created.id, alias: key, aliasType: 'HANDLE' } })
  await recordAudit(selfActor, { action: 'profile.createForAccount', entity: 'Player', entityId: created.id, newValue: { preferredName, cueverseId } })
  return { ok: true, playerId: created.id, linked: false }
}

/** Manually create a native profile (staff). */
export async function createProfile(actor: Actor, data: { primaryName: string; cueverseId?: string; discord?: string; timeZone?: string }): Promise<{ id: string }> {
  const p = await prisma.player.create({
    data: { primaryName: data.primaryName, cueverseId: data.cueverseId || null, discord: data.discord || null, timeZone: data.timeZone || null, linkStatus: 'UNLINKED', active: true, provenance: 'NATIVE_EGO' },
  })
  if (data.cueverseId) await prisma.playerAlias.create({ data: { playerId: p.id, alias: nk(data.cueverseId), aliasType: 'HANDLE' } })
  await recordAudit(actor, { action: 'profile.create', entity: 'Player', entityId: p.id, newValue: data })
  return { id: p.id }
}

export interface ProfilePatch {
  primaryName?: string
  cueverseId?: string | null
  discord?: string | null
  timeZone?: string | null
  active?: boolean
}
export async function updateProfile(actor: Actor, playerId: string, patch: ProfilePatch): Promise<void> {
  const before = await prisma.player.findUniqueOrThrow({ where: { id: playerId } })
  // Route CueVerse ID changes through the dedicated path (alias history + audit). Staff
  // edits here are treated as an override (no cooldown). Other fields update normally.
  const { cueverseId, ...rest } = patch
  if (cueverseId !== undefined && (cueverseId ?? null) !== (before.cueverseId ?? null)) {
    await changeCueverseId(actor, playerId, cueverseId, { override: true })
  }
  if (Object.keys(rest).length > 0) {
    await prisma.player.update({ where: { id: playerId }, data: rest })
    await recordAudit(actor, {
      action: 'profile.update', entity: 'Player', entityId: playerId,
      oldValue: { primaryName: before.primaryName, discord: before.discord, timeZone: before.timeZone, active: before.active },
      newValue: rest,
    })
  }
}

/** Days a member must wait between self-service CueVerse ID changes. */
export const CUEVERSE_COOLDOWN_DAYS = 7

export interface CueverseCooldown {
  canChange: boolean
  lastChangedAt: string | null
  nextAvailableAt: string | null // ISO; null when a change is allowed now
}

/** Cooldown state for a profile's CueVerse ID (for Account Settings display). */
export function cueverseCooldownState(lastChangedAt: Date | null, now: Date = new Date()): CueverseCooldown {
  if (!lastChangedAt) return { canChange: true, lastChangedAt: null, nextAvailableAt: null }
  const next = new Date(lastChangedAt.getTime() + CUEVERSE_COOLDOWN_DAYS * 24 * 60 * 60 * 1000)
  const canChange = now.getTime() >= next.getTime()
  return { canChange, lastChangedAt: lastChangedAt.toISOString(), nextAvailableAt: canChange ? null : next.toISOString() }
}

/**
 * Change a profile's CueVerse ID — the site-wide display identity. Enforces the 7-day
 * cooldown server-side for self-service changes; Owner/Admin pass `override: true` for
 * corrections. The previous ID is preserved as a searchable alias, the underlying
 * profile id never changes, and every change/override is audited.
 */
export async function changeCueverseId(
  actor: Actor,
  playerId: string,
  newIdRaw: string | null,
  opts: { override?: boolean } = {},
): Promise<{ ok: boolean; error?: string; nextAvailableAt?: string }> {
  const newId = (newIdRaw ?? '').trim() || null
  const p = await prisma.player.findUniqueOrThrow({ where: { id: playerId } })
  if ((p.cueverseId ?? null) === newId) return { ok: true } // no change

  if (!opts.override) {
    const cd = cueverseCooldownState(p.cueverseIdChangedAt)
    if (!cd.canChange) {
      return { ok: false, error: `You can change your CueVerse ID again on ${new Date(cd.nextAvailableAt!).toLocaleDateString()}.`, nextAvailableAt: cd.nextAvailableAt ?? undefined }
    }
  }

  await prisma.$transaction(async (tx) => {
    // Preserve the OLD id as a searchable alias (history never lost).
    if (p.cueverseId) {
      const oldKey = nk(p.cueverseId)
      if (oldKey) {
        const existing = await tx.playerAlias.findFirst({ where: { playerId, alias: oldKey } })
        if (!existing) await tx.playerAlias.create({ data: { playerId, alias: oldKey, aliasType: 'HANDLE' } })
      }
    }
    await tx.player.update({ where: { id: playerId }, data: { cueverseId: newId, cueverseIdChangedAt: new Date() } })
    // Make the new id searchable too.
    if (newId) {
      const newKey = nk(newId)
      if (newKey) {
        const existing = await tx.playerAlias.findFirst({ where: { playerId, alias: newKey } })
        if (!existing) await tx.playerAlias.create({ data: { playerId, alias: newKey, aliasType: 'HANDLE' } })
      }
    }
    await recordAudit(actor, {
      action: opts.override ? 'profile.cueverseChange.override' : 'profile.cueverseChange',
      entity: 'Player', entityId: playerId,
      oldValue: { cueverseId: p.cueverseId },
      newValue: { cueverseId: newId, by: actor.username, override: !!opts.override },
    }, tx)
  })
  return { ok: true }
}

/** Unlinked (unclaimed) profiles, optionally filtered by name / handle / discord / alias. */
export async function getUnlinkedProfiles(search = '', limit = 25): Promise<ProfileView[]> {
  const q = search.trim()
  const rows = await prisma.player.findMany({
    where: {
      linkedUserId: null,
      ...(q
        ? {
            OR: [
              { primaryName: { contains: q, mode: 'insensitive' } },
              { cueverseId: { contains: q, mode: 'insensitive' } },
              { discord: { contains: q, mode: 'insensitive' } },
              { aliases: { some: { alias: { contains: nk(q) } } } },
            ],
          }
        : {}),
    },
    include: { aliases: true },
    orderBy: { primaryName: 'asc' },
    take: limit,
  })
  return rows.map(toView)
}

/**
 * Informational suggestions for an account's submitted identity: profiles whose alias
 * exactly matches the CueVerse ID, or whose Discord exactly matches. Never auto-links.
 */
export async function suggestProfiles(cueverseId?: string | null, discord?: string | null): Promise<ProfileView[]> {
  const cv = nk(cueverseId)
  const dc = (discord ?? '').trim().toLowerCase()
  if (!cv && !dc) return []
  const rows = await prisma.player.findMany({
    where: {
      linkedUserId: null,
      OR: [
        ...(cv ? [{ aliases: { some: { alias: cv } } }, { cueverseId: { equals: cueverseId ?? undefined, mode: 'insensitive' as const } }] : []),
        ...(dc ? [{ discord: { equals: discord ?? undefined, mode: 'insensitive' as const } }] : []),
      ],
    },
    include: { aliases: true },
    take: 5,
  })
  return rows.map(toView)
}

export interface ProfileSuggestion {
  profile: ProfileView
  matchedOn: string[] // e.g. ["CueVerse ID"], ["Discord"], or both
}

/** Suggestions with the reason they matched (exact CueVerse ID / exact Discord). */
export async function suggestProfilesDetailed(cueverseId?: string | null, discord?: string | null): Promise<ProfileSuggestion[]> {
  const cv = nk(cueverseId)
  const dc = (discord ?? '').trim().toLowerCase()
  const byId = new Map<string, ProfileSuggestion>()
  if (cv) {
    const rows = await prisma.player.findMany({ where: { linkedUserId: null, OR: [{ aliases: { some: { alias: cv } } }, { cueverseId: { equals: cueverseId ?? undefined, mode: 'insensitive' } }] }, include: { aliases: true }, take: 5 })
    for (const r of rows) byId.set(r.id, { profile: toView(r), matchedOn: ['CueVerse ID'] })
  }
  if (dc) {
    const rows = await prisma.player.findMany({ where: { linkedUserId: null, discord: { equals: discord ?? undefined, mode: 'insensitive' } }, include: { aliases: true }, take: 5 })
    for (const r of rows) {
      const e = byId.get(r.id)
      if (e) e.matchedOn.push('Discord')
      else byId.set(r.id, { profile: toView(r), matchedOn: ['Discord'] })
    }
  }
  return [...byId.values()]
}

/** Total profiles / claimed counts (for admin summary). */
export async function getProfileCounts(): Promise<{ total: number; claimed: number; unclaimed: number; needsPrimaryReview: number }> {
  const total = await prisma.player.count()
  const claimed = await prisma.player.count({ where: { linkedUserId: { not: null } } })
  const needsPrimaryReview = await prisma.player.count({ where: { cueverseId: null } })
  return { total, claimed, unclaimed: total - claimed, needsPrimaryReview }
}
