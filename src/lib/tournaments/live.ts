import 'server-only'
import { prisma } from '@/lib/prisma'
import type { BracketRound, BracketMatch, BracketSlot } from './fixtures'
import { resolveEntrants } from '@/lib/competition/entrants'
import { getTeamsForSeason, getTeamMembersByRegistration, type TeamView } from '@/lib/competition/teams'
import { getTournamentState, bracketMatchesEntrants } from '@/lib/competition/tournament-lifecycle'
import { computeBracketShape, playoffRaceLength } from '@/lib/competition/match-format'
import { MIN_GROUP_SIZE, roundRobinMatchCount, validateGroupDraft, groupsArePublished } from '@/lib/competition/group-setup'
import { getSwissState, type SwissState } from '@/lib/competition/swiss'

/** Current Rankings rating (latest all-time Elo post-rating) per playerId. Players with no rated
 *  history are simply absent from the map (shown as unrated). */
async function ratingsByPlayerId(playerIds: (string | null)[]): Promise<Map<string, number>> {
  const m = new Map<string, number>()
  const ids = [...new Set(playerIds.filter((p): p is string => !!p))]
  if (!ids.length) return m
  const latest = await prisma.ratingLedger.findMany({ where: { playerId: { in: ids } }, orderBy: { sequence: 'desc' }, select: { playerId: true, postRating: true } })
  for (const r of latest) if (!m.has(r.playerId)) m.set(r.playerId, r.postRating)
  return m
}

/** Short public "format" badge derived from the tournament's structural format.
 *  Kept in sync with adapter.ts formatBadgeOf — covers every TournamentFormat so the
 *  header never mislabels (e.g. a Swiss tournament must not read "S/E"). */
