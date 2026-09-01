import 'server-only'
import { prisma } from '@/lib/prisma'
import type { CompetitionPlatform } from '@prisma/client'
import { getLadder, type LadderRow } from '@/lib/stats/ladder'

/**
 * Everything one player's profile shows, read from the records that already exist.
 *
 * ── The rule this file is built around ──────────────────────────────────────────────────────────
 * A statistic is only ever the sum of matches that happened. The Rating Ledger holds one row per
 * player per completed, rated match — opponent, stage, round, result, the rating before and after —
 * and that is the sole source of every W-L-D, percentage, streak and rating change here. Nothing is
 * estimated, back-filled or inferred from a placing.
 *
 * ── Playing in a Season is not the same as having a record in it ────────────────────────────────
 * The archive contains people who were entered into a Season whose matches were never recorded.
 * They are on the roster and they are not in the ledger. Giving them a 0-0 record would state that
 * they played nothing, which is a claim the archive does not support and is usually false — the
 * matches are missing, not the games.
 *
 * So a Season a player appears in comes back in one of two conditions, and the profile says which:
 *
 *   'verified'    — matches are recorded, and every figure is computed from them.
 *   'roster-only' — they were entered, nothing else survives, and no record is offered at all.
 *
 * There are 35 such entries in the current archive. They are not errors and they are not hidden.
 */

export type Participation = 'verified' | 'roster-only'

export interface ProfileIdentity {
  playerId: string
  /** Every id whose history belongs to this profile: this player plus anything merged into them. */
  playerIds: string[]
  name: string
  cueverseId: string | null
  /** The account's own display/real name, when they have set one and it differs from the handle. */
  displayName: string | null
  aliases: string[]
  /** The route parameter this profile lives at. */
  slug: string
  /** Payload user id of the account that owns this profile, when one is linked and confirmed. */
  ownerUserId: string | null
}

export interface StageRecord { wins: number; losses: number; draws: number }

export interface ProfileMatchRow {
  /** Ledger sequence — the deterministic all-time order. */
  sequence: number
  at: string
  competitionLabel: string
  competitionHref: string | null
  kind: 'season' | 'tournament'
  stage: 'GROUP' | 'PLAYOFF' | string
  roundLabel: string | null
  opponentName: string
  opponentHref: string | null
  isTeamMatch: boolean
  teamName: string | null
  /** "7–3", player's games first, or null when the frames were not recorded. */
  score: string | null
  result: 'WIN' | 'LOSS' | 'DRAW'
  isForfeit: boolean
  ratingChange: number
  ratingAfter: number
}

export interface SeasonEntry {
  seasonId: number
  participation: Participation
  /** "8BR Season 12", from the Competition and the Season number. */
  name: string
  competition: string
  year: number
  status: string
  division: string | null
  platform: string
  href: string
  /** Champion / Runner-up / a round name, when the records say. Null when they do not. */
  placement: string | null
  isChampion: boolean
  isRunnerUp: boolean
  /* Every figure below is null for a roster-only season. */
  record: StageRecord | null
  winPct: number | null
  groupRecord: StageRecord | null
  playoffRecord: StageRecord | null
  /** Deepest playoff round the round labels show for this Season. */
  playoffFinish: string | null
  /** Group placing, when the Season's group stage recorded one for them. */
  groupFinish: string | null
  ratingChange: number | null
  ratingBefore: number | null
  ratingAfter: number | null
  matchesPlayed: number
  gamesWon: number | null
  gamesLost: number | null
  /** Games are only known for matches whose frames were recorded; below `matchesPlayed` means partial. */
  matchesWithGameData: number
  bestWinStreak: number | null
  matches: ProfileMatchRow[]
}

export interface TournamentEntry {
  tournamentId: number
  participation: Participation
  name: string
  competition: string
  year: number | null
  status: string
  format: string | null
  participantFormat: string
  teamName: string | null
  teammates: string[]
  href: string
  placement: string | null
  isChampion: boolean
  record: StageRecord | null
  winPct: number | null
  /** The rounds they appeared in, earliest first — a bracket path where a bracket exists. */
  path: { round: string; result: 'WIN' | 'LOSS' | 'DRAW'; opponent: string }[]
  ratingChange: number | null
  matchesPlayed: number
  matches: ProfileMatchRow[]
}

