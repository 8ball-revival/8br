import type { CompetitionPlatform } from '@prisma/client'
import 'server-only'
import { prisma } from '@/lib/prisma'
import { ELO_START, ELO_K, expectedScore } from './elo'
import { TEAM_DELTA } from './rating-history'
import type { SeasonTrophyEntry } from '@/lib/seasons/trophies'

/**
 * LADDER / RANKINGS SERVICE — derives every ranking value from the `rating_ledger` (the persisted
 * per-match Elo record). Two views:
 *   - All-Time: aggregate the stored ledger directly (rating = latest post-rating, etc.).
 *   - Current:  a rolling 365-day view — replay Elo over only the matches completed in the last year
 *               (everyone re-starts at 1500 within the window).
 * Idle is always based on the player's latest completed match (any date). Rating never decays.
 */

const WINDOW_DAYS = 365
const DAY_MS = 86_400_000

export type LadderView = 'current' | 'all-time'

export interface TrophyEntry {
  tournamentId: number
  number: number | null
  name: string
  date: string | null // ISO close date
  slug: string // tournament page = /tournaments/<number>
}

export interface LadderRow {
  playerId: string
  name: string
  cueverseId: string | null
  slug: string | null // profile route param (null = no profile, e.g. unlinked handle)
  rank: number
  rating: number
  wins: number
  losses: number
  draws: number
  winPct: number // 0..100, one decimal
  streak: number // signed: + winning run, - losing run, 0 none
  trophies: TrophyEntry[]
  seasonTitles: SeasonTrophyEntry[] // Season Championships (glowing diamond), separate from trophies
  highestRank: number
  highestRating: number
  longestWinStreak: number
  idleDays: number | null // whole days since latest match; null = never played
}

// ---------------------------------------------------------------- raw ledger row (subset we read)
interface Row {
  tournamentId: number
  matchKey: string
  stage: string
  roundLabel: string | null
  playerId: string
  playerName: string
  opponentId: string | null
  opponentName: string
  isTeamMatch: boolean
  teamName: string | null
  opponentTeamName: string | null
  result: string // WIN | LOSS | DRAW
  isForfeit: boolean
  actual: number
  preRating: number
  ratingChange: number
  postRating: number
  sequence: number
  completedAt: Date
}

interface PlayerStats {
  playerId: string
  name: string
  rating: number
  wins: number
  losses: number
  draws: number
  singlesWins: number
  singlesLosses: number
  teamWins: number
  teamLosses: number
  streak: number
  longestWinStreak: number
  highestRating: number
  highestRank: number
  latestCompletedAt: Date | null
}

// ---------------------------------------------------------------- shared helpers
function trailingStreak(results: string[]): number {
  if (results.length === 0) return 0
  const last = results[results.length - 1]
  if (last === 'DRAW') return 0
  let n = 0
  for (let i = results.length - 1; i >= 0 && results[i] === last; i--) n++
  return last === 'WIN' ? n : -n
}
function longestWins(results: string[]): number {
  let best = 0, run = 0
  for (const r of results) { if (r === 'WIN') { run++; best = Math.max(best, run) } else run = 0 }
  return best
}
function winPct(w: number, l: number): number {
  const d = w + l
  return d === 0 ? 0 : Math.round((w / d) * 1000) / 10
}

/** Rank a set of {playerId, rating} snapshots and return each player's 1-based position. Ties broken by
 *  rating only here (used for the highest-rank replay — full tiebreakers apply to the final table). */
function rankSnapshot(entries: { playerId: string; rating: number }[]): Map<string, number> {
  const sorted = [...entries].sort((a, b) => b.rating - a.rating || (a.playerId < b.playerId ? -1 : 1))
  const m = new Map<string, number>()
  sorted.forEach((e, i) => m.set(e.playerId, i + 1))
  return m
}

