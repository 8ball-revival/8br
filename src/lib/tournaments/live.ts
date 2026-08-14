import 'server-only'
import { prisma } from '@/lib/prisma'
import type { BracketRound, BracketMatch, BracketSlot } from './fixtures'
import { resolveEntrants } from '@/lib/competition/entrants'
import { getTeamsForSeason, getTeamMembersByRegistration, type TeamView } from '@/lib/competition/teams'
import { getTournamentState, bracketMatchesEntrants } from '@/lib/competition/tournament-lifecycle'
import { getSwissState, type SwissState } from '@/lib/competition/swiss'

/** Column name for a bracket round: last round = Final, then Semifinals, etc. */
export function roundColumnName(round: number, totalRounds: number): string {
  const fromEnd = totalRounds - round
  if (fromEnd === 0) return 'Final'
  if (fromEnd === 1) return 'Semifinals'
  if (fromEnd === 2) return 'Quarterfinals'
  if (fromEnd === 3) return 'Round of 16'
  if (fromEnd === 4) return 'Round of 32'
  if (fromEnd === 5) return 'Round of 64'
  return `Round ${round}`
}

export type PlayoffRow = {
  id: number
  round: number
  slot: number
  label: string | null
  homeRegistrationId: number | null
  awayRegistrationId: number | null
  homeUsername: string | null
  awayUsername: string | null
  homeSeed: number | null
  awaySeed: number | null
  homeGames: number | null
  awayGames: number | null
  winnerRegistrationId: number | null
  verification: string
  status: string
  note: string | null
  feedsMatchId: number | null
  feedsSlot: number | null
  published: boolean
  section?: string | null // "WB" | "LB" | "GF" for double-elimination; null for single-elim
}

/** Column heading for a double-elimination round (WB/LB/GF), given the stored global round number. */
function deColumnName(section: string, round: number): string {
  if (section === 'GF') return 'Grand Final'
  if (section === 'LB') return `Losers R${round - 100}`
  return `Winners R${round}`
}

type MemberInfo = { name: string; handle: string | null; playerId: string | null }

/** Convert live PlayoffMatch rows into the shared cup Bracket shape (with team rosters). */
export function playoffToBracketRounds(
  rows: PlayoffRow[],
  membersByRegId?: Map<number, MemberInfo[]>,
  /** Active cups only: regId → CURRENT Preferred Name, overriding the seed-time name so a
   *  live event always shows current identities. Omit for completed cups (they keep the
   *  frozen, as-played name stored in the bracket). */
  displayByRegId?: Map<number, string>,
  /** Active individual cups: regId → CURRENT CueVerse ID, shown as the slot's secondary line so a
   *  bracket slot reflects BOTH the Preferred Name and the CueVerse ID. */
  handleByRegId?: Map<number, string>,
): BracketRound[] {
  if (!rows.length) return []
  const totalRounds = Math.max(...rows.map((r) => r.round))
  const byRound = new Map<number, PlayoffRow[]>()
  for (const r of rows) {
    if (!byRound.has(r.round)) byRound.set(r.round, [])
    byRound.get(r.round)!.push(r)
  }
  const slotFor = (regId: number | null, name: string | null, seed: number | null, score: number | null, isFirstRound: boolean): BracketSlot | undefined => {
    if (name == null && regId == null) {
      // Empty side: an explicit bye in round 1, otherwise "to be determined".
      return isFirstRound ? { name: 'Bye' } : undefined
    }
    const s: BracketSlot = {}
    // Active cups: prefer the CURRENT display identity; fall back to the stored name.
    const current = regId != null ? displayByRegId?.get(regId) : undefined
    if (current != null) s.name = current
    else if (name != null) s.name = name
    const handle = regId != null ? handleByRegId?.get(regId) : undefined
    if (handle != null && handle !== s.name) s.handle = handle // secondary line: CueVerse ID
    if (seed != null) s.seed = seed
    if (score != null) s.score = score
    if (regId != null && membersByRegId?.has(regId)) {
      s.members = membersByRegId.get(regId)!.map((m) => ({ name: m.name, ...(m.handle ? { handle: m.handle } : {}) }))
    }
    return s
  }
  const isDoubleElim = rows.some((r) => r.section != null)
  const out: BracketRound[] = []
  for (const round of [...byRound.keys()].sort((a, b) => a - b)) {
    const isFirst = round === 1
    const ms = byRound.get(round)!.sort((a, b) => a.slot - b.slot)
    out.push({
      name: isDoubleElim ? deColumnName(ms[0].section ?? 'WB', round) : roundColumnName(round, totalRounds),
      matches: ms.map((r): BracketMatch => {
        const m: BracketMatch = {}
        const a = slotFor(r.homeRegistrationId, r.homeUsername, r.homeSeed, r.homeGames, isFirst)
        const b = slotFor(r.awayRegistrationId, r.awayUsername, r.awaySeed, r.awayGames, isFirst)
        if (a) m.a = a
        if (b) m.b = b
        if (r.winnerRegistrationId != null) m.winner = r.winnerRegistrationId === r.homeRegistrationId ? 'a' : 'b'
        if (r.note) m.note = r.note
        return m
      }),
    })
  }
  return out
}