export interface ProfileAchievement {
  id: string
  title: string
  caption: string
  stat: string
  detail: string
  /** 'award' = one of the computed Achievements. The others are trophies the records hold. */
  kind: 'award' | 'season-title' | 'tournament-title'
  href: string | null
  /** Year or date line, when the source carries one. */
  when: string | null
}

export interface ProfileCareer {
  record: StageRecord
  winPct: number
  matchesPlayed: number
  groupRecord: StageRecord
  playoffRecord: StageRecord
  seasonsPlayed: number
  seasonsRostered: number
  tournamentsPlayed: number
  seasonTitles: number
  tournamentTitles: number
  currentStreak: number
  longestWinStreak: number
}

export interface HeadToHeadRow {
  /** The opponent's player id when the archive resolved one, so the row can link to their profile. */
  opponentId: string | null
  opponentName: string
  wins: number
  losses: number
  draws: number
  played: number
  winPct: number
  /** ISO date of the most recent meeting. */
  lastMet: string
  /** Where they last met, for context on an old rivalry. */
  lastCompetition: string
}

export interface PlayerProfilePage {
  identity: ProfileIdentity
  current: LadderRow | null
  allTime: LadderRow | null
  career: ProfileCareer
  seasons: SeasonEntry[]
  tournaments: TournamentEntry[]
  achievements: ProfileAchievement[]
  headToHead: HeadToHeadRow[]
  /** Every verified match, newest first — the Match History tab. */
  matches: ProfileMatchRow[]
}

const emptyRecord = (): StageRecord => ({ wins: 0, losses: 0, draws: 0 })
const played = (r: StageRecord) => r.wins + r.losses + r.draws
const pct = (r: StageRecord) => {
  const n = played(r)
  // Draws sit in the denominator: they are matches, and dropping them would inflate the percentage
  // of anyone who drew. One decimal, matching the Rankings ladder.
  return n === 0 ? 0 : Math.round((r.wins / n) * 1000) / 10
}

/** Count a result into a record, in one place so group/playoff/career cannot diverge. */
function tally(into: StageRecord, result: string): void {
  if (result === 'WIN') into.wins += 1
  else if (result === 'LOSS') into.losses += 1
  else if (result === 'DRAW') into.draws += 1
}

/**
 * The longest run of wins inside a set of results, in ledger order.
 *
 * A draw breaks a winning run rather than extending it — it is not a win — and so does a loss.
 */
function longestWinRun(results: string[]): number {
  let best = 0, run = 0
  for (const r of results) {
    if (r === 'WIN') { run += 1; best = Math.max(best, run) } else run = 0
  }
  return best
}

/** Who this profile belongs to, including anything merged into it. */
export async function getProfileIdentity(param: string): Promise<ProfileIdentity | null> {
  const player = await prisma.player.findFirst({
    where: { OR: [{ id: param }, { cueverseId: { equals: param, mode: 'insensitive' } }] },
    select: { id: true, primaryName: true, cueverseId: true, linkedUserId: true, linkStatus: true },
  })
  if (!player) return null

  const { expandCanonicalPlayerIds } = await import('@/lib/players/merge')
  const playerIds = await expandCanonicalPlayerIds(player.id)

  const aliasRows = await prisma.playerAlias.findMany({
    where: { playerId: { in: playerIds } },
    select: { alias: true, aliasDisplay: true },
    orderBy: { createdAt: 'desc' },
  })
  const seen = new Set<string>()
  const aliases: string[] = []
  for (const a of aliasRows) {
    const shown = (a.aliasDisplay ?? a.alias).trim()
    const key = shown.toLowerCase()
    if (!shown || seen.has(key)) continue
    seen.add(key)
    aliases.push(shown)
  }

  /*
    The handle leads, site-wide.

    `cueverseId` is the competitive identity every other surface shows; `primaryName` is the name
    behind it. Presenting them the other way round would make this the one page on the site where a
    player is somebody else.
  */
  const handle = (player.cueverseId ?? '').trim()
  const real = (player.primaryName ?? '').trim()
  const name = handle || real || 'Unnamed player'
  return {
    playerId: player.id,
    playerIds,
    name,
    cueverseId: player.cueverseId,
    // Only when it says something the handle does not; repeating the handle underneath is noise.
    displayName: real && real.toLowerCase() !== name.toLowerCase() ? real : null,
    aliases: aliases.slice(0, 8),
    slug: player.cueverseId ?? player.id,
    // VERIFIED is the only status that proves ownership. PENDING is a claim, not a link, and
    // REJECTED and REVOKED are the site saying no — none of them may unlock an edit control.
    ownerUserId: player.linkStatus === 'VERIFIED' && player.linkedUserId ? player.linkedUserId : null,
  }
}