// ---------------------------------------------------------------- All-Time (aggregate stored ledger)
function computeAllTime(rows: Row[]): Map<string, PlayerStats> {
  const byPlayer = new Map<string, Row[]>()
  for (const r of rows) (byPlayer.get(r.playerId) ?? byPlayer.set(r.playerId, []).get(r.playerId)!).push(r)

  const stats = new Map<string, PlayerStats>()
  for (const [pid, prs] of byPlayer) {
    prs.sort((a, b) => a.sequence - b.sequence)
    /*
     * A forfeit is not a competitive result.
     *
     * The row stays in the ledger — it is how the site can say afterwards that somebody forfeited,
     * and the Forfeits column counts exactly these — but it is excluded from every figure that
     * assumes the match was PLAYED. The opponent advanced because of the bracket, not because they
     * beat anybody: no win, no loss, no draw, no streak, and (already, via matchDeltas) no rating
     * movement. Counting it would let a player build a record out of matches nobody turned up to.
     */
    const played = prs.filter((r) => !r.isForfeit)
    const results = played.map((r) => r.result)
    const wins = results.filter((r) => r === 'WIN').length
    const losses = results.filter((r) => r === 'LOSS').length
    const draws = results.filter((r) => r === 'DRAW').length
    const singles = played.filter((r) => !r.isTeamMatch)
    const team = played.filter((r) => r.isTeamMatch)
    stats.set(pid, {
      playerId: pid,
      name: prs[prs.length - 1].playerName,
      rating: prs[prs.length - 1].postRating,
      wins, losses, draws,
      singlesWins: singles.filter((r) => r.result === 'WIN').length,
      singlesLosses: singles.filter((r) => r.result === 'LOSS').length,
      teamWins: team.filter((r) => r.result === 'WIN').length,
      teamLosses: team.filter((r) => r.result === 'LOSS').length,
      streak: trailingStreak(results),
      longestWinStreak: longestWins(results),
      highestRating: Math.max(ELO_START, ...prs.map((r) => r.postRating)),
      highestRank: Number.POSITIVE_INFINITY,
      latestCompletedAt: prs.reduce<Date | null>((m, r) => (m && m > r.completedAt ? m : r.completedAt), null),
    })
  }

  // Highest rank: walk the stored ledger in order, snapshot the ladder at each tournament boundary.
  const rating = new Map<string, number>()
  let lastTid: number | null = null
  const ordered = [...rows].sort((a, b) => a.sequence - b.sequence)
  const snapshot = () => {
    const ranks = rankSnapshot([...rating].map(([playerId, r]) => ({ playerId, rating: r })))
    for (const [pid, rk] of ranks) { const s = stats.get(pid); if (s) s.highestRank = Math.min(s.highestRank, rk) }
  }
  for (const r of ordered) {
    if (lastTid != null && r.tournamentId !== lastTid) snapshot()
    rating.set(r.playerId, r.postRating)
    lastTid = r.tournamentId
  }
  if (lastTid != null) snapshot()
  for (const s of stats.values()) if (!Number.isFinite(s.highestRank)) s.highestRank = 0
  return stats
}

