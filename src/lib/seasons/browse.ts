import 'server-only'
import { prisma } from '@/lib/prisma'

/**
 * Everything the public Seasons browser needs, read STRICTLY from the registry database.
 *
 * There is no archive, no seed file and no static snapshot behind any of this: a Season appears in
 * these lists the moment it is created through the site, and disappears if it is deleted. The
 * offline archive viewer was a visual reference only and nothing here reads from it.
 *
 * "Newest" means the same thing everywhere: highest Competition Year, then highest Season number.
 */

/**
 * Newest first — the canonical ordering for "which Season should I be looking at".
 *
 * Year, then Season number. Numbers are only unique within a Competition and year now, so two
 * Competitions can both hold "2026 Season 1"; the Competition name and then the Season id break
 * that tie, which keeps the order total and identical between requests.
 */
const NEWEST_FIRST = [
  { competitionYear: 'desc' as const },
  { number: 'desc' as const },
  { competitionSeries: { name: 'asc' as const } },
  { id: 'asc' as const },
]
/** Oldest first — the chronological order the Previous/Next arrows walk. */
const OLDEST_FIRST = [
  { competitionYear: 'asc' as const },
  { number: 'asc' as const },
  { competitionSeries: { name: 'asc' as const } },
  { id: 'asc' as const },
]

export interface CompetitionOption {
  id: number
  /** Stable identifier used for filtering; never the display text. */
  slug: string
  /** What the dropdown shows — the Competition's stored short name (currently "8br"). */
  shortName: string
  name: string
}

export interface SeasonOption {
  /** Immutable database id — what every link and selector passes. */
  id: number
  number: number
  year: number
  title: string
  competitionSlug: string
  lifecycleState: string
  isCompleted: boolean
}

export interface SeasonBrowseData {
  competitions: CompetitionOption[]
  /** Every Season visible under the current Competition filter, newest first. */
  seasons: SeasonOption[]
  years: number[]
}

/** A Competition qualifies for the picker only if it is active AND actually has a Season in it. */
function activeWithSeasons() {
  return { active: true, seasons: { some: {} } }
}

/**
 * The Competition options, the Seasons under the current filter, and the years those Seasons fall
 * in. `competitionSlug` of null (or an unknown slug) means All Competitions.
 */
export async function getSeasonBrowseData(competitionSlug?: string | null): Promise<SeasonBrowseData> {
  const comps = await prisma.competitionSeries.findMany({
    where: activeWithSeasons(),
    orderBy: { name: 'asc' },
    select: { id: true, slug: true, shortName: true, name: true },
  })
  const known = new Set(comps.map((c) => c.slug))
  const filter = competitionSlug && known.has(competitionSlug) ? competitionSlug : null

  const rows = await prisma.season.findMany({
    where: filter ? { competitionSeries: { slug: filter } } : {},
    orderBy: NEWEST_FIRST,
    select: {
      id: true, number: true, competitionYear: true, lifecycleState: true,
      competitionSeries: { select: { slug: true, name: true } },
    },
  })

  const seasons: SeasonOption[] = rows.map((s) => ({
    id: s.id,
    number: s.number,
    year: s.competitionYear,
    title: `Season ${s.number}`,
    competitionSlug: s.competitionSeries?.slug ?? '',
    lifecycleState: s.lifecycleState,
    isCompleted: s.lifecycleState === 'COMPLETED',
  }))

  return { competitions: comps, seasons, years: [...new Set(seasons.map((s) => s.year))] }
}

/**
 * The Season to land on when no specific one is asked for: newest year, then highest number.
 * Returns null only when the filter matches no Season at all (including an empty registry).
 */
/**
 * The Competition the Seasons page opens on when the URL does not name one.
 *
 * 8BRCAM is the registry's own competition and the one nearly every visit is about. Without a
 * default the page opened on whatever Season sorted newest across EVERY Competition, which now means
 * a record from another Competition entirely — a different history from the one the reader asked for. Naming the
 * default here keeps the page and the picker agreeing about what "no filter" means.
 */
export const DEFAULT_COMPETITION_SLUG = '8brcam'

export async function newestSeasonId(competitionSlug?: string | null): Promise<number | null> {
  const s = await prisma.season.findFirst({
    where: competitionSlug ? { competitionSeries: { slug: competitionSlug } } : {},
    orderBy: NEWEST_FIRST,
    select: { id: true },
  })
  return s?.id ?? null
}

export interface SeasonNeighbours {
  /** Database id of the chronologically PREVIOUS Season (older), or null at the start of the run. */
  prev: number | null
  /** Database id of the chronologically NEXT Season (newer), or null at the most recent one. */
  next: number | null
}

/**
 * Previous/Next in chronological Season order, honouring the active Competition filter so the arrows
 * never walk out of the list the reader is looking at.
 */
export async function seasonNeighbours(id: number, competitionSlug?: string | null): Promise<SeasonNeighbours> {
  const current = await prisma.season.findUnique({
    where: { id },
    select: { id: true, number: true, competitionYear: true, competitionSeries: { select: { slug: true, name: true } } },
  })
  if (!current) return { prev: null, next: null }

  const scope = competitionSlug ? { competitionSeries: { slug: competitionSlug } } : {}
  // "Older" = an earlier year, or the same year with a lower number. Expressed as an OR because a
  // Season's position is a (year, number) pair, not a single sortable column.
  // A Season's position is a (year, number, id) triple, not one sortable column, so "older" and
  // "newer" are spelled out. `id` closes the case where two Competitions share a year AND a number:
  // without it the arrows could stall on the tie instead of moving past it.
  const older = {
    OR: [
      { competitionYear: { lt: current.competitionYear } },
      { competitionYear: current.competitionYear, number: { lt: current.number } },
      { competitionYear: current.competitionYear, number: current.number, id: { lt: current.id } },
    ],
  }
  const newer = {
    OR: [
      { competitionYear: { gt: current.competitionYear } },
      { competitionYear: current.competitionYear, number: { gt: current.number } },
      { competitionYear: current.competitionYear, number: current.number, id: { gt: current.id } },
    ],
  }

  const [prev, next] = await Promise.all([
    prisma.season.findFirst({ where: { ...scope, ...older }, orderBy: NEWEST_FIRST, select: { id: true } }),
    prisma.season.findFirst({ where: { ...scope, ...newer }, orderBy: OLDEST_FIRST, select: { id: true } }),
  ])
  return { prev: prev?.id ?? null, next: next?.id ?? null }
}

