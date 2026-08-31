import 'server-only'

/**
 * Finding a player by any name they have ever gone by.
 *
 * ── Why this is separate from the merge search ──────────────────────────────────────────────────
 * `searchMergeCandidates` looks at the current name and CueVerse ID only, which is right for the
 * question it answers: merging is about two accounts that exist NOW. Choosing a player to reference
 * is a different question — the person doing it is usually working from an old bracket, a video
 * title or a screenshot, and the handle they remember is very often one the player has since
 * changed. A search that cannot find "po0lin" is a search that sends somebody to the database.
 *
 * So four things are matched, and the result says which one hit:
 *
 *   the current display name        Derrick
 *   the current CueVerse ID         💎
 *   a recorded alias                po0lin, scientist, thederman…
 *   a merged-away account           an identity that used to be its own player row
 *
 * ── What it deliberately returns ────────────────────────────────────────────────────────────────
 * Public identity and nothing else. The `Player` row also carries an email, a Discord handle, a
 * linked user id and moderation flags; none of that is needed to pick somebody out of a list, so
 * none of it is selected. This is the shape that reaches an editor's browser, and the cheapest way
 * to be sure a field never leaks is for the query never to ask for it.
 *
 * Every function here reads. Nothing in this file creates, renames, merges or deletes a player.
 */

import { prisma } from '@/lib/prisma'

/** Everything the editor needs to recognise a player, and nothing else. */
export interface PlayerOption {
  id: string
  /** Current display name. */
  name: string
  /** Current CueVerse ID; may be empty for an archive-only player. */
  cueverseId: string
  /** Past handles, most useful first. Capped — a list is for recognition, not for completeness. */
  aliases: string[]
  /** False for an archived player. Shown, because referencing one is usually a mistake. */
  active: boolean
  /** Which field the search term hit, so a result that looks unrelated explains itself. */
  matchedOn?: 'name' | 'cueverseId' | 'alias' | 'merged'
  /** The alias or merged handle that matched, when that is what hit. */
  matchedValue?: string
}

/**
 * Only public identity. Selected explicitly rather than by exclusion: a column added to `Player`
 * next year is left out by default instead of quietly joining the payload.
 */
const IDENTITY_SELECT = {
  id: true,
  primaryName: true,
  cueverseId: true,
  active: true,
} as const

type IdentityRow = {
  id: string
  primaryName: string | null
  cueverseId: string | null
  active: boolean
}

const MAX_ALIASES = 6

function baseOption(row: IdentityRow): PlayerOption {
  return {
    id: row.id,
    name: row.primaryName ?? 'Unnamed player',
    cueverseId: row.cueverseId ?? '',
    aliases: [],
    active: row.active,
  }
}

/** Attach each player's recorded aliases, in one query rather than one per result. */
async function withAliases(options: PlayerOption[]): Promise<PlayerOption[]> {
  if (options.length === 0) return options
  const rows = await prisma.playerAlias.findMany({
    where: { playerId: { in: options.map((o) => o.id) } },
    select: { playerId: true, alias: true, aliasDisplay: true },
    orderBy: { createdAt: 'desc' },
  })
  const byPlayer = new Map<string, string[]>()
  for (const r of rows) {
    const list = byPlayer.get(r.playerId) ?? []
    const shown = (r.aliasDisplay ?? r.alias).trim()
    if (shown && !list.includes(shown)) list.push(shown)
    byPlayer.set(r.playerId, list)
  }
  return options.map((o) => ({
    ...o,
    aliases: (byPlayer.get(o.id) ?? []).slice(0, MAX_ALIASES),
  }))
}

/**
 * Players matching a term, by name, CueVerse ID, alias or a merged-away identity.
 *
 * Read-only. Returns at most `limit` results; a term shorter than two characters returns nothing
 * rather than the first N of five hundred players, which is not a search result.
 */