// ---------------------------------------------------------------- Current (windowed Elo replay)
function computeCurrent(rows: Row[], cutoff: Date): Map<string, PlayerStats> {
  const windowed = rows.filter((r) => r.completedAt >= cutoff)
  // Group into matches, ordered by sequence.
  const byMatch = new Map<string, Row[]>()
  for (const r of windowed) (byMatch.get(r.matchKey) ?? byMatch.set(r.matchKey, []).get(r.matchKey)!).push(r)
  const matches = [...byMatch.values()].sort((a, b) => a[0].sequence - b[0].sequence)

  const rating = new Map<string, number>()
  const cur = (id: string) => rating.get(id) ?? ELO_START
  const perPlayerResults = new Map<string, string[]>()
  const highestRating = new Map<string, number>()
  const highestRank = new Map<string, number>()
  const name = new Map<string, string>()
  const latest = new Map<string, Date>()

  const push = (pid: string, res: string) => (perPlayerResults.get(pid) ?? perPlayerResults.set(pid, []).get(pid)!).push(res)
  let lastTid: number | null = null
  const snapshot = () => {
    const ranks = rankSnapshot([...rating].map(([playerId, r]) => ({ playerId, rating: r })))
    for (const [pid, rk] of ranks) highestRank.set(pid, Math.min(highestRank.get(pid) ?? Infinity, rk))
  }

  for (const m of matches) {
    if (lastTid != null && m[0].tournamentId !== lastTid) snapshot()
    lastTid = m[0].tournamentId
    // Sides: team matches group by team name; individual matches are one row per side.
    const isTeam = m[0].isTeamMatch
    const sides = isTeam
      ? [...new Set(m.map((r) => r.teamName))].map((tn) => m.filter((r) => r.teamName === tn))
      : m.map((r) => [r])
    if (sides.length !== 2) continue
    const [A, B] = sides
    const avg = (side: Row[]) => side.reduce((s, r) => s + cur(r.playerId), 0) / side.length
    const rA = avg(A), rB = avg(B)
    const actualA = A[0].actual
    const forfeit = m[0].isForfeit
    /*
     * Unrounded, and a fixed step for a team match.
     *
     * This used to be `Math.round(...)`, which made the running rating an integer at every step
     * while the ledger writer carries a fraction and rounds only when it stores a row. Over a few
     * hundred matches the two accumulate differently, and the difference surfaced as a one-point
     * disagreement between this ladder and the Rankings table for whoever sat near a boundary.
     *
     * See lib/stats/rating-history for the canonical rule; the arithmetic here is kept identical to
     * it deliberately, and `verify-rating-history` proves the two agree.
     */
    const dA = forfeit ? 0 : isTeam ? (actualA === 1 ? TEAM_DELTA : -TEAM_DELTA) : ELO_K * (actualA - expectedScore(rA, rB))
    const apply = (side: Row[], delta: number) => {
      for (const r of side) {
        name.set(r.playerId, r.playerName)
        // Same rule as All-Time: a forfeit moves nobody's W–L or streak. See computeAllTime.
        if (!forfeit) push(r.playerId, r.result)
        rating.set(r.playerId, cur(r.playerId) + delta)
        highestRating.set(r.playerId, Math.max(highestRating.get(r.playerId) ?? ELO_START, cur(r.playerId)))
        const prev = latest.get(r.playerId)
        if (!prev || r.completedAt > prev) latest.set(r.playerId, r.completedAt)
      }
    }
    apply(A, dA)
    apply(B, forfeit ? 0 : -dA)
  }
  if (lastTid != null) snapshot()

  const stats = new Map<string, PlayerStats>()
  for (const [pid, results] of perPlayerResults) {
    // The running figures are fractional until here; presentation is the only place they round.
    const wins = results.filter((r) => r === 'WIN').length
    const losses = results.filter((r) => r === 'LOSS').length
    const draws = results.filter((r) => r === 'DRAW').length
    // singles/team split for the window
    const wr = windowed.filter((r) => r.playerId === pid)
    stats.set(pid, {
      playerId: pid, name: name.get(pid) ?? pid, rating: Math.round(cur(pid)),
      wins, losses, draws,
      singlesWins: wr.filter((r) => !r.isForfeit && !r.isTeamMatch && r.result === 'WIN').length,
      singlesLosses: wr.filter((r) => !r.isForfeit && !r.isTeamMatch && r.result === 'LOSS').length,
      teamWins: wr.filter((r) => !r.isForfeit && r.isTeamMatch && r.result === 'WIN').length,
      teamLosses: wr.filter((r) => !r.isForfeit && r.isTeamMatch && r.result === 'LOSS').length,
      streak: trailingStreak(results),
      longestWinStreak: longestWins(results),
      highestRating: Math.round(highestRating.get(pid) ?? ELO_START),
      highestRank: highestRank.get(pid) ?? 0,
      latestCompletedAt: latest.get(pid) ?? null,
    })
  }
  return stats
}

// ---------------------------------------------------------------- identities + trophies
interface Identity { name: string; cueverseId: string | null; slug: string | null }
async function loadIdentities(playerIds: string[]): Promise<Map<string, Identity>> {
  const ids = playerIds.filter((id) => !id.startsWith('h:'))
  const players = ids.length ? await prisma.player.findMany({ where: { id: { in: ids } }, select: { id: true, primaryName: true, cueverseId: true } }) : []
  const map = new Map<string, Identity>()
  for (const p of players) map.set(p.id, { name: p.primaryName, cueverseId: p.cueverseId, slug: p.cueverseId ?? p.id })
  return map
}