/** Ledger rows for this profile, oldest first — the order every streak and progression depends on. */
async function ledgerRows(playerIds: string[], platform: CompetitionPlatform | undefined) {
  return prisma.ratingLedger.findMany({
    where: { playerId: { in: playerIds }, ...(platform ? { platform } : {}) },
    orderBy: { sequence: 'asc' },
    select: {
      sequence: true, seasonId: true, tournamentId: true, matchKey: true,
      stage: true, roundLabel: true, opponentId: true, opponentName: true,
      isTeamMatch: true, teamName: true, opponentTeamName: true,
      result: true, isForfeit: true, ratingChange: true, preRating: true, postRating: true,
      completedAt: true, platform: true,
    },
  })
}

/**
 * Frames for a set of ledger rows, keyed the way the ledger keys a match.
 *
 * The ledger records who won; the frames live on the match itself. A match whose games were never
 * entered has no score, and the profile shows a dash rather than 0–0 — which would be a result.
 */
async function scoresFor(matchKeys: string[]): Promise<Map<string, [number, number]>> {
  const group: number[] = [], playoff: number[] = [], swiss: number[] = []
  for (const key of matchKeys) {
    const [kind, idText] = key.split(':')
    const id = Number(idText)
    if (!Number.isFinite(id)) continue
    if (kind === 'group') group.push(id)
    else if (kind === 'playoff') playoff.push(id)
    else if (kind === 'swiss') swiss.push(id)
  }
  const out = new Map<string, [number, number]>()
  const sel = { id: true, homeGames: true, awayGames: true } as const
  if (group.length) for (const m of await prisma.tournamentMatch.findMany({ where: { id: { in: group } }, select: sel })) {
    if (m.homeGames != null && m.awayGames != null) out.set(`group:${m.id}`, [m.homeGames, m.awayGames])
  }
  if (playoff.length) for (const m of await prisma.playoffMatch.findMany({ where: { id: { in: playoff } }, select: sel })) {
    if (m.homeGames != null && m.awayGames != null) out.set(`playoff:${m.id}`, [m.homeGames, m.awayGames])
  }
  if (swiss.length) for (const m of await prisma.swissMatch.findMany({ where: { id: { in: swiss } }, select: sel })) {
    if (m.homeGames != null && m.awayGames != null) out.set(`swiss:${m.id}`, [m.homeGames, m.awayGames])
  }
  return out
}

/**
 * How deep a playoff round is, so "deepest reached" can be decided rather than guessed.
 *
 * Higher is later. Anything unrecognised returns null and is simply not considered — inventing an
 * ordering for a label nobody has seen would silently rank it against real rounds.
 */
function roundRank(label: string | null | undefined): { rank: number; name: string } | null {
  const l = (label ?? '').toLowerCase()
  if (!l) return null
  if (l.includes('grand final')) return { rank: 100, name: 'Grand Final' }
  if (l.includes('final') && !l.includes('semi') && !l.includes('quarter')) return { rank: 90, name: 'Final' }
  if (l.includes('semi')) return { rank: 80, name: 'Semifinal' }
  if (l.includes('quarter')) return { rank: 70, name: 'Quarterfinal' }
  const round = /round\s*(\d+)/.exec(l)
  if (round) return { rank: Number(round[1]), name: `Round ${round[1]}` }
  return null
}

/** A player-first score string, or null when the frames were not recorded. */
function scoreString(games: [number, number] | undefined, result: string, isForfeit: boolean): string | null {
  if (isForfeit) return 'FF'
  if (!games) return null
  const hi = Math.max(games[0], games[1]), lo = Math.min(games[0], games[1])
  if (result === 'DRAW') return `${games[0]}–${games[1]}`
  return result === 'LOSS' ? `${lo}–${hi}` : `${hi}–${lo}`
}

type LedgerRow = Awaited<ReturnType<typeof ledgerRows>>[number]