export interface TournamentEntrantView {
  registrationId: number
  name: string
  handle: string | null
  slug: string | null
  seed: number | null
  withdrawn: boolean
}

export interface TournamentWorkspaceData {
  tournament: {
    id: number
    name: string
    slug: string
    number: number | null
    code: string | null
    gameType: string | null
    participantFormat: 'INDIVIDUAL' | 'TEAM'
    teamSize: number | null
    tournamentFormat: string | null
    raceLength: number
    qualifiersPerGroup: number | null // Group Stage: how many advance from each group (for the summary line)
    status: string
    playoffsStatus: string
    registrationStatus: string
    lifecycleState: string // explicit lifecycle state (source of truth for the public page + gating)
    archivedAt: string | null
    formatBadge: string | null
    teamFormation: 'PICK' | 'RANDOM'
    swissRounds: number | null
    // curated flair (badge + plain-text description; per-tournament colors/banner removed)
    description: string | null
    badge: string | null
  }
  isTournament: boolean
  isHistorical: boolean
  isEditable: boolean
  isTeam: boolean
  isLegacyConvertible: boolean // old-format cup that can be migrated into the editable workspace
  entrants: TournamentEntrantView[]
  teams: TeamView[]
  matches: PlayoffRow[]
  bracketRounds: BracketRound[]
  hasBracket: boolean
  hasPublishedBracket: boolean
  hasResults: boolean
  /** BRACKET_GENERATED only: the generated bracket no longer matches the current entrant list
   *  (entrants changed after re-opening) — it must be regenerated before the tournament can start. */
  bracketStale: boolean
  // ---- Group Stage + Playoffs (only populated when tournamentFormat = GROUPS_PLAYOFFS) ----
  isGroupStage: boolean
  groups: WorkspaceGroup[]
  /** Every group match has a verified result → qualifiers can be confirmed. */
  groupsComplete: boolean
  // ---- Swiss (only populated when tournamentFormat = SWISS) ----
  isSwiss: boolean
  swiss: SwissState | null
}

export interface WorkspaceGroupMatch {
  id: number
  round: number
  homeRegistrationId: number
  awayRegistrationId: number
  homeUsername: string
  awayUsername: string
  homeGames: number | null
  awayGames: number | null
  winnerRegistrationId: number | null
  status: string
  verification: string
  completedAt: string | null // when the result was recorded (public; for the match-details card)
}
export interface WorkspaceStandingRow {
  registrationId: number
  username: string
  played: number
  wins: number
  losses: number
  gamesWon: number
  gamesLost: number
  gameDiff: number
  points: number
  rank: number
  qualified: boolean
}
export interface WorkspaceGroup {
  id: number
  code: string
  name: string
  ordinal: number
  players: { registrationId: number; seed: number; cueverseId: string; preferredName: string | null; slug: string | null; discord: string | null }[]
  matches: WorkspaceGroupMatch[]
  standings: WorkspaceStandingRow[]
}

