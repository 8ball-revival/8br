import 'server-only'
import { prisma } from '@/lib/prisma'
import type { BracketRound, BracketMatch, BracketSlot } from './fixtures'
import { resolveEntrants } from '@/lib/competition/entrants'
import { getTeamsForSeason, getTeamMembersByRegistration, type TeamView } from '@/lib/competition/teams'
import { getCupState, bracketMatchesEntrants } from '@/lib/competition/cup-lifecycle'

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
}

type MemberInfo = { name: string; handle: string | null; playerId: string | null }

/** Convert live PlayoffMatch rows into the shared cup Bracket shape (with team rosters). */
export function playoffToBracketRounds(
  rows: PlayoffRow[],
  membersByRegId?: Map<number, MemberInfo[]>,
  /** Active cups only: regId → CURRENT CueVerse ID, overriding the seed-time name so a
   *  live event always shows current identities. Omit for completed cups (they keep the
   *  frozen, as-played name stored in the bracket). */
  displayByRegId?: Map<number, string>,
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
    if (seed != null) s.seed = seed
    if (score != null) s.score = score
    if (regId != null && membersByRegId?.has(regId)) {
      s.members = membersByRegId.get(regId)!.map((m) => ({ name: m.name, ...(m.handle ? { handle: m.handle } : {}) }))
    }
    return s
  }
  const out: BracketRound[] = []
  for (const round of [...byRound.keys()].sort((a, b) => a - b)) {
    const isFirst = round === 1
    const ms = byRound.get(round)!.sort((a, b) => a.slot - b.slot)
    out.push({
      name: roundColumnName(round, totalRounds),
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

export interface CupEntrantView {
  registrationId: number
  name: string
  handle: string | null
  slug: string | null
  seed: number | null
  withdrawn: boolean
}

export interface CupWorkspaceData {
  tournament: {
    id: number
    name: string
    slug: string
    cupNumber: number | null
    competitionCode: string | null
    gameType: string | null
    participantFormat: 'INDIVIDUAL' | 'TEAM'
    teamSize: number | null
    tournamentFormat: string | null
    raceLength: number
    seasonStatus: string
    playoffsStatus: string
    registrationStatus: string
    lifecycleState: string // explicit lifecycle state (source of truth for the public page + gating)
    archivedAt: string | null
    locked: boolean
    importedFromFixture: boolean
    cupStatus: string | null
    formatBadge: string | null
  }
  isCup: boolean
  isHistorical: boolean
  isEditable: boolean
  isTeam: boolean
  isLegacyConvertible: boolean // old-format cup that can be migrated into the editable workspace
  entrants: CupEntrantView[]
  teams: TeamView[]
  matches: PlayoffRow[]
  bracketRounds: BracketRound[]
  hasBracket: boolean
  hasPublishedBracket: boolean
  hasResults: boolean
  /** BRACKET_GENERATED only: the generated bracket no longer matches the current entrant list
   *  (entrants changed after re-opening) — it must be regenerated before the cup can start. */
  bracketStale: boolean
}

/** Load everything the Cup workspace + public live render need for a cup number. */
export async function getCupWorkspace(cupNumber: number): Promise<CupWorkspaceData | null> {
  const tournament = await prisma.tournament.findFirst({ where: { competitionType: 'CUP', cupNumber } })
  if (!tournament) return null

  const isTeam = tournament.participantFormat === 'TEAM'
  const isHistorical = tournament.importedFromFixture || tournament.locked
  const isEditable = !isHistorical

  // Entrants (individual). Teams are the entrants for team cups.
  let entrants: CupEntrantView[] = []
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
      verification: true, status: true, note: true, feedsMatchId: true, feedsSlot: true, published: true,
    },
  })

  // Identity model: an ACTIVE cup always shows the CURRENT CueVerse ID (re-resolved from
  // the entrant/profile); a COMPLETED cup preserves the ID the player competed under
  // (the frozen name stored on the bracket). Team cups keep their team name (kept current
  // on rename), so the live override applies to individual cups only.
  const isCompleted = tournament.cupStatus === 'completed' || tournament.seasonStatus === 'COMPLETED'
  const displayByRegId =
    !isCompleted && !isTeam ? new Map(entrants.map((e) => [e.registrationId, e.name])) : undefined
  const bracketRounds = playoffToBracketRounds(matches, membersByRegId, displayByRegId)
  const hasPublishedBracket = matches.some((m) => m.published)
  const hasResults = matches.some((m) => m.winnerRegistrationId != null)
  // Staleness only matters while the bracket is generated but the cup hasn't started.
  const bracketStale = getCupState(tournament) === 'BRACKET_GENERATED' ? !(await bracketMatchesEntrants(tournament.id)).ok : false

  // Legacy = a single-elim individual cup still stored only in the old read-only bracket
  // (TournamentBracketMatch, no PlayoffMatch), not locked. It can be migrated to the workspace.
  let isLegacyConvertible = false
  if (matches.length === 0 && !tournament.locked) {
    const [mainCount, otherCount, tieCount] = await Promise.all([
      prisma.tournamentBracketMatch.count({ where: { competitionId: tournament.id, bracketKind: 'MAIN' } }),
      prisma.tournamentBracketMatch.count({ where: { competitionId: tournament.id, bracketKind: { not: 'MAIN' } } }),
      prisma.cupTeamTie.count({ where: { competitionId: tournament.id } }),
    ])
    isLegacyConvertible = mainCount > 0 && otherCount === 0 && tieCount === 0
  }

  return {
    tournament: {
      id: tournament.id,
      name: tournament.name,
      slug: tournament.slug,
      cupNumber: tournament.cupNumber,
      competitionCode: tournament.competitionCode,
      gameType: tournament.gameType,
      participantFormat: tournament.participantFormat,
      teamSize: tournament.teamSize,
      tournamentFormat: tournament.tournamentFormat,
      raceLength: tournament.raceLength,
      seasonStatus: tournament.seasonStatus,
      playoffsStatus: tournament.playoffsStatus,
      registrationStatus: tournament.registrationStatus,
      lifecycleState: getCupState(tournament),
      archivedAt: tournament.archivedAt ? tournament.archivedAt.toISOString() : null,
      locked: tournament.locked,
      importedFromFixture: tournament.importedFromFixture,
      cupStatus: tournament.cupStatus,
      formatBadge: tournament.cupFormatBadge,
    },
    isCup: true,
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
  }
}
