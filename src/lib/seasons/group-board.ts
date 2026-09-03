import 'server-only'

import { prisma } from '@/lib/prisma'
import { advancingInGroup, seasonAdvancement } from './advancement'
import { computeClinches, isClinched, type ClinchStatus } from './clinch'
import { WIN_POINTS, DRAW_POINTS, COMPLETION_BONUS } from '@/lib/competition/standings'
import type { StageGroup, StageStandingRow } from './views'

/**
 * The group board's view model: every figure the redesigned Groups page shows, derived once.
 *
 * ── Why this exists rather than the components counting for themselves ──────────────────────────
 * The old page counted the same things in three places — the season deck, the Groups heading and
 * each group header — and they disagreed. The deck said "22/112 matches" while a header said "Games
 * per match 10" and a progress bar showed roughly half. Each was reading something slightly
 * different and none of them was wrong on its own terms, which is the worst kind of disagreement.
 *
 * So: one function, one set of numbers, and the page renders them. Where two places show the same
 * quantity they are now the same VALUE, not two calculations that ought to agree.
 *
 * ── Nothing here recomputes a standing ──────────────────────────────────────────────────────────
 * Points, wins, games and rank all arrive from the persisted `SeasonStanding` rows, exactly as they
 * do everywhere else. What is added is arithmetic ABOUT them — how far through the stage a group is,
 * how many sets a player has left, and whether their place is mathematically safe. The scoring and
 * tiebreak rules are untouched.
 */

/** How a single matrix cell should read. Derived from the match's status, never guessed. */
export type CellKind =
  /** No fixture exists between this pair at all. */
  | 'no-fixture'
  /** Scheduled and not yet played. */
  | 'unplayed'
  /** Resolved with a numeric score. */
  | 'score'
  /** Resolved as a walkover. */
  | 'forfeit'
  /** Resolved, but with no score recorded — a real state in this data, and not the same as unplayed. */
  | 'no-score'
  /** Closed out unplayed when the groups were closed. */
  | 'no-contest'
  /** Voided, normally by a kick-out. */
  | 'void'

export interface BoardCell {
  kind: CellKind
  /** This row's games, from this row's point of view. */
  mine: number | null
  theirs: number | null
  /** For a forfeit: whether THIS row is the side that gave it up. */
  iForfeited: boolean
  /** win / loss / draw, for a scored cell. */
  tone: 'w' | 'l' | 'd' | null
}

export interface BoardPlayer {
  entrantId: number
  playerId: string | null
  /** The competition identity, and the only thing the opponent headers show. */
  cueverseId: string
  /** Secondary text in the left column. Also the source of the opponent header label below. */
  preferredName: string | null
  /**
   * What the opponent column heading shows: the preferred name, capped.
   *
   * A header's job is to say which column this is, in the fewest characters that still identify
   * somebody — and a preferred name is shorter and more familiar than a handle. The full identity
   * stays reachable in the cell's title and accessible name; only the visible text is capped.
   *
   * Falls back to the CueVerse ID when there is no preferred name, and ALSO when two players in the
   * same group share one: two columns both headed "Chris" identify nothing, so both revert to the
   * identity that is unique by construction. Resolved on the server, per group, so the component
   * renders a decision rather than making one.
   */
  headerLabel: string
  /** The full identity, for the tooltip and the accessible name behind a capped label. */
  headerTitle: string
  slug: string | null
  kickedOut: boolean
  /** Registry avatar, already cache-busted. Null means draw the monogram. */
  avatarUrl: string | null
  /** True when the file is animated, so the table can show a still and the profile cannot. */
  avatarAnimated: boolean
  /** The player's saved profile accent, for the avatar ring ONLY. Null falls back to the site steel. */
  accent: string | null
  /** One or two letters for the monogram fallback. */
  monogram: string

  points: number
  wins: number
  losses: number
  draws: number
  played: number
  gamesWon: number
  gamesLost: number
  /** Games won as a share of games played, or null when none are recorded. */
  gamePct: number | null
  /** Scheduled sets still to be resolved. Counted from fixtures. */
  remaining: number
  clinch: ClinchStatus
  /** Set once proved; never cleared by entering a further result. */
  clinchedAt: Date | null
  /**
   * Whether the board draws the lock — proved now, or proved before and recorded.
   *
   * Resolved on the server so the client renders a decision rather than making one. The group and
   * season counts are computed from this same field, which is what stops a header count and the
   * locks beneath it from ever disagreeing.
   */
  clinchShown: boolean
  /** Cells against every other player in the group, in board order. */
  cells: Record<number, BoardCell>
}