/** Load the group-stage view (groups, round-robin matches, standings) for a tournament. */
async function loadGroupStage(tournamentId: number): Promise<{ groups: WorkspaceGroup[]; complete: boolean }> {
  const gs = await prisma.tournamentGroup.findMany({
    where: { tournamentId },
    orderBy: { ordinal: 'asc' },
    include: {
      players: { include: { registration: true }, orderBy: { seed: 'asc' } },
      matches: { orderBy: [{ round: 'asc' }, { id: 'asc' }] },
      standings: { orderBy: { rank: 'asc' } },
    },
  })
  // Resolve CANONICAL identity for every group player (the linked profile's Preferred Name + CueVerse
  // ID), exactly like the entrant list and the playoff bracket, so names are consistent everywhere.
  const groupIdn = await resolveEntrants(gs.flatMap((g) => g.players.map((p) => p.registration)))
  const groups: WorkspaceGroup[] = gs.map((g) => ({
    id: g.id,
    code: g.code,
    name: g.name,
    ordinal: g.ordinal,
    players: g.players.map((p) => {
      const i = groupIdn.get(p.registrationId)
      return {
        registrationId: p.registrationId,
        seed: p.seed,
        cueverseId: i?.cueverseId ?? p.registration.cueverseId ?? p.registration.username, // left column: the CueVerse ID
        preferredName: i?.preferredName ?? p.registration.displayName?.trim() ?? null, // top column: Preferred Name (else abbreviated CueVerse ID)
        slug: i?.slug ?? p.registration.cueverseId ?? p.registration.username ?? null, // profile link handle
        discord: i?.discord ?? p.registration.discord ?? null,
      }
    }),
    matches: g.matches.map((m) => ({
      id: m.id,
      round: m.round,
      homeRegistrationId: m.homeRegistrationId,
      awayRegistrationId: m.awayRegistrationId,
      homeUsername: m.homeUsername,
      awayUsername: m.awayUsername,
      homeGames: m.homeGames,
      awayGames: m.awayGames,
      winnerRegistrationId: m.winnerRegistrationId,
      status: m.status,
      verification: m.verification,
      completedAt: m.completedAt ? m.completedAt.toISOString() : null,
    })),
    standings: g.standings.map((s) => ({
      registrationId: s.registrationId,
      username: s.username,
      played: s.played,
      wins: s.wins,
      losses: s.losses,
      gamesWon: s.gamesWon,
      gamesLost: s.gamesLost,
      gameDiff: s.gameDiff,
      points: s.points,
      rank: s.rank,
      qualified: s.qualified,
    })),
  }))
  const total = await prisma.tournamentMatch.count({ where: { tournamentId } })
  const remaining = await prisma.tournamentMatch.count({
    where: { tournamentId, OR: [{ winnerRegistrationId: null }, { verification: { not: 'VERIFIED' } }] },
  })
  return { groups, complete: total > 0 && remaining === 0 }
}