/** Champion player(s) per completed tournament → trophies. Team win = a trophy for every roster member. */
async function computeTrophies(): Promise<Map<string, TrophyEntry[]>> {
  const tournaments = await prisma.tournament.findMany({
    where: { lifecycleState: 'COMPLETED' },
    select: { id: true, number: true, name: true, ladderAppliedAt: true, participantFormat: true },
  })
  const out = new Map<string, TrophyEntry[]>()
  const add = (pid: string, e: TrophyEntry) => (out.get(pid) ?? out.set(pid, []).get(pid)!).push(e)

  for (const t of tournaments) {
    // Champion registration = winner of the deepest decided playoff match; else top Swiss standing.
    const final = await prisma.playoffMatch.findFirst({
      where: { tournamentId: t.id, NOT: { winnerRegistrationId: null } },
      orderBy: [{ round: 'desc' }, { slot: 'desc' }],
      select: { winnerRegistrationId: true },
    })
    let championRegId = final?.winnerRegistrationId ?? null
    if (championRegId == null) {
      const { getSwissState } = await import('@/lib/competition/swiss')
      const swiss = await getSwissState(t.id).catch(() => null)
      championRegId = swiss?.standings?.[0]?.registrationId ?? null
    }
    if (championRegId == null) continue

    const entry: TrophyEntry = { tournamentId: t.id, number: t.number, name: t.name, date: t.ladderAppliedAt?.toISOString() ?? null, slug: `/tournaments/${t.number}` }
    if (t.participantFormat === 'TEAM') {
      const team = await prisma.tournamentTeam.findFirst({ where: { tournamentId: t.id, registrationId: championRegId }, include: { members: true } })
      for (const m of team?.members ?? []) if (m.playerId) add(m.playerId, entry)
    } else {
      const reg = await prisma.registration.findUnique({ where: { id: championRegId }, select: { playerId: true } })
      if (reg?.playerId) add(reg.playerId, entry)
    }
  }
  return out
}

// ---------------------------------------------------------------- public API

/**
 * Fold merged secondaries into their primary before anything is aggregated.
 *
 * The ledger records the player who actually played, which is right — a merge must not rewrite
 * history. But every total derived from it has to read under the canonical player, or a merged
 * account keeps its own ladder row next to the primary and the same person is ranked twice.
 *
 * Doing it here, at the one place the ladder loads its rows, is what stops the rankings, the
 * profile and the trophy lists from disagreeing.
 */
async function canonicalizeRows(rows: Row[]): Promise<Row[]> {
  const { resolveCanonicalPlayerIds } = await import('@/lib/players/merge')
  const canonical = await resolveCanonicalPlayerIds([...new Set(rows.map((r) => r.playerId))])
  return rows.map((r) => {
    const c = canonical.get(r.playerId)
    return c && c !== r.playerId ? { ...r, playerId: c } : r
  })
}

/** Re-key a per-player map onto canonical players, concatenating what merges bring together. */
async function canonicalizeByPlayer<T>(m: Map<string, T[]>): Promise<Map<string, T[]>> {
  if (m.size === 0) return m
  const { resolveCanonicalPlayerIds } = await import('@/lib/players/merge')
  const canonical = await resolveCanonicalPlayerIds([...m.keys()])
  const out = new Map<string, T[]>()
  for (const [pid, list] of m) {
    const c = canonical.get(pid) ?? pid
    const existing = out.get(c)
    if (existing) existing.push(...list)
    else out.set(c, [...list])
  }
  return out
}

async function loadRows(platform: CompetitionPlatform = 'CUEVERSE'): Promise<Row[]> {
  const rows = (await prisma.ratingLedger.findMany({ where: { platform }, orderBy: { sequence: 'asc' } })) as unknown as Row[]
  return canonicalizeRows(rows)
}

