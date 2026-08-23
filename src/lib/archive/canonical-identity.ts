/**
 * Resolve an archive handle to the one Player it means, following merges.
 *
 * ── Why every comparison has to happen here ──────────────────────────────────────────────────────
 * The three records of a playoff field — the manifest's qualifiers, the bracket page's entry
 * positions, the database's selection — each spell people their own way, and after a merge two
 * spellings are one person. Comparing the raw strings makes the same player look like two: the
 * manifest's `bigblue2k` appeared to be missing from a bracket that seats `sixohtwo`, when a merge
 * had already made those the same account.
 *
 * That is not merely a reporting problem. Acting on it deselected the player as a missing qualifier
 * and then selected them again as a new entrant — two mutations on one entrant row whose net effect
 * was to leave them out of a playoff they had won matches in. Comparing by canonical Player id
 * removes the possibility: one person is one member of a set, whatever the source called them.
 */
import { prisma } from '@/lib/prisma'
import { resolveCanonicalPlayerId } from '@/lib/players/merge'

import { stripSourceNote } from './manifest'

export interface CanonicalIdentity {
  /** The handle as the source printed it. */
  rawHandle: string
  /** The Player this handle means after merges are followed, or null when nothing matches. */
  playerId: string | null
  /** That Player's entrant row in this Season, when they have one. */
  entrantId: number | null
  resolution: 'resolved' | 'unresolved' | 'ambiguous'
  /** How the handle was matched, for the report. */
  via: 'cueverse-id' | 'alias' | 'entrant' | 'none'
}

/**
 * One handle, one Player.
 *
 * Tried in order of how directly each says who somebody is: the CueVerse ID they hold now, an alias
 * a merge or rename left behind, and finally the entrant row itself. Preferred Name is never used —
 * six Chrises and six Craigs is why.
 */
export async function resolveCanonical(seasonId: number | null, rawHandle: string): Promise<CanonicalIdentity> {
  const handle = stripSourceNote(rawHandle).trim()
  const key = handle.toLowerCase()
  const base = { rawHandle, entrantId: null as number | null }

  const withEntrant = async (playerId: string, via: CanonicalIdentity['via']): Promise<CanonicalIdentity> => {
    const canonical = (await resolveCanonicalPlayerId(playerId)) ?? playerId
    const entrant = seasonId
      ? await prisma.seasonEntrant.findFirst({ where: { seasonId, playerId: canonical }, select: { id: true } })
      : null
    return { ...base, playerId: canonical, entrantId: entrant?.id ?? null, resolution: 'resolved', via }
  }

  const byId = await prisma.player.findMany({ where: { cueverseIdNormalized: key }, select: { id: true } })
  if (byId.length === 1) return withEntrant(byId[0].id, 'cueverse-id')
  if (byId.length > 1) return { ...base, playerId: null, resolution: 'ambiguous', via: 'none' }

  const byAlias = await prisma.playerAlias.findMany({
    where: { alias: { equals: handle, mode: 'insensitive' } },
    select: { playerId: true },
  })
  const aliasIds = [...new Set(byAlias.map((a) => a.playerId))]
  if (aliasIds.length === 1) return withEntrant(aliasIds[0], 'alias')
  if (aliasIds.length > 1) {
    /*
     * Several aliases can point at one person once merges are followed — that is not ambiguity.
     * It is only ambiguous if they still resolve to different people.
     */
    const canonicals = [...new Set(await Promise.all(aliasIds.map(async (id) => (await resolveCanonicalPlayerId(id)) ?? id)))]
    if (canonicals.length === 1) return withEntrant(canonicals[0], 'alias')
    return { ...base, playerId: null, resolution: 'ambiguous', via: 'none' }
  }

  if (seasonId) {
    const byEntrant = await prisma.seasonEntrant.findMany({
      where: { seasonId, cueverseId: { equals: key, mode: 'insensitive' } },
      select: { id: true, playerId: true },
    })
    if (byEntrant.length === 1 && byEntrant[0].playerId) return withEntrant(byEntrant[0].playerId, 'entrant')
    if (byEntrant.length > 1) return { ...base, playerId: null, resolution: 'ambiguous', via: 'none' }
  }

  return { ...base, playerId: null, resolution: 'unresolved', via: 'none' }
}

/** Resolve a list of handles and collapse it to one entry per person. */
export async function resolveAll(seasonId: number | null, handles: string[]): Promise<{
  identities: CanonicalIdentity[]
  /** One entry per Player, keyed by canonical id, carrying every spelling that led to them. */
  byPlayer: Map<string, { playerId: string; entrantId: number | null; spellings: string[] }>
  unresolved: string[]
  ambiguous: string[]
}> {
  const identities: CanonicalIdentity[] = []
  const byPlayer = new Map<string, { playerId: string; entrantId: number | null; spellings: string[] }>()
  const unresolved: string[] = []
  const ambiguous: string[] = []

  for (const h of handles) {
    const id = await resolveCanonical(seasonId, h)
    identities.push(id)
    if (id.resolution === 'ambiguous') { ambiguous.push(h); continue }
    if (!id.playerId) { unresolved.push(h); continue }
    const cur = byPlayer.get(id.playerId)
    if (cur) { if (!cur.spellings.includes(h)) cur.spellings.push(h) }
    else byPlayer.set(id.playerId, { playerId: id.playerId, entrantId: id.entrantId, spellings: [h] })
  }
  return { identities, byPlayer, unresolved, ambiguous }
}

/**
 * The one change each Player needs, computed between finished sets rather than step by step.
 *
 * Additions and removals are the difference between two sets of Player ids, so a Player who appears
 * in both under different spellings produces no change at all — which is exactly the case that
 * previously produced a deselect followed by a select.
 */
export function selectionDelta(
  desired: Set<string>,
  current: Set<string>,
): { add: string[]; remove: string[]; unchanged: string[] } {
  return {
    add: [...desired].filter((p) => !current.has(p)),
    remove: [...current].filter((p) => !desired.has(p)),
    unchanged: [...desired].filter((p) => current.has(p)),
  }
}