/**
 * The whole profile, in one pass over the ledger.
 *
 * One read of the ledger, one of the Seasons, one of the Tournaments, one of the rosters, then pure
 * grouping. A per-season query would be forty round trips for a player with a long career.
 */
export async function getPlayerProfilePage(
  param: string,
  platform: CompetitionPlatform | undefined = undefined,
  now: Date = new Date(),
): Promise<PlayerProfilePage | null> {
  const identity = await getProfileIdentity(param)
  if (!identity) return null

  const rows = await ledgerRows(identity.playerIds, platform)
  const seasonIds = [...new Set(rows.map((r) => r.seasonId).filter((v): v is number => v != null))]
  const tournamentIds = [...new Set(rows.map((r) => r.tournamentId).filter((v): v is number => v != null))]

  const [entrantRows, ladderCurrent, ladderAll, scores] = await Promise.all([
    prisma.seasonEntrant.findMany({
      where: { playerId: { in: identity.playerIds } },
      select: { seasonId: true, qualification: true, playoffSeed: true, seed: true },
    }),
    getLadder('current', now),
    getLadder('all-time', now),
    scoresFor(rows.map((r) => r.matchKey)),
  ])

  const rosterSeasonIds = entrantRows.map((e) => e.seasonId)
  const allSeasonIds = [...new Set([...seasonIds, ...rosterSeasonIds])]

  const [seasonRecords, tournamentRecords] = await Promise.all([
    allSeasonIds.length
      ? prisma.season.findMany({
        where: { id: { in: allSeasonIds } },
        select: {
          id: true, number: true, competitionYear: true, lifecycleState: true, subtitle: true,
          division: true, platform: true, championPlayerId: true,
          competitionSeries: { select: { name: true } },
        },
      })
      : [],
    tournamentIds.length
      ? prisma.tournament.findMany({
        where: { id: { in: tournamentIds } },
        select: {
          id: true, number: true, name: true, status: true, tournamentFormat: true,
          participantFormat: true, ladderAppliedAt: true, createdAt: true,
        },
      })
      : [],
  ])
  const seasonById = new Map(seasonRecords.map((s) => [s.id, s]))
  const tournamentById = new Map(tournamentRecords.map((t) => [t.id, t]))

  const current = ladderCurrent.find((r) => identity.playerIds.includes(r.playerId)) ?? null
  const allTime = ladderAll.find((r) => identity.playerIds.includes(r.playerId)) ?? null

  /*
    Championship comes from the Season's own `championPlayerId`, not from a name or a placing.

    The ladder's trophy list carries a title string and a slug rather than an id, and matching a
    Season by parsing its own link back out of a URL is the kind of thing that works until a route
    changes. The Season record already says who won it.
  */
  const seasonTitleIds = new Set(
    seasonRecords.filter((s) => s.championPlayerId && identity.playerIds.includes(s.championPlayerId)).map((s) => s.id),
  )
  const trophyTournamentIds = new Set((allTime?.trophies ?? []).map((t) => t.tournamentId))

  const seasonLabel = (s: NonNullable<ReturnType<typeof seasonById.get>>) =>
    `${s.competitionSeries?.name ?? 'Season'} ${s.number}`

  const matchRow = (r: LedgerRow): ProfileMatchRow => {
    const season = r.seasonId != null ? seasonById.get(r.seasonId) : undefined
    const tournament = r.tournamentId != null ? tournamentById.get(r.tournamentId) : undefined
    const label = season ? `${seasonLabel(season)} · ${season.competitionYear}`
      : tournament ? tournament.name
        : 'Unrecorded competition'
    const href = season ? `/seasons/${season.id}`
      : tournament?.number != null ? `/tournaments/${tournament.number}`
        : null
    return {
      sequence: r.sequence,
      at: r.completedAt.toISOString(),
      competitionLabel: label,
      competitionHref: href,
      kind: r.seasonId != null ? 'season' : 'tournament',
      stage: r.stage,
      roundLabel: r.roundLabel,
      opponentName: r.isTeamMatch ? (r.opponentTeamName ?? r.opponentName) : r.opponentName,
      // Only a resolved opponent gets a link; a raw archive handle has no profile to point at.
      opponentHref: r.opponentId ? `/players/${encodeURIComponent(r.opponentId)}` : null,
      isTeamMatch: r.isTeamMatch,
      teamName: r.teamName,
      score: scoreString(scores.get(r.matchKey), r.result, r.isForfeit),
      result: r.result as 'WIN' | 'LOSS' | 'DRAW',
      isForfeit: r.isForfeit,
      ratingChange: r.ratingChange,
      ratingAfter: r.postRating,
    }
  }

  // ── Seasons ───────────────────────────────────────────────────────────────────────────────────
  const rowsBySeason = new Map<number, LedgerRow[]>()
  for (const r of rows) {
    if (r.seasonId == null) continue
    const list = rowsBySeason.get(r.seasonId) ?? []
    list.push(r)
    rowsBySeason.set(r.seasonId, list)
  }

  const seasons: SeasonEntry[] = allSeasonIds.map((id) => {
    const s = seasonById.get(id)
    const mine = rowsBySeason.get(id) ?? []
    const isChampion = seasonTitleIds.has(id)
    const base = {
      seasonId: id,
      name: s ? seasonLabel(s) : `Season ${id}`,
      competition: s?.competitionSeries?.name ?? 'Season',
      year: s?.competitionYear ?? 0,
      status: s?.lifecycleState ?? 'UNKNOWN',
      division: s?.division ?? null,
      platform: s?.platform ?? 'CUEVERSE',
      href: `/seasons/${id}`,
      isChampion,
      isRunnerUp: false,
    }

    if (mine.length === 0) {
      /*
        Entered, nothing recorded. Every figure stays null so no reader and no later computation can
        mistake an absent record for a played-nothing record.
      */
      return {
        ...base,
        participation: 'roster-only' as const,
        placement: isChampion ? 'Champion' : null,
        record: null, winPct: null, groupRecord: null, playoffRecord: null,
        playoffFinish: null, groupFinish: null,
        ratingChange: null, ratingBefore: null, ratingAfter: null,
        matchesPlayed: 0, gamesWon: null, gamesLost: null, matchesWithGameData: 0,
        bestWinStreak: null, matches: [],
      }
    }

    const record = emptyRecord(), group = emptyRecord(), playoff = emptyRecord()
    let gamesWon = 0, gamesLost = 0, withGames = 0
    let deepest: { rank: number; name: string } | null = null
    for (const r of mine) {
      tally(record, r.result)
      tally(r.stage === 'PLAYOFF' ? playoff : group, r.result)
      const g = scores.get(r.matchKey)
      if (g) {
        withGames += 1
        // The ledger row is written from this player's side, so "home" is not necessarily them.
        const [a, b] = g
        const mineGames = r.result === 'LOSS' ? Math.min(a, b) : Math.max(a, b)
        gamesWon += mineGames
        gamesLost += a + b - mineGames
      }
      if (r.stage === 'PLAYOFF') {
        const rank = roundRank(r.roundLabel)
        if (rank && (!deepest || rank.rank > deepest.rank)) deepest = rank
      }
    }

    const first = mine[0], last = mine[mine.length - 1]
    return {
      ...base,
      participation: 'verified' as const,
      placement: isChampion ? 'Champion' : (deepest ? `${deepest.name}` : null),
      record, winPct: pct(record),
      groupRecord: group, playoffRecord: playoff,
      playoffFinish: isChampion ? 'Champion' : (deepest?.name ?? null),
      // The group table decides a group placing, and it is not derivable from one player's rows.
      groupFinish: null,
      ratingChange: mine.reduce((sum, r) => sum + r.ratingChange, 0),
      ratingBefore: first.preRating,
      ratingAfter: last.postRating,
      matchesPlayed: mine.length,
      gamesWon: withGames > 0 ? gamesWon : null,
      gamesLost: withGames > 0 ? gamesLost : null,
      matchesWithGameData: withGames,
      bestWinStreak: longestWinRun(mine.map((r) => r.result)),
      matches: mine.map(matchRow).reverse(),
    }
  }).sort((a, b) => (b.year - a.year) || (b.seasonId - a.seasonId))

  // ── Tournaments ───────────────────────────────────────────────────────────────────────────────
  const rowsByTournament = new Map<number, LedgerRow[]>()
  for (const r of rows) {
    if (r.tournamentId == null) continue
    const list = rowsByTournament.get(r.tournamentId) ?? []
    list.push(r)
    rowsByTournament.set(r.tournamentId, list)
  }

  const tournaments: TournamentEntry[] = [...rowsByTournament.entries()].map(([id, mine]) => {
    const t = tournamentById.get(id)
    const record = emptyRecord()
    for (const r of mine) tally(record, r.result)
    const isChampion = trophyTournamentIds.has(id)
    const teamName = mine.find((r) => r.teamName)?.teamName ?? null
    return {
      tournamentId: id,
      participation: 'verified' as const,
      name: t?.name ?? `Tournament ${id}`,
      competition: t?.name ?? 'Tournament',
      year: (t?.ladderAppliedAt ?? t?.createdAt)?.getFullYear() ?? null,
      status: t?.status ?? 'UNKNOWN',
      format: t?.tournamentFormat ?? null,
      participantFormat: t?.participantFormat ?? 'INDIVIDUAL',
      teamName,
      // Filled below from the roster; a team's members are not in one player's ledger rows.
      teammates: [],
      href: t?.number != null ? `/tournaments/${t.number}` : '#',
      placement: isChampion ? 'Champion' : null,
      isChampion,
      record, winPct: pct(record),
      path: mine
        .filter((r) => r.stage === 'PLAYOFF' && r.roundLabel)
        .map((r) => ({
          round: r.roundLabel as string,
          result: r.result as 'WIN' | 'LOSS' | 'DRAW',
          opponent: r.isTeamMatch ? (r.opponentTeamName ?? r.opponentName) : r.opponentName,
        })),
      ratingChange: mine.reduce((sum, r) => sum + r.ratingChange, 0),
      matchesPlayed: mine.length,
      matches: mine.map(matchRow).reverse(),
    }
  }).sort((a, b) => (b.year ?? 0) - (a.year ?? 0) || b.tournamentId - a.tournamentId)

  /*
    Teammates, from the team records rather than from one player's ledger rows.

    A ledger row knows the team's NAME because that is who the match was against; it does not know
    who else was on it. `TournamentTeamMember` does, so the roster is read from there — one query
    for every team tournament on the profile rather than one per tournament.
  */
  const teamRows = await prisma.tournamentTeamMember.findMany({
    where: { playerId: { in: identity.playerIds }, team: { tournamentId: { in: tournamentIds } } },
    select: { teamId: true, team: { select: { tournamentId: true, name: true, placement: true } } },
  })
  if (teamRows.length > 0) {
    const mates = await prisma.tournamentTeamMember.findMany({
      where: { teamId: { in: teamRows.map((r) => r.teamId) } },
      select: { teamId: true, name: true, handle: true, playerId: true, captain: true, memberOrder: true },
      orderBy: [{ captain: 'desc' }, { memberOrder: 'asc' }],
    })
    const byTournament = new Map(teamRows.map((r) => [r.team.tournamentId, r]))
    for (const t of tournaments) {
      const mine = byTournament.get(t.tournamentId)
      if (!mine) continue
      t.teamName = mine.team.name
      t.teammates = mates
        .filter((m) => m.teamId === mine.teamId)
        .filter((m) => !m.playerId || !identity.playerIds.includes(m.playerId))
        // The handle leads here too, falling back to the recorded name when there is no handle.
        .map((m) => (m.handle ?? '').trim() || m.name)
    }
  }

  // ── Career totals ─────────────────────────────────────────────────────────────────────────────
  const careerRecord = emptyRecord(), careerGroup = emptyRecord(), careerPlayoff = emptyRecord()
  for (const r of rows) {
    tally(careerRecord, r.result)
    tally(r.stage === 'PLAYOFF' ? careerPlayoff : careerGroup, r.result)
  }

  const career: ProfileCareer = {
    record: careerRecord,
    winPct: pct(careerRecord),
    matchesPlayed: rows.length,
    groupRecord: careerGroup,
    playoffRecord: careerPlayoff,
    seasonsPlayed: seasons.filter((s) => s.participation === 'verified').length,
    seasonsRostered: seasons.filter((s) => s.participation === 'roster-only').length,
    tournamentsPlayed: tournaments.length,
    seasonTitles: (allTime?.seasonTitles ?? []).length,
    tournamentTitles: (allTime?.trophies ?? []).length,
    // The ladder already computes these over the same rows; recomputing would risk a second answer.
    currentStreak: current?.streak ?? allTime?.streak ?? 0,
    longestWinStreak: allTime?.longestWinStreak ?? 0,
  }

  /*
    Head to head, from the same rows.

    Every meeting is already one ledger row from this player's side, carrying who it was against, so
    the rivalry table is a grouping rather than a second query. Opponents are keyed by player id
    where the archive resolved one and by name where it did not — a 2005 handle that was never
    matched to a profile is still somebody they played, and dropping it would quietly shorten the
    record.
  */
  const h2h = new Map<string, HeadToHeadRow>()
  for (const r of rows) {
    // A team match is this player against a TEAM, not against a person, so it is not a head to head.
    if (r.isTeamMatch) continue
    const key = r.opponentId ?? `name:${r.opponentName.toLowerCase()}`
    const row = h2h.get(key) ?? {
      opponentId: r.opponentId ?? null,
      opponentName: r.opponentName,
      wins: 0, losses: 0, draws: 0, played: 0, winPct: 0,
      lastMet: r.completedAt.toISOString(),
      lastCompetition: '',
    }
    if (r.result === 'WIN') row.wins += 1
    else if (r.result === 'LOSS') row.losses += 1
    else if (r.result === 'DRAW') row.draws += 1
    row.played += 1
    // Rows arrive oldest first, so the last one seen is the most recent meeting.
    row.lastMet = r.completedAt.toISOString()
    const season = r.seasonId != null ? seasonById.get(r.seasonId) : undefined
    const tournament = r.tournamentId != null ? tournamentById.get(r.tournamentId) : undefined
    row.lastCompetition = season ? `${seasonLabel(season)} · ${season.competitionYear}` : (tournament?.name ?? '')
    h2h.set(key, row)
  }
  const headToHead = [...h2h.values()]
    .map((row) => ({ ...row, winPct: pct(row) }))
    .sort((a, b) => b.played - a.played || b.wins - a.wins || a.opponentName.localeCompare(b.opponentName))

  const achievements = await profileAchievements(identity, allTime)
  const matches = rows.map(matchRow).reverse()

  return { identity, current, allTime, career, seasons, tournaments, achievements, headToHead, matches }
}