/** The ranked ladder for a view, sorted by Rating → Tournament Wins → Win% → Wins → Name. */
export async function getLadder(
  view: LadderView,
  now: Date = new Date(),
  /**
   * Which ladder. CueVerse by default, which is what makes the homepage and every unqualified call
   * site current rather than historical — an all-platforms ladder is not a thing that exists.
   */
  platform: CompetitionPlatform = 'CUEVERSE',
): Promise<LadderRow[]> {
  const rows = await loadRows(platform)
  if (rows.length === 0) return []
  const cutoff = new Date(now.getTime() - WINDOW_DAYS * DAY_MS)
  const stats = view === 'current' ? computeCurrent(rows, cutoff) : computeAllTime(rows)
  const allTimeLatest = computeLatestByPlayer(rows) // idle always from latest match ever
  const identities = await loadIdentities([...stats.keys()])
  // Titles follow the same rule as the results: a primary inherits what its secondaries won.
  const trophies = await canonicalizeByPlayer(await computeTrophies())
  const { computeSeasonTrophies } = await import('@/lib/seasons/trophies')
  const seasonTrophies = await canonicalizeByPlayer(await computeSeasonTrophies())

  const list: LadderRow[] = [...stats.values()].map((s) => {
    const idn = identities.get(s.playerId)
    const allTrophies = trophies.get(s.playerId) ?? []
    const viewTrophies = view === 'current' ? allTrophies.filter((tr) => tr.date != null && new Date(tr.date) >= cutoff) : allTrophies
    const allSeasons = seasonTrophies.get(s.playerId) ?? []
    const viewSeasons = view === 'current' ? allSeasons.filter((tr) => tr.date != null && new Date(tr.date) >= cutoff) : allSeasons
    const latest = allTimeLatest.get(s.playerId) ?? null
    return {
      playerId: s.playerId,
      name: idn?.name ?? s.name,
      cueverseId: idn?.cueverseId ?? null,
      slug: idn?.slug ?? null,
      rank: 0,
      rating: Math.round(s.rating),
      wins: s.wins,
      losses: s.losses,
      draws: s.draws,
      winPct: winPct(s.wins, s.losses),
      streak: s.streak,
      trophies: viewTrophies.sort((a, b) => (a.date ?? '').localeCompare(b.date ?? '')),
      seasonTitles: viewSeasons.sort((a, b) => (a.date ?? '').localeCompare(b.date ?? '')),
      highestRank: s.highestRank,
      highestRating: Math.round(s.highestRating),
      longestWinStreak: s.longestWinStreak,
      idleDays: latest ? Math.floor((now.getTime() - latest.getTime()) / DAY_MS) : null,
    }
  })

  list.sort((a, b) =>
    b.rating - a.rating ||
    b.trophies.length - a.trophies.length ||
    b.winPct - a.winPct ||
    b.wins - a.wins ||
    a.name.toLowerCase().localeCompare(b.name.toLowerCase()),
  )
  list.forEach((r, i) => (r.rank = i + 1))
  return list
}

function computeLatestByPlayer(rows: Row[]): Map<string, Date> {
  const m = new Map<string, Date>()
  for (const r of rows) { const prev = m.get(r.playerId); if (!prev || r.completedAt > prev) m.set(r.playerId, r.completedAt) }
  return m
}

// ---------------------------------------------------------------- player profile
export interface ProfileMatch {
  tournamentId: number
  tournamentName: string
  tournamentNumber: number | null
  date: string | null
  stage: string
  roundLabel: string | null
  opponentName: string
  isTeamMatch: boolean
  score: string | null
  status: 'WIN' | 'LOSS' | 'DRAW' | 'FORFEIT'
  preRating: number
  ratingChange: number
  postRating: number
  link: string
}
export interface ProfileTournament {
  tournamentId: number
  name: string
  number: number | null
  date: string | null
  format: string | null
  participantFormat: string
  teamName: string | null
  wins: number
  losses: number
  draws: number
  ratingChange: number
  wonTournament: boolean
  placement: string | null
  link: string
}
export interface PlayerProfile {
  playerId: string
  name: string
  cueverseId: string | null
  allTime: LadderRow | null
  current: LadderRow | null
  tournamentsPlayed: number
  bestFinish: string | null
  tournaments: ProfileTournament[]
  matches: ProfileMatch[]
}