export function badgeForFormat(participantFormat: string, tournamentFormat: string | null, teamSize: number | null): string {
  if (participantFormat === 'TEAM') return teamSize ? `${teamSize}v${teamSize}` : 'Team'
  switch (tournamentFormat) {
    case 'DOUBLE_ELIM': return 'D/E'
    case 'SWISS': return 'Swiss'
    case 'ROUND_ROBIN': return 'R/R'
    case 'TEAM_KNOCKOUT': return 'T/K'
    case 'GROUPS_PLAYOFFS': return 'Groups'
    case 'SINGLE_ELIM':
    default: return 'S/E'
  }
}

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
  /** Individual cups (live AND completed): regId → profile slug (CueVerse ID) so each 1v1 name links
   *  to the player's profile. Unlike handleByRegId, this is kept even when it equals the name. */
  slugByRegId?: Map<number, string>,
  /** Group Stage + Playoffs: annotate each match with its hard-coded race length (7 early, 9 semis/final). */
  groupsPlayoffs?: boolean,
): BracketRound[] {
  if (!rows.length) return []
  const bracketShape = groupsPlayoffs ? computeBracketShape(rows) : null
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
    const slug = regId != null ? slugByRegId?.get(regId) : undefined
    if (slug != null) s.slug = slug // profile-link target (kept even when it equals the name)
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
        if (bracketShape) m.raceLength = playoffRaceLength({ round: r.round, section: r.section }, bracketShape)
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
  /** Current Rankings (all-time Elo) rating, or null when the player has no rated history yet. */
  rating: number | null
  /** RANDOM tournaments only: the generated team this player was drawn into (null before the draw). */
  teamName?: string | null
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
    accessMode: string // 'OPEN' | 'PASSWORD'
    requiresJoinPassword: boolean
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
    /** Free-text note shown under the playoff bracket; null for almost every tournament. */
    playoffDisclaimer: string | null
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
  /** True once the groups are published (Group Stage live). While false the groups are a private draft. */
  groupsPublished: boolean
  /** Draft-phase board data (null once published) — Unassigned entrants + live summary + validation. */
  groupSetup: GroupSetupView | null
  /** Every group match has a verified result → qualifiers can be confirmed. */
  groupsComplete: boolean
  // ---- Swiss (only populated when tournamentFormat = SWISS) ----
  isSwiss: boolean
  swiss: SwissState | null
  // ---- RANDOM team formation ----
  /** teamFormation = RANDOM. Drives the fixed six-tab, individual-entrants workspace. */
  isRandomTeam: boolean
  /** RANDOM only: the one-time draw has run (teams exist). Entrants become read-only + show team names. */
  randomTeamsGenerated: boolean
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
export interface GroupSetupEntrant {
  registrationId: number
  name: string
  cueverseId: string | null
}

export interface GroupSetupView {
  isTeam: boolean
  /** Every active (approved) entrant, keyed for the board to render cards in any column. */
  entrants: GroupSetupEntrant[]
  unassignedIds: number[]
  totalEntrants: number
  numGroups: number
  targetPerGroup: number
  minGroupSize: number
  assignedCount: number
  unassignedCount: number
  /** Round-robin matches that publishing will generate (sum of nC2 over groups). */
  totalMatches: number
  perGroup: { id: number; name: string; count: number; overTarget: boolean; underMin: boolean }[]
  issues: { code: string; message: string }[]
  canPublish: boolean
}

/** Build the private Group-Setup board view for the draft phase (before groups are published). */
async function loadGroupSetup(tournamentId: number, isTeam: boolean, groups: WorkspaceGroup[], entrantName: Map<number, GroupSetupEntrant>): Promise<GroupSetupView> {
  const approved = await prisma.registration.findMany({ where: { tournamentId, status: 'APPROVED' }, select: { id: true } })
  const approvedIds = approved.map((r) => r.id)
  const approvedSet = new Set(approvedIds)
  const assigned = new Set(groups.flatMap((g) => g.players.map((p) => p.registrationId)))
  const unassignedIds = approvedIds.filter((id) => !assigned.has(id))
  const entrants: GroupSetupEntrant[] = approvedIds.map((id) => entrantName.get(id) ?? { registrationId: id, name: `#${id}`, cueverseId: null })

  const numGroups = groups.length
  const totalEntrants = approvedIds.length
  const targetPerGroup = numGroups > 0 ? Math.ceil(totalEntrants / numGroups) : 0
  const perGroup = groups.map((g) => {
    const count = g.players.filter((p) => approvedSet.has(p.registrationId)).length
    return { id: g.id, name: g.name, count, overTarget: count > targetPerGroup, underMin: count < MIN_GROUP_SIZE }
  })
  const totalMatches = perGroup.reduce((s, g) => s + roundRobinMatchCount(g.count), 0)
  const assignedCount = totalEntrants - unassignedIds.length
  const { issues } = await validateGroupDraft(tournamentId)

  return {
    isTeam,
    entrants,
    unassignedIds,
    totalEntrants,
    numGroups,
    targetPerGroup,
    minGroupSize: MIN_GROUP_SIZE,
    assignedCount,
    unassignedCount: unassignedIds.length,
    totalMatches,
    perGroup,
    issues,
    canPublish: issues.length === 0,
  }
}

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
  // A match is settled once it is VERIFIED and in a completed status — INCLUDING a 5–5 draw, which is
  // COMPLETED with a null winner. Only unplayed/disputed/unverified matches remain. (Mirrors
  // groupStageComplete; gating on winnerRegistrationId here wrongly treated a draw as unplayed and left
  // "Confirm Qualifiers" disabled.)
  const remaining = await prisma.tournamentMatch.count({
    where: {
      tournamentId,
      OR: [{ verification: { not: 'VERIFIED' } }, { status: { notIn: ['COMPLETED', 'FORFEIT', 'NO_SHOW'] } }],
    },
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
  const formatBadge = badgeForFormat(tournament.participantFormat, tournament.tournamentFormat, tournament.teamSize)

  // Entrants (individual). Teams are the entrants for team cups.
  let entrants: TournamentEntrantView[] = []
  if (!isTeam) {
    const regs = await prisma.registration.findMany({
      where: { tournamentId: tournament.id },
      select: { id: true, username: true, displayName: true, cueverseId: true, discord: true, playerId: true, seed: true, status: true },
      orderBy: [{ seed: 'asc' }, { id: 'asc' }],
    })
    const idn = await resolveEntrants(regs)
    const ratings = await ratingsByPlayerId(regs.map((r) => r.playerId))
    entrants = regs.map((r) => ({
      registrationId: r.id,
      name: idn.get(r.id)?.displayName ?? r.username,
      handle: idn.get(r.id)?.cueverseId ?? r.cueverseId ?? null,
      slug: idn.get(r.id)?.slug ?? null,
      seed: r.seed,
      withdrawn: r.status === 'WITHDRAWN',
      rating: r.playerId ? ratings.get(r.playerId) ?? null : null,
    }))
  }
  const teams = isTeam ? await getTeamsForSeason(tournament.id) : []
  const membersByRegId = isTeam ? await getTeamMembersByRegistration(tournament.id) : undefined

  // RANDOM tournaments present a FLAT individual-entrant list (like single-player), never a Teams UI.
  // Before the draw: the solo registrations (editable while registration is open). After the draw:
  // each drawn player shown read-only with the generated team they landed in.
  const isRandomTeam = isTeam && tournament.teamFormation === 'RANDOM'
  const randomTeamsGenerated = isRandomTeam && teams.length > 0
  if (isRandomTeam) {
    if (!randomTeamsGenerated) {
      const solos = await prisma.registration.findMany({
        where: { tournamentId: tournament.id, team: { is: null } },
        select: { id: true, username: true, displayName: true, cueverseId: true, playerId: true, seed: true, status: true },
        orderBy: [{ seed: 'asc' }, { id: 'asc' }],
      })
      const ratings = await ratingsByPlayerId(solos.map((r) => r.playerId))
      entrants = solos.map((r) => ({
        registrationId: r.id,
        name: r.displayName?.trim() || r.username,
        handle: r.cueverseId ?? null,
        slug: r.cueverseId ?? null,
        seed: r.seed,
        withdrawn: r.status === 'WITHDRAWN',
        rating: r.playerId ? ratings.get(r.playerId) ?? null : null,
        teamName: null,
      }))
    } else {
      const members = await prisma.tournamentTeamMember.findMany({
        where: { team: { tournamentId: tournament.id } },
        select: { id: true, name: true, handle: true, memberOrder: true, ratingAtClose: true, team: { select: { name: true } } },
        orderBy: [{ teamId: 'asc' }, { memberOrder: 'asc' }],
      })
      entrants = members.map((m) => ({
        registrationId: m.id,
        name: m.name,
        handle: m.handle ?? null,
        slug: m.handle ?? null,
        seed: null,
        withdrawn: false,
        rating: m.ratingAtClose ?? null,
        teamName: m.team.name,
      }))
    }
  }

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
  // Profile-link slug for every individual entrant (live AND completed) so bracket names link to the
  // player's profile like the Rankings ladder does. Prefer the resolved slug, fall back to the CueVerse ID.
  const slugByRegId = !isTeam
    ? new Map(entrants.flatMap((e) => { const s = e.slug ?? e.handle; return s ? [[e.registrationId, s] as const] : [] }))
    : undefined
  const bracketRounds = playoffToBracketRounds(matches, membersByRegId, displayByRegId, handleByRegId, slugByRegId, tournament.tournamentFormat === 'GROUPS_PLAYOFFS')
  const hasPublishedBracket = matches.some((m) => m.published)
  const hasResults = matches.some((m) => m.winnerRegistrationId != null)
  // Staleness only matters while the bracket is generated but the tournament hasn't started.
  const bracketStale = getTournamentState(tournament) === 'BRACKET_GENERATED' ? !(await bracketMatchesEntrants(tournament.id)).ok : false

  // The legacy old-format-cup conversion feature was removed in the 8BR reset.
  const isLegacyConvertible = false

  // Group Stage + Playoffs data (only for that format).
  const isGroupStage = tournament.tournamentFormat === 'GROUPS_PLAYOFFS'
  const gs = isGroupStage ? await loadGroupStage(tournament.id) : { groups: [], complete: false }
  const groupsPublished = isGroupStage ? await groupsArePublished(tournament.id) : false
  // Draft board (before publish): Unassigned entrants + summary + validation. Every entrant (individual
  // or whole team) is one movable card, keyed by registrationId.
  let groupSetup: GroupSetupView | null = null
  if (isGroupStage && !groupsPublished && getTournamentState(tournament) === 'REGISTRATION_CLOSED') {
    const entrantName = new Map<number, GroupSetupEntrant>()
    if (isTeam) for (const t of teams) entrantName.set(t.registrationId, { registrationId: t.registrationId, name: t.name, cueverseId: null })
    else for (const e of entrants) entrantName.set(e.registrationId, { registrationId: e.registrationId, name: e.name, cueverseId: e.handle })
    groupSetup = await loadGroupSetup(tournament.id, isTeam, gs.groups, entrantName)
  }
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
      accessMode: tournament.accessMode, // 'OPEN' | 'PASSWORD' — a private tournament needs a join password
      requiresJoinPassword: tournament.accessMode === 'PASSWORD',
      raceLength: tournament.raceLength,
      qualifiersPerGroup: tournament.qualifiersPerGroup ?? null,
      playoffDisclaimer: tournament.playoffDisclaimer ?? null,
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
    groupsPublished,
    groupSetup,
    groupsComplete: gs.complete,
    isSwiss,
    swiss,
    isRandomTeam,
    randomTeamsGenerated,
  }
}