/**
 * The achievements this player actually holds.
 *
 * Three real sources, no new system and no new awards:
 *
 *   · the computed Achievements, filtered to the ones this player is a named winner of;
 *   · Season Championships, from the ladder's own trophy list;
 *   · Tournament wins, likewise.
 *
 * The larger WoW-style rebuild is a later pass. Nothing here is stored, so nothing here can be
 * awarded by mistake.
 */
async function profileAchievements(
  identity: ProfileIdentity,
  allTime: LadderRow | null,
): Promise<ProfileAchievement[]> {
  const out: ProfileAchievement[] = []

  for (const title of allTime?.seasonTitles ?? []) {
    out.push({
      id: `season-title-${title.slug}`,
      title: 'Season Champion',
      caption: title.title,
      stat: 'Champion',
      detail: title.title,
      kind: 'season-title',
      href: title.slug,
      when: title.date ? title.date.slice(0, 4) : null,
    })
  }
  for (const trophy of allTime?.trophies ?? []) {
    out.push({
      id: `tournament-title-${trophy.tournamentId}`,
      title: 'Tournament Winner',
      caption: trophy.name,
      stat: 'Champion',
      detail: trophy.name,
      kind: 'tournament-title',
      href: trophy.number != null ? `/tournaments/${trophy.number}` : null,
      when: trophy.date ? trophy.date.slice(0, 4) : null,
    })
  }

  try {
    const { getPublicAchievements } = await import('@/lib/achievements/service')
    const awards = await getPublicAchievements()
    for (const a of awards) {
      if (a.siteWide) continue
      if (!a.winners.some((w) => identity.playerIds.includes(w.playerId))) continue
      out.push({
        id: a.id, title: a.title, caption: a.caption,
        stat: a.stat, detail: a.detail, kind: 'award',
        href: '/achievements', when: null,
      })
    }
  } catch {
    /*
     * The awards are a computed extra, not the record. If evaluating them fails — a cache miss
     * outside a request store, most likely — the trophies above are still true and the profile
     * still renders. An empty extra beats a 500 on a page about somebody's career.
     */
  }

  return out
}
