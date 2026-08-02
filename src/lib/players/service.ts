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
 * resolves that account's registrations to the profile so the entrant is not duplicated.
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
    await tx.registration.updateMany({ where: { userId }, data: { playerId } })
  })
  await recordAudit(actor, { action: 'profile.link', entity: 'Player', entityId: playerId, newValue: { linkedUserId: userId, primaryName: profile.primaryName }, reason: `Linked account ${userId} to ${profile.primaryName}` })
  return { ok: true }
}

/** Unlink an account from its profile (staff action). Historical data is untouched. */
export async function unlinkAccount(actor: Actor, playerId: string): Promise<{ ok: boolean; error?: string }> {
  const profile = await prisma.player.findUnique({ where: { id: playerId } })
  if (!profile) return { ok: false, error: 'Profile not found.' }
  const uid = profile.linkedUserId
  await prisma.$transaction(async (tx) => {
    await tx.player.update({ where: { id: playerId }, data: { linkedUserId: null, linkStatus: 'UNLINKED', linkedAt: null } })
    if (uid) await tx.registration.updateMany({ where: { userId: Number(uid) }, data: { playerId: null } })
  })
  await recordAudit(actor, { action: 'profile.unlink', entity: 'Player', entityId: playerId, oldValue: { linkedUserId: uid }, reason: 'Unlinked account' })
  return { ok: true }
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
  await prisma.player.update({ where: { id: playerId }, data: patch })
  await recordAudit(actor, {
    action: 'profile.update', entity: 'Player', entityId: playerId,
    oldValue: { primaryName: before.primaryName, cueverseId: before.cueverseId, discord: before.discord, timeZone: before.timeZone, active: before.active },
    newValue: patch,
  })
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