/** Load the completed match scores for a set of ledger match keys, as "player-first" strings. */
async function scoresForKeys(keys: string[]): Promise<Map<string, [number, number]>> {
  const groupIds: number[] = [], playoffIds: number[] = [], swissIds: number[] = []
  for (const k of keys) {
    const [t, idStr] = k.split(':'); const id = Number(idStr)
    if (t === 'group') groupIds.push(id); else if (t === 'playoff') playoffIds.push(id); else if (t === 'swiss') swissIds.push(id)
  }
  const out = new Map<string, [number, number]>()
  if (groupIds.length) for (const m of await prisma.tournamentMatch.findMany({ where: { id: { in: groupIds } }, select: { id: true, homeGames: true, awayGames: true } })) out.set(`group:${m.id}`, [m.homeGames ?? 0, m.awayGames ?? 0])
  if (playoffIds.length) for (const m of await prisma.playoffMatch.findMany({ where: { id: { in: playoffIds } }, select: { id: true, homeGames: true, awayGames: true } })) out.set(`playoff:${m.id}`, [m.homeGames ?? 0, m.awayGames ?? 0])
  if (swissIds.length) for (const m of await prisma.swissMatch.findMany({ where: { id: { in: swissIds } }, select: { id: true, homeGames: true, awayGames: true } })) out.set(`swiss:${m.id}`, [m.homeGames ?? 0, m.awayGames ?? 0])
  return out
}

/** Full competitive profile for one player (resolved by Player.id or CueVerse ID). */
export async function getPlayerProfile(
  param: string,
  now: Date = new Date(),
  /**
   * Which career is being read.
   *
   * A player has one identity and two records. Reading them together would produce a rating that is
   * neither — so the profile asks for one platform at a time, and the page offers both.
   */
  platform: CompetitionPlatform = 'CUEVERSE',
): Promise<PlayerProfile | null> {
  const player = await prisma.player.findFirst({
    where: { OR: [{ id: param }, { cueverseId: { equals: param, mode: 'insensitive' } }] },
    select: { id: true, primaryName: true, cueverseId: true },
  })
  if (!player) return null

  // Roll up any accounts merged into this one: their ledger rows are read under the primary so a
  // merged player's history appears here rather than being stranded on a hidden profile.
  const { expandCanonicalPlayerIds } = await import('@/lib/players/merge')
  const playerIds = await expandCanonicalPlayerIds(player.id)

  const rows = (await prisma.ratingLedger.findMany({ where: { playerId: { in: playerIds }, platform }, orderBy: { sequence: 'asc' } })) as unknown as Row[]
  const [allTimeLadder, currentLadder] = await Promise.all([getLadder('all-time', now), getLadder('current', now)])
  const allTime = allTimeLadder.find((r) => playerIds.includes(r.playerId)) ?? null
  const current = currentLadder.find((r) => playerIds.includes(r.playerId)) ?? null
  const trophyTids = new Set((allTime?.trophies ?? []).map((t) => t.tournamentId))

  // Season ledger rows carry seasonId, not tournamentId, so nulls are legitimate here and must be
  // filtered out — passing one into `in` is a query error.
  const tids = [...new Set(rows.map((r) => r.tournamentId))].filter((id): id is number => id != null)
  const tournaments = tids.length ? await prisma.tournament.findMany({ where: { id: { in: tids } }, select: { id: true, number: true, name: true, ladderAppliedAt: true, tournamentFormat: true, participantFormat: true } }) : []
  const tById = new Map(tournaments.map((t) => [t.id, t]))
  const scores = await scoresForKeys(rows.map((r) => r.matchKey))

  const scoreStr = (r: Row): string | null => {
    if (r.isForfeit) return 'FF'
    const g = scores.get(r.matchKey); if (!g) return null
    const hi = Math.max(g[0], g[1]), lo = Math.min(g[0], g[1])
    return r.result === 'LOSS' ? `${lo}–${hi}` : `${hi}–${lo}`
  }

  const matches: ProfileMatch[] = [...rows].sort((a, b) => b.sequence - a.sequence).map((r) => {
    const t = tById.get(r.tournamentId)
    return {
      tournamentId: r.tournamentId, tournamentName: t?.name ?? `Tournament ${r.tournamentId}`, tournamentNumber: t?.number ?? null,
      date: r.completedAt.toISOString(), stage: r.stage, roundLabel: r.roundLabel,
      opponentName: r.isTeamMatch ? r.opponentTeamName ?? r.opponentName : r.opponentName,
      isTeamMatch: r.isTeamMatch, score: scoreStr(r),
      status: r.isForfeit ? 'FORFEIT' : (r.result as 'WIN' | 'LOSS' | 'DRAW'),
      preRating: r.preRating, ratingChange: r.ratingChange, postRating: r.postRating,
      link: t?.number != null ? `/tournaments/${t.number}` : '#',
    }
  })

  // Per-tournament summary (newest first).
  const byTid = new Map<number, Row[]>()
  for (const r of rows) (byTid.get(r.tournamentId) ?? byTid.set(r.tournamentId, []).get(r.tournamentId)!).push(r)
  const tournamentsOut: ProfileTournament[] = [...byTid.entries()].map(([tid, prs]) => {
    const t = tById.get(tid)
    const won = trophyTids.has(tid)
    return {
      tournamentId: tid, name: t?.name ?? `Tournament ${tid}`, number: t?.number ?? null,
      date: t?.ladderAppliedAt?.toISOString() ?? null, format: t?.tournamentFormat ?? null, participantFormat: t?.participantFormat ?? 'INDIVIDUAL',
      teamName: prs.find((r) => r.teamName)?.teamName ?? null,
      wins: prs.filter((r) => r.result === 'WIN').length,
      losses: prs.filter((r) => r.result === 'LOSS').length,
      draws: prs.filter((r) => r.result === 'DRAW').length,
      ratingChange: prs.reduce((s, r) => s + r.ratingChange, 0),
      wonTournament: won, placement: won ? 'Champion' : null,
      link: t?.number != null ? `/tournaments/${t.number}` : '#',
    }
  }).sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))

  return {
    playerId: player.id, name: player.primaryName, cueverseId: player.cueverseId,
    allTime, current, tournamentsPlayed: tids.length,
    bestFinish: tournamentsOut.some((t) => t.wonTournament) ? 'Champion' : (tournamentsOut.length ? '—' : null),
    tournaments: tournamentsOut, matches,
  }
}