/** Load everything the TournamentView workspace + public live render need for a tournament number. */
export async function getTournamentWorkspace(number: number): Promise<TournamentWorkspaceData | null> {
  const tournament = await prisma.tournament.findFirst({ where: { number } })
  if (!tournament) return null

  const isTeam = tournament.participantFormat === 'TEAM'
  const isHistorical = false
  const isEditable = true
  const formatBadge =
    tournament.participantFormat === 'TEAM'
      ? tournament.teamSize
        ? `${tournament.teamSize}v${tournament.teamSize}`
        : 'Team'
      : tournament.tournamentFormat === 'DOUBLE_ELIM'
        ? 'D/E'
        : tournament.tournamentFormat === 'GROUPS_PLAYOFFS'
          ? 'Groups'
          : 'S/E'

  // Entrants (individual). Teams are the entrants for team cups.
  let entrants: TournamentEntrantView[] = []
  if (!isTeam) {
    const regs = await prisma.registration.findMany({
      where: { tournamentId: tournament.id },
      select: { id: true, username: true, displayName: true, cueverseId: true, discord: true, playerId: true, seed: true, status: true },
      orderBy: [{ seed: 'asc' }, { id: 'asc' }],
    })
    const idn = await resolveEntrants(regs)
    entrants = regs.map((r) => ({
      registrationId: r.id,
      name: idn.get(r.id)?.displayName ?? r.username,
      handle: idn.get(r.id)?.cueverseId ?? r.cueverseId ?? null,
      slug: idn.get(r.id)?.slug ?? null,
      seed: r.seed,
      withdrawn: r.status === 'WITHDRAWN',
    }))
  }
  const teams = isTeam ? await getTeamsForSeason(tournament.id) : []
  const membersByRegId = isTeam ? await getTeamMembersByRegistration(tournament.id) : undefined

  const matches: PlayoffRow[] = await prisma.playoffMatch.findMany({
    where: { tournamentId: tournament.id },
    orderBy: [{ round: 'asc' }, { slot: 'asc' }],
    select: {
      id: true, round: true, slot: true, label: true,
      homeRegistrationId: true, awayRegistrationId: true, homeUsername: true, awayUsername: true,
      homeSeed: true, awaySeed: true, homeGames: true, awayGames: true, winnerRegistrationId: true,
      verification: true, status: true, note: true, feedsMatchId: true, feedsSlot: true, published: true, section: true,
    },
  })

  // Identity model: an ACTIVE cup always shows the CURRENT CueVerse ID (re-resolved from
  // the entrant/profile); a COMPLETED cup preserves the ID the player competed under
  // (the frozen name stored on the bracket). Team cups keep their team name (kept current
  // on rename), so the live override applies to individual cups only.
  const isCompleted = tournament.lifecycleState === 'COMPLETED' || tournament.status === 'COMPLETED'
  const displayByRegId =
    !isCompleted && !isTeam ? new Map(entrants.map((e) => [e.registrationId, e.name])) : undefined
  // Individual bracket slots also carry the CueVerse ID as a secondary line (Preferred Name + ID).
  const handleByRegId =
    !isCompleted && !isTeam ? new Map(entrants.flatMap((e) => (e.handle ? [[e.registrationId, e.handle] as const] : []))) : undefined
  const bracketRounds = playoffToBracketRounds(matches, membersByRegId, displayByRegId, handleByRegId)
  const hasPublishedBracket = matches.some((m) => m.published)
  const hasResults = matches.some((m) => m.winnerRegistrationId != null)
  // Staleness only matters while the bracket is generated but the tournament hasn't started.
  const bracketStale = getTournamentState(tournament) === 'BRACKET_GENERATED' ? !(await bracketMatchesEntrants(tournament.id)).ok : false

  // The legacy old-format-cup conversion feature was removed in the WCC reset.
  const isLegacyConvertible = false

  // Group Stage + Playoffs data (only for that format).
  const isGroupStage = tournament.tournamentFormat === 'GROUPS_PLAYOFFS'
  const gs = isGroupStage ? await loadGroupStage(tournament.id) : { groups: [], complete: false }
  const isSwiss = tournament.tournamentFormat === 'SWISS'
  const swiss = isSwiss ? await getSwissState(tournament.id) : null

  return {
    tournament: {
      id: tournament.id,
      name: tournament.name,
      slug: tournament.slug,
      number: tournament.number,
      code: tournament.code,
      gameType: tournament.gameType,
      participantFormat: tournament.participantFormat,
      teamSize: tournament.teamSize,
      tournamentFormat: tournament.tournamentFormat,
      raceLength: tournament.raceLength,
      qualifiersPerGroup: tournament.qualifiersPerGroup ?? null,
      status: tournament.status,
      playoffsStatus: tournament.playoffsStatus,
      registrationStatus: tournament.registrationStatus,
      lifecycleState: getTournamentState(tournament),
      archivedAt: tournament.archivedAt ? tournament.archivedAt.toISOString() : null,
      formatBadge,
      teamFormation: tournament.teamFormation,
      swissRounds: tournament.swissRounds,
      description: tournament.description,
      badge: tournament.badge,
    },
    isTournament: true,
    isHistorical,
    isEditable,
    isTeam,
    isLegacyConvertible,
    entrants,
    teams,
    matches,
    bracketRounds,
    hasBracket: matches.length > 0,
    hasPublishedBracket,
    hasResults,
    bracketStale,
    isGroupStage,
    groups: gs.groups,
    groupsComplete: gs.complete,
    isSwiss,
    swiss,
  }
}