export interface BoardGroup {
  id: number
  code: string
  name: string | null
  players: BoardPlayer[]
  setsPlayed: number
  setsTotal: number
  /** 0–100, one decimal. Always the same number the fill is drawn from. */
  percent: number
  advancing: number
  clinched: number
}

export interface GroupBoard {
  groups: BoardGroup[]
  /** Season-wide figures, shown once, in the overview. */
  totals: {
    entrants: number
    groups: number
    setsPlayed: number
    setsTotal: number
    percent: number
    clinched: number
  }
  /** The format rule, for the badge beside the status. */
  gamesPerSet: number
  advancement: ReturnType<typeof seasonAdvancement>
}

/**
 * A set counts as PLAYED once it has been resolved one way or another.
 *
 * The same two statuses `recomputeSeasonStandings` counts, so the progress rail can never disagree
 * with the points beneath it. NO_CONTEST and VOID are deliberately excluded from the numerator —
 * they were never contested — but stay in the denominator, because a stage of 112 fixtures does not
 * become a stage of 108 because four of them were written off.
 */
const RESOLVED = new Set(['COMPLETED', 'FORFEIT'])

/** Rounded to one decimal, and used for BOTH the label and the bar. */
function pct(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0
}

/** Initials for the monogram: two letters from a handle, one when there is only one word. */
export function monogramOf(handle: string): string {
  const letters = handle.replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(/\s+/).filter(Boolean)
  if (letters.length === 0) return '?'
  if (letters.length === 1) return letters[0].slice(0, 2).toUpperCase()
  return (letters[0][0] + letters[1][0]).toUpperCase()
}

/**
 * Trim a label to a visible length, with a real ellipsis character.
 *
 * The character cap and the CSS one do different jobs: this stops a forty-character name reaching
 * the DOM at all, and `text-overflow` in the stylesheet handles a name that is short in characters
 * but wide in pixels. Either alone leaves a gap.
 */
