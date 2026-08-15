import 'server-only'
import { prisma } from '@/lib/prisma'

/** Cross-domain operational snapshot for the Admin Portal home. Read-only aggregate counts only —
 *  every actionable item links out to the relevant Season/Tournament/Player page. */
export interface AdminOverview {
  activeSeasons: number
  upcomingSeasons: number
  activeTournaments: number
  openRegistrations: number
  unresolvedGroupMatches: number
  unresolvedPlayoffMatches: number
  waitingFreeAgents: number
  incompleteTeams: number
  forcePasswordChange: number
  suspendedAccounts: number
}

const SEASON_ACTIVE = ['REGISTRATION_OPEN', 'GROUP_SETUP', 'GROUP_STAGE_LIVE', 'GROUPS_CLOSED', 'PLAYOFF_SETUP', 'PLAYOFFS_LIVE'] as const
const SEASON_UPCOMING = ['REGISTRATION_SCHEDULED', 'REGISTRATION_CLOSED'] as const
const TOURNEY_ACTIVE = ['REGISTRATION_OPEN', 'REGISTRATION_CLOSED', 'GROUPS_IN_PROGRESS', 'BRACKET_GENERATED', 'IN_PROGRESS'] as const

export async function getAdminOverview(): Promise<AdminOverview> {
  const [
    activeSeasons, upcomingSeasons, activeTournaments,
    seasonOpenReg, tourneyOpenReg,
    unresolvedGroupMatches, unresolvedPlayoffMatches,
    waitingFreeAgents, incompleteTeamsRaw,
    forcePasswordChange,
  ] = await Promise.all([
    prisma.season.count({ where: { lifecycleState: { in: [...SEASON_ACTIVE] } } }),
    prisma.season.count({ where: { lifecycleState: { in: [...SEASON_UPCOMING] } } }),
    prisma.tournament.count({ where: { lifecycleState: { in: [...TOURNEY_ACTIVE] } } }),
    prisma.season.count({ where: { lifecycleState: 'REGISTRATION_OPEN' } }),
    prisma.tournament.count({ where: { registrationStatus: 'OPEN' } }),
    prisma.seasonMatch.count({ where: { status: 'SCHEDULED', season: { lifecycleState: 'GROUP_STAGE_LIVE' } } }),
    prisma.seasonPlayoffMatch.count({ where: { status: 'SCHEDULED', published: true, homeEntrantId: { not: null }, awayEntrantId: { not: null }, season: { lifecycleState: 'PLAYOFFS_LIVE' } } }),
    prisma.tournamentFreeAgent.count({ where: { status: 'WAITING' } }),
    // Incomplete teams: live team tournaments whose team member count < the required size.
    prisma.$queryRawUnsafe<{ c: bigint }[]>(
      `SELECT count(*)::bigint c FROM comp_tournament_team tt
         JOIN comp_tournament t ON t.id = tt."tournamentId"
        WHERE tt.withdrawn = false AND t."participantFormat" = 'TEAM'
          AND (SELECT count(*) FROM comp_tournament_team_member m WHERE m."teamId" = tt.id) < COALESCE(t."teamSize", 0)`,
    ).catch(() => [{ c: 0n }]),
    prisma.passwordResetState.count({ where: { forceChange: true } }),
  ])
  const suspended = await prisma.memberModeration.count({ where: { status: { in: ['BANNED', 'TIMED_OUT'] } } }).catch(() => 0)

  return {
    activeSeasons,
    upcomingSeasons,
    activeTournaments,
    openRegistrations: seasonOpenReg + tourneyOpenReg,
    unresolvedGroupMatches,
    unresolvedPlayoffMatches,
    waitingFreeAgents,
    incompleteTeams: Number(incompleteTeamsRaw[0]?.c ?? 0),
    forcePasswordChange,
    suspendedAccounts: suspended,
  }
}