/**
 * The entrants who actually appear somewhere in this Season's playoff bracket.
 *
 * This is the ONLY source for the gold qualification edge on a group table. Deriving it from
 * finishing position or an "advance N per group" setting would be a guess; a player either turns up
 * in the bracket or they do not. Byes are handled for free — a player whose first appearance is in
 * round two, having sat out round one, is still in the bracket and still marked.
 *
 * Empty slots and the literal "Bye" placeholder carry no entrant id, so they can never qualify.
 * An unbuilt bracket yields an empty set, and nobody is marked.
 */
export async function seasonPlayoffParticipants(seasonId: number): Promise<Set<number>> {
  const rows = await prisma.seasonPlayoffMatch.findMany({
    where: { seasonId },
    select: { homeEntrantId: true, awayEntrantId: true },
  })
  const out = new Set<number>()
  for (const r of rows) {
    if (r.homeEntrantId != null) out.add(r.homeEntrantId)
    if (r.awayEntrantId != null) out.add(r.awayEntrantId)
  }
  return out
}

/** True once a bracket exists that the public may see for this Season. */
export async function hasPublicPlayoffBracket(seasonId: number, lifecycleState: string): Promise<boolean> {
  // A draft bracket built during PLAYOFF_SETUP is deliberately private — it is still being arranged,
  // and publishing it early would present provisional placements as decided ones.
  if (lifecycleState !== 'PLAYOFFS_LIVE' && lifecycleState !== 'COMPLETED') return false
  return (await prisma.seasonPlayoffMatch.count({ where: { seasonId } })) > 0
}

export interface SeasonPlayerHit {
  entrantId: number
  cueverseId: string | null
  preferredName: string | null
  /** Group this player is in for this Season, when the groups are published. */
  groupLabel: string | null
  inPlayoffs: boolean
}

/**
 * Player search WITHIN the Season on screen, matching either half of an identity.
 *
 * Scoped to this Season's own entrants and read only from the registry, so it can never surface a
 * name the site does not hold. Mirrors the offline viewer's behaviour of jumping you to the player
 * you typed, without borrowing any of its data.
 */
export async function searchSeasonPlayers(seasonId: number, query: string, limit = 25): Promise<SeasonPlayerHit[]> {
  const q = query.trim().toLowerCase()
  const entrants = await prisma.seasonEntrant.findMany({
    where: { seasonId, status: { not: 'WITHDRAWN' } },
    select: { id: true, cueverseId: true, displayName: true, username: true },
    orderBy: [{ cueverseId: 'asc' }, { username: 'asc' }],
  })

  const groups = await prisma.seasonGroup.findMany({
    where: { seasonId, published: true },
    select: { code: true, name: true, standings: { select: { entrantId: true } } },
  })
  const groupOf = new Map<number, string>()
  for (const g of groups) {
    for (const s of g.standings) groupOf.set(s.entrantId, g.name || `Group ${g.code}`)
  }
  const inPlayoffs = await seasonPlayoffParticipants(seasonId)

  return entrants
    .filter((e) => {
      if (!q) return true
      return (e.cueverseId ?? '').toLowerCase().includes(q) ||
        (e.displayName ?? '').toLowerCase().includes(q) ||
        e.username.toLowerCase().includes(q)
    })
    .slice(0, limit)
    .map((e) => ({
      entrantId: e.id,
      cueverseId: e.cueverseId ?? e.username,
      preferredName: e.displayName?.trim() || null,
      groupLabel: groupOf.get(e.id) ?? null,
      inPlayoffs: inPlayoffs.has(e.id),
    }))
}

export interface SeasonGlance {
  entrants: number
  groups: number
  gamesPerMatch: number
  /** Every real matchup this Season holds: group fixtures plus contested playoff ties. */
  totalMatches: number
}

/**
 * The "Season at a Glance" figures, counted from the rows the Season actually holds.
 *
 * `totalMatches` is a count, never a formula: an archived Season can have an irregular group stage,
 * a withdrawal, or a bracket that does not halve cleanly, so anything derived from entrant counts
 * would drift from what is really recorded. Byes and unfilled bracket slots are excluded — a player
 * advancing unopposed did not play a match.
 */
export async function getSeasonGlance(seasonId: number, gamesPerMatch: number): Promise<SeasonGlance> {
  const [entrants, groups, groupMatches, playoffMatches] = await Promise.all([
    prisma.seasonEntrant.count({ where: { seasonId, status: { not: 'WITHDRAWN' } } }),
    prisma.seasonGroup.count({ where: { seasonId, published: true } }),
    prisma.seasonMatch.count({ where: { seasonId } }),
    prisma.seasonPlayoffMatch.count({
      where: { seasonId, homeEntrantId: { not: null }, awayEntrantId: { not: null } },
    }),
  ])
  return { entrants, groups, gamesPerMatch, totalMatches: groupMatches + playoffMatches }
}