export async function searchPlayers(query: string, limit = 12): Promise<PlayerOption[]> {
  const term = query.trim()
  if (term.length < 2) return []

  const like = { contains: term, mode: 'insensitive' as const }

  /*
    Merged-away rows are resolved to the account that absorbed them, never offered themselves.

    Referencing a merged-away player id would be a reference to a record the rest of the site has
    stopped counting, so searching an old identity has to land on the player who now owns it.
  */
  const merges = await prisma.playerMerge.findMany({
    // 'APPROVED' is the applied state, matching `mergedSecondaryPlayerIds`. A PENDING merge has not
    // taken effect anywhere else, so it must not redirect a reference here either.
    where: { status: 'APPROVED' },
    select: { canonicalPlayerId: true, mergedPlayerId: true },
  })
  const canonicalOf = new Map(merges.map((m) => [m.mergedPlayerId, m.canonicalPlayerId]))

  const [direct, aliasHits] = await Promise.all([
    prisma.player.findMany({
      where: {
        managementOnly: false,
        OR: [{ primaryName: like }, { cueverseId: like }],
      },
      select: IDENTITY_SELECT,
      orderBy: { primaryName: 'asc' },
      take: limit * 3,
    }),
    prisma.playerAlias.findMany({
      where: { OR: [{ alias: like }, { aliasDisplay: like }] },
      select: { playerId: true, alias: true, aliasDisplay: true },
      take: limit * 3,
    }),
  ])

  /*
    Ordered by how the term matched, best first.

    Somebody typing "derrick" means the player called Derrick, not the four players who once used a
    handle containing it — so a name match outranks a handle, which outranks an alias, which
    outranks an identity that no longer exists on its own.
  */
  const found = new Map<string, PlayerOption>()
  const add = (row: IdentityRow, matchedOn: PlayerOption['matchedOn'], matchedValue?: string) => {
    const canonical = canonicalOf.get(row.id)
    if (canonical) {
      // A merged-away row: remember that this identity pointed here, resolve later.
      const existing = found.get(canonical)
      if (existing && existing.matchedOn) return
      found.set(canonical, {
        ...baseOption(row), id: canonical, matchedOn: 'merged', matchedValue: matchedValue ?? row.primaryName ?? undefined,
      })
      return
    }
    if (found.has(row.id)) return
    found.set(row.id, { ...baseOption(row), matchedOn, matchedValue })
  }

  const lower = term.toLowerCase()
  for (const row of direct) {
    const byName = (row.primaryName ?? '').toLowerCase().includes(lower)
    add(row, byName ? 'name' : 'cueverseId', byName ? undefined : row.cueverseId ?? undefined)
  }

  const aliasPlayerIds = aliasHits.map((a) => a.playerId).filter((id) => !found.has(id))
  if (aliasPlayerIds.length > 0) {
    const aliasOwners = await prisma.player.findMany({
      where: { id: { in: aliasPlayerIds }, managementOnly: false },
      select: IDENTITY_SELECT,
    })
    const hitFor = new Map(aliasHits.map((a) => [a.playerId, (a.aliasDisplay ?? a.alias).trim()]))
    for (const row of aliasOwners) add(row, 'alias', hitFor.get(row.id))
  }

  /*
    A merged-away hit gave us the canonical id but the merged row's identity. Replace it with the
    canonical player's own name and handle, keeping the note about what matched.
  */
  const needsCanonical = [...found.values()].filter((o) => o.matchedOn === 'merged')
  if (needsCanonical.length > 0) {
    const rows = await prisma.player.findMany({
      where: { id: { in: needsCanonical.map((o) => o.id) } },
      select: IDENTITY_SELECT,
    })
    for (const row of rows) {
      const prev = found.get(row.id)
      found.set(row.id, { ...baseOption(row), matchedOn: 'merged', matchedValue: prev?.matchedValue })
    }
  }

  const RANK: Record<NonNullable<PlayerOption['matchedOn']>, number> = {
    name: 0, cueverseId: 1, alias: 2, merged: 3,
  }
  const ordered = [...found.values()]
    .sort((a, b) => (RANK[a.matchedOn ?? 'merged'] - RANK[b.matchedOn ?? 'merged'])
      || a.name.localeCompare(b.name))
    .slice(0, limit)

  return withAliases(ordered)
}

/**
 * Resolve stored ids to the players they name.
 *
 * An id with no row comes back absent rather than as an error: a reference whose player was
 * deleted or merged away has to be reportable, and the caller decides whether that is a warning to
 * show or a value to leave alone. Silently dropping it is what loses a reference.
 */
export async function resolvePlayers(ids: string[]): Promise<Map<string, PlayerOption>> {
  const wanted = [...new Set(ids.map((i) => i.trim()).filter(Boolean))]
  if (wanted.length === 0) return new Map()

  const rows = await prisma.player.findMany({ where: { id: { in: wanted } }, select: IDENTITY_SELECT })
  const withAlias = await withAliases(rows.map(baseOption))
  return new Map(withAlias.map((o) => [o.id, o]))
}

/** One id, or null when nothing has that id any more. */
export async function resolvePlayer(id: string): Promise<PlayerOption | null> {
  return (await resolvePlayers([id])).get(id.trim()) ?? null
}

/**
 * Which of these ids no longer name a player.
 *
 * Used at save time. Cheap enough to run on every save: one query, keyed, and a page holds a
 * handful of player references at most.
 */
export async function danglingPlayerIds(ids: string[]): Promise<string[]> {
  const wanted = [...new Set(ids.map((i) => i.trim()).filter(Boolean))]
  if (wanted.length === 0) return []
  const rows = await prisma.player.findMany({ where: { id: { in: wanted } }, select: { id: true } })
  const live = new Set(rows.map((r) => r.id))
  return wanted.filter((id) => !live.has(id))
}