/**
 * The history that ranks nothing.
 *
 * Division B is recorded in full — entrants, groups, matches, playoffs, champions — and reaches no
 * ladder, so none of it appears in a ledger and none of it can be read from one. It is queried from
 * the Season records themselves, and shown under its own heading so it is never mistaken for a
 * contribution to a rating.
 */
export interface UnrankedHistoryRow {
  seasonId: number
  competitionYear: number
  number: number
  division: string | null
  lifecycleState: string
  isChampion: boolean
}

export async function getUnrankedHistory(playerParam: string): Promise<UnrankedHistoryRow[]> {
  const player = await prisma.player.findFirst({
    where: { OR: [{ id: playerParam }, { cueverseId: { equals: playerParam, mode: 'insensitive' } }] },
    select: { id: true, cueverseId: true },
  })
  if (!player) return []
  const { expandCanonicalPlayerIds } = await import('@/lib/players/merge')
  const ids = await expandCanonicalPlayerIds(player.id)

  const entries = await prisma.seasonEntrant.findMany({
    where: { playerId: { in: ids }, season: { countsTowardRankings: false } },
    select: {
      season: {
        select: {
          id: true, competitionYear: true, number: true, division: true,
          lifecycleState: true, championName: true,
        },
      },
    },
    orderBy: { season: { competitionYear: 'desc' } },
  })

  return entries.map((e) => ({
    seasonId: e.season.id,
    competitionYear: e.season.competitionYear,
    number: e.season.number,
    division: e.season.division,
    lifecycleState: String(e.season.lifecycleState),
    // Compared on the stored champion label; an unranked Season still has a champion worth showing.
    isChampion: !!e.season.championName && e.season.championName === player.cueverseId,
  }))
}