function cap(text: string, max: number): string {
  const t = text.trim()
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`
}

/** Whether a stored avatar filename is an animated format. Extension is all the row records. */
function isAnimated(filename: string | null): boolean {
  return !!filename && /\.(gif|webp|apng)$/i.test(filename)
}

export async function getGroupBoard(
  seasonId: number,
  groups: StageGroup[],
  gamesPerSet: number,
): Promise<GroupBoard> {
  /*
    Four reads for the whole board, whatever its size.

    Avatars, themes and fixtures are each fetched once for every player on the page rather than per
    row — a season of thirty-two across four groups would otherwise be ninety-six queries for the
    identity strips alone.
  */
  const entrantIds = groups.flatMap((g) => g.standings.map((s) => s.entrantId))
  const [entrants, standings, season] = await Promise.all([
    prisma.seasonEntrant.findMany({
      where: { id: { in: entrantIds } },
      select: { id: true, playerId: true, cueverseId: true, displayName: true, username: true },
    }),
    prisma.seasonStanding.findMany({
      where: { seasonId },
      select: { entrantId: true, clinchedAt: true },
    }),
    /* This season's own advancement count: the cutoff line and the clinch target both come from it. */
    prisma.season.findUnique({ where: { id: seasonId }, select: { qualifiersPerGroup: true } }),
  ])
  const perGroup = season?.qualifiersPerGroup ?? null

  const playerIds = [...new Set(entrants.map((e) => e.playerId).filter((p): p is string => !!p))]
  const players = playerIds.length
    ? await prisma.player.findMany({
      where: { id: { in: playerIds } },
      select: {
        id: true, cueverseId: true, primaryName: true,
        avatarFilename: true, avatarUpdatedAt: true,
        profileTheme: { select: { accent: true } },
      },
    })
    : []

  const byPlayer = new Map(players.map((p) => [p.id, p]))
  const byEntrant = new Map(entrants.map((e) => [e.id, e]))
  const clinchedAtBy = new Map(standings.map((s) => [s.entrantId, s.clinchedAt]))

  /**
   * The visible cap on a header label.
   *
   * Twelve characters plus an ellipsis is about the widest a name can be before it starts deciding
   * the column width instead of the column deciding it. The cap is applied in CSS as well — see
   * `.gb-head-id` — because a name that fits the character count can still be wide in a proportional
   * face; the two together mean neither a long name nor a wide one can push a column.
   */
  const HEADER_CAP = 12

  const boardGroups: BoardGroup[] = groups.map((g) => {
    const size = g.standings.length
    const advancing = advancingInGroup(size, perGroup)

    /*
      Every fixture, keyed both ways, carrying its STATUS.

      The old matrix keyed only scores, so a scheduled match and a completed one with no score
      recorded both fell through to the same dash — and the legend called that dash "played, score
      not recorded", which for a fixture nobody had played yet was simply untrue.
    */
    const cells = new Map<string, BoardCell>()
    const remainingBy = new Map<number, number>()
    const scheduledBy = new Map<number, number>()
    for (const m of g.matches) {
      if (m.homeEntrantId == null || m.awayEntrantId == null) continue
      scheduledBy.set(m.homeEntrantId, (scheduledBy.get(m.homeEntrantId) ?? 0) + 1)
      scheduledBy.set(m.awayEntrantId, (scheduledBy.get(m.awayEntrantId) ?? 0) + 1)
      if (!RESOLVED.has(m.status)) {
        // NO_CONTEST and VOID are settled: nobody is going to play them, so they are not "remaining".
        if (m.status === 'SCHEDULED') {
          remainingBy.set(m.homeEntrantId, (remainingBy.get(m.homeEntrantId) ?? 0) + 1)
          remainingBy.set(m.awayEntrantId, (remainingBy.get(m.awayEntrantId) ?? 0) + 1)
        }
      }

      const kindFor = (): CellKind => {
        if (m.status === 'VOID') return 'void'
        if (m.status === 'NO_CONTEST') return 'no-contest'
        if (m.status === 'SCHEDULED') return 'unplayed'
        if (m.forfeitEntrantId != null) return 'forfeit'
        if (m.homeGames == null || m.awayGames == null) return 'no-score'
        return 'score'
      }
      const kind = kindFor()
      const put = (self: number, other: number, mine: number | null, theirs: number | null) => {
        const tone = kind === 'score' && mine != null && theirs != null
          ? (mine > theirs ? 'w' : mine < theirs ? 'l' : 'd')
          : null
        cells.set(`${self}|${other}`, {
          kind,
          mine: kind === 'score' ? mine : null,
          theirs: kind === 'score' ? theirs : null,
          iForfeited: kind === 'forfeit' && m.forfeitEntrantId === self,
          tone,
        })
      }
      put(m.homeEntrantId, m.awayEntrantId, m.homeGames, m.awayGames)
      put(m.awayEntrantId, m.homeEntrantId, m.awayGames, m.homeGames)
    }

    const setsTotal = g.matches.filter((m) => m.homeEntrantId != null && m.awayEntrantId != null).length
    const setsPlayed = g.matches.filter((m) => RESOLVED.has(m.status)).length

    /*
      The full slate, from the fixtures rather than from the group size.

      `size - 1` is right for a single round robin and wrong for a double one, and wrong again for an
      archived group with a withdrawal. The number of fixtures a player actually has is the only
      figure that survives all three.
    */
    const fullSlate = Math.max(0, ...g.standings.map((s) => scheduledBy.get(s.entrantId) ?? 0))

    const verdicts = computeClinches({
      rows: g.standings.map((s) => ({
        entrantId: s.entrantId,
        points: s.points, wins: s.wins, losses: s.losses, draws: s.draws, played: s.played,
        gamesWon: s.gamesWon, gamesLost: s.gamesLost,
        remaining: remainingBy.get(s.entrantId) ?? 0,
        rank: s.rank,
      })),
      advancing,
      pointsForWin: WIN_POINTS,
      pointsForDraw: DRAW_POINTS,
      completionBonus: COMPLETION_BONUS,
      fullSlate,
    })
    const verdictBy = new Map(verdicts.map((v) => [v.entrantId, v]))

    const ordered = orderRows(g.standings)

    /*
      Which players' preferred names are ambiguous inside THIS group.

      Compared case-insensitively and only within the group, because that is the only place the
      headers sit side by side — two players called Chris in different groups are never confusable
      on screen, and forcing both of them onto their handles would cost clarity for no gain.
    */
    const preferredCounts = new Map<string, number>()
    for (const s of ordered) {
      const e = byEntrant.get(s.entrantId)
      const p = e?.playerId ? byPlayer.get(e.playerId) : undefined
      const name = (p?.primaryName ?? e?.displayName ?? s.preferredName ?? '').trim().toLowerCase()
      if (name) preferredCounts.set(name, (preferredCounts.get(name) ?? 0) + 1)
    }

    const boardPlayers: BoardPlayer[] = ordered.map((s) => {
      const e = byEntrant.get(s.entrantId)
      const p = e?.playerId ? byPlayer.get(e.playerId) : undefined
      const handle = (p?.cueverseId ?? s.cueverseId ?? e?.cueverseId ?? s.username).trim() || s.username
      const preferred = (p?.primaryName ?? e?.displayName ?? s.preferredName ?? '').trim() || null
      const v = verdictBy.get(s.entrantId)
      const total = s.gamesWon + s.gamesLost
      return {
        entrantId: s.entrantId,
        playerId: e?.playerId ?? null,
        cueverseId: handle,
        // Suppressed when it merely repeats the handle: printing the same string twice is noise.
        preferredName: preferred && preferred.toLowerCase() !== handle.toLowerCase() ? preferred : null,
        headerLabel: cap(
          preferred && (preferredCounts.get(preferred.toLowerCase()) ?? 0) < 2 ? preferred : handle,
          HEADER_CAP,
        ),
        headerTitle: preferred && preferred.toLowerCase() !== handle.toLowerCase()
          ? `${handle} (${preferred})`
          : handle,
        slug: p?.cueverseId?.trim() || e?.playerId || s.slug,
        kickedOut: s.kickedOut,
        avatarUrl: p?.avatarFilename
          ? `/api/media/file/${p.avatarFilename}${p.avatarUpdatedAt ? `?v=${p.avatarUpdatedAt.getTime()}` : ''}`
          : null,
        avatarAnimated: isAnimated(p?.avatarFilename ?? null),
        accent: p?.profileTheme?.accent ?? null,
        monogram: monogramOf(handle),
        points: s.points, wins: s.wins, losses: s.losses, draws: s.draws, played: s.played,
        gamesWon: s.gamesWon, gamesLost: s.gamesLost,
        gamePct: total > 0 ? Math.round((s.gamesWon / total) * 100) : null,
        remaining: remainingBy.get(s.entrantId) ?? 0,
        clinch: v?.status ?? 'none',
        clinchedAt: clinchedAtBy.get(s.entrantId) ?? null,
        clinchShown: showsClinch({ clinch: v?.status ?? 'none', clinchedAt: clinchedAtBy.get(s.entrantId) ?? null }),
        cells: Object.fromEntries(
          ordered
            .filter((o) => o.entrantId !== s.entrantId)
            .map((o) => [o.entrantId, cells.get(`${s.entrantId}|${o.entrantId}`)
              ?? { kind: 'no-fixture' as const, mine: null, theirs: null, iForfeited: false, tone: null }]),
        ),
      }
    })

    return {
      id: g.id,
      code: g.code,
      name: g.name,
      players: boardPlayers,
      setsPlayed,
      setsTotal,
      percent: pct(setsPlayed, setsTotal),
      advancing,
      /*
        Clinched means proved NOW, or proved before and recorded.

        The union rather than the stored column alone, for two reasons. It keeps the guarantee that
        entering a further result cannot take a marker away — anything once written stays counted —
        while also letting a season that has never been recomputed since this feature shipped read
        correctly, without backfilling `clinchedAt` across historical rows that nobody asked us to
        touch. The individual markers below use the identical test, so a header count can never
        disagree with the locks under it.
      */
      clinched: boardPlayers.filter((p) => p.clinchShown).length,
    }
  })

  const setsPlayed = boardGroups.reduce((n, g) => n + g.setsPlayed, 0)
  const setsTotal = boardGroups.reduce((n, g) => n + g.setsTotal, 0)

  return {
    groups: boardGroups,
    totals: {
      entrants: boardGroups.reduce((n, g) => n + g.players.length, 0),
      groups: boardGroups.length,
      setsPlayed,
      setsTotal,
      percent: pct(setsPlayed, setsTotal),
      clinched: boardGroups.reduce((n, g) => n + g.clinched, 0),
    },
    gamesPerSet,
    advancement: seasonAdvancement(perGroup),
  }
}

/**
 * Board order: exactly the order the old matrix used, moved here unchanged.
 *
 * Points, then the engine's applied rank (which carries head-to-head, the one tiebreak that can only
 * be settled inside a group), then game win percentage, then the handle so two identical records
 * never swap between requests. The brief is explicit that presentation work must not touch the
 * ordering rules, so this is a relocation and not a rewrite.
 */
function orderRows(rows: StageStandingRow[]): StageStandingRow[] {
  return [...rows].sort((a, b) =>
    b.points - a.points
    || a.rank - b.rank
    || pctOf(b) - pctOf(a)
    || (a.cueverseId ?? a.username).toLowerCase().localeCompare((b.cueverseId ?? b.username).toLowerCase()))
}

/**
 * Whether this player's row shows the clinch lock.
 *
 * One predicate, used by the marker, the group header count and the season total, so the three can
 * never drift apart.
 */
export function showsClinch(p: Pick<BoardPlayer, 'clinch' | 'clinchedAt'>): boolean {
  return p.clinchedAt != null || isClinched(p.clinch)
}

const pctOf = (r: StageStandingRow) => (r.gamesWon + r.gamesLost === 0 ? 0 : r.gamesWon / (r.gamesWon + r.gamesLost))

/**
 * Write newly proved clinches, and — only when asked — clear ones that no longer hold.
 *
 * ── The asymmetry is the whole design ───────────────────────────────────────────────────────────
 * Entering the next result must never un-clinch anybody. If the arithmetic said a place was safe,
 * playing the remaining matches cannot make it unsafe, so a marker disappearing after a routine
 * score entry would mean the earlier claim was wrong — and a badge that comes and goes teaches
 * readers not to trust it.
 *
 * `allowRevoke` is for the other kind of change: history being EDITED rather than extended. A
 * completed result corrected, a match cleared, an entrant removed, the advancement count altered.
 * Those can genuinely invalidate a proof, and then the marker must go.
 */
export async function applyClinches(
  seasonId: number,
  groups: StageGroup[],
  opts: { allowRevoke?: boolean } = {},
): Promise<{ marked: number; revoked: number }> {
  let marked = 0
  let revoked = 0
  const now = new Date()

  /*
    The season's advancement count, read once.

    A clinch is a proof about a specific target — "this place cannot now be lost" is only meaningful
    against a stated top-N — so this must be the same number the cutoff line is drawn at. Raising it
    makes previously-proved places unproved, which is exactly why `recomputeSeasonStandings` passes
    `revalidateClinches` when the advancement count changes.
  */
  const season = await prisma.season.findUnique({
    where: { id: seasonId }, select: { qualifiersPerGroup: true },
  })
  const perGroup = season?.qualifiersPerGroup ?? null

  for (const g of groups) {
    const size = g.standings.length
    const advancing = advancingInGroup(size, perGroup)
    const remainingBy = new Map<number, number>()
    const scheduledBy = new Map<number, number>()
    for (const m of g.matches) {
      if (m.homeEntrantId == null || m.awayEntrantId == null) continue
      scheduledBy.set(m.homeEntrantId, (scheduledBy.get(m.homeEntrantId) ?? 0) + 1)
      scheduledBy.set(m.awayEntrantId, (scheduledBy.get(m.awayEntrantId) ?? 0) + 1)
      if (m.status === 'SCHEDULED') {
        remainingBy.set(m.homeEntrantId, (remainingBy.get(m.homeEntrantId) ?? 0) + 1)
        remainingBy.set(m.awayEntrantId, (remainingBy.get(m.awayEntrantId) ?? 0) + 1)
      }
    }
    const fullSlate = Math.max(0, ...g.standings.map((s) => scheduledBy.get(s.entrantId) ?? 0))

    const verdicts = computeClinches({
      rows: g.standings.map((s) => ({
        entrantId: s.entrantId,
        points: s.points, wins: s.wins, losses: s.losses, draws: s.draws, played: s.played,
        gamesWon: s.gamesWon, gamesLost: s.gamesLost,
        remaining: remainingBy.get(s.entrantId) ?? 0,
        rank: s.rank,
      })),
      advancing,
      pointsForWin: WIN_POINTS,
      pointsForDraw: DRAW_POINTS,
      completionBonus: COMPLETION_BONUS,
      fullSlate,
    })

    for (const v of verdicts) {
      const stored = await prisma.seasonStanding.findFirst({
        where: { seasonId, entrantId: v.entrantId },
        select: { id: true, clinchedAt: true },
      })
      if (!stored) continue
      const proven = isClinched(v.status)
      if (proven && stored.clinchedAt == null) {
        await prisma.seasonStanding.update({ where: { id: stored.id }, data: { clinchedAt: now } })
        marked++
      } else if (!proven && stored.clinchedAt != null && opts.allowRevoke) {
        await prisma.seasonStanding.update({ where: { id: stored.id }, data: { clinchedAt: null } })
        revoked++
      }
    }
  }
  return { marked, revoked }
}
