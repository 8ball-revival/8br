import 'server-only'
import { prisma } from '@/lib/prisma'
import { validateSeasonGroupDraft, type SeasonDraftIssue } from './groups'
import { seasonRatingsByPlayerId } from './service'

/** Group-setup (draft) board data: one panel per group + the Unassigned pool. */
export interface SetupPlayer { entrantId: number; name: string; cueverseId: string | null; rating: number | null }
export interface SetupGroup { id: number; code: string; name: string | null; players: SetupPlayer[] }
export interface GroupSetupView { groups: SetupGroup[]; unassigned: SetupPlayer[]; issues: SeasonDraftIssue[]; valid: boolean }

export async function getSeasonGroupSetup(seasonId: number): Promise<GroupSetupView> {
  const groups = await prisma.seasonGroup.findMany({ where: { seasonId }, include: { players: { include: { entrant: true } } }, orderBy: { ordinal: 'asc' } })
  const entrants = await prisma.seasonEntrant.findMany({ where: { seasonId, status: 'APPROVED', kickedOut: false } })
  const player = (e: { id: number; displayName: string | null; username: string; cueverseId: string | null; ratingSnapshot: number | null }): SetupPlayer => ({ entrantId: e.id, name: e.displayName?.trim() || e.username, cueverseId: e.cueverseId, rating: e.ratingSnapshot })
  const assigned = new Set<number>()
  const setupGroups: SetupGroup[] = groups.map((g) => ({
    id: g.id, code: g.code, name: g.name,
    players: g.players.map((p) => { assigned.add(p.entrantId); return player(p.entrant) }).sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0)),
  }))
  const unassigned = entrants.filter((e) => !assigned.has(e.id)).map(player).sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0))
  const v = await validateSeasonGroupDraft(seasonId)
  return { groups: setupGroups, unassigned, issues: v.issues, valid: v.ok }
}

/** Live group-stage view: per group, standings (ranked) + the head-to-head matches for the cross-table. */
export interface StageMatch { id: number; homeEntrantId: number; awayEntrantId: number; homeUsername: string; awayUsername: string; homeGames: number | null; awayGames: number | null; status: string; winnerEntrantId: number | null; forfeitEntrantId: number | null; version: number }
export interface StageStandingRow { entrantId: number; username: string; cueverseId: string | null; played: number; wins: number; losses: number; draws: number; gamesWon: number; gamesLost: number; points: number; rank: number; qualified: boolean; kickedOut: boolean }
export interface StageGroup { id: number; code: string; name: string | null; standings: StageStandingRow[]; matches: StageMatch[] }

export async function getSeasonGroupStage(seasonId: number): Promise<StageGroup[]> {
  const groups = await prisma.seasonGroup.findMany({ where: { seasonId, published: true }, include: { standings: true, matches: true }, orderBy: { ordinal: 'asc' } })
  const entrants = await prisma.seasonEntrant.findMany({ where: { seasonId }, select: { id: true, cueverseId: true, kickedOut: true } })
  const meta = new Map(entrants.map((e) => [e.id, e]))
  return groups.map((g) => ({
    id: g.id, code: g.code, name: g.name,
    standings: [...g.standings]
      .sort((a, b) => a.rank - b.rank)
      .map((s) => ({ entrantId: s.entrantId, username: s.username, cueverseId: meta.get(s.entrantId)?.cueverseId ?? null, played: s.played, wins: s.wins, losses: s.losses, draws: s.draws, gamesWon: s.gamesWon, gamesLost: s.gamesLost, points: s.points, rank: s.rank, qualified: s.qualified, kickedOut: meta.get(s.entrantId)?.kickedOut ?? false })),
    matches: g.matches.map((m) => ({ id: m.id, homeEntrantId: m.homeEntrantId, awayEntrantId: m.awayEntrantId, homeUsername: m.homeUsername, awayUsername: m.awayUsername, homeGames: m.homeGames, awayGames: m.awayGames, status: m.status, winnerEntrantId: m.winnerEntrantId, forfeitEntrantId: m.forfeitEntrantId, version: m.version })),
  }))
}
/** Playable playoff matchups for admin entry (both sides known, undecided, not a bye). */
export interface PlayablePlayoff { id: number; label: string | null; homeUsername: string; awayUsername: string; homeGames: number | null; awayGames: number | null; decided: boolean }
export async function getSeasonPlayable(seasonId: number): Promise<PlayablePlayoff[]> {
  const rows = await prisma.seasonPlayoffMatch.findMany({ where: { seasonId, homeEntrantId: { not: null }, awayEntrantId: { not: null } }, orderBy: [{ round: 'asc' }, { slot: 'asc' }] })
  return rows
    .filter((m) => m.homeUsername !== 'Bye' && m.awayUsername !== 'Bye')
    .map((m) => ({ id: m.id, label: m.label, homeUsername: m.homeUsername ?? '', awayUsername: m.awayUsername ?? '', homeGames: m.homeGames, awayGames: m.awayGames, decided: m.winnerEntrantId != null }))
}

export { seasonRatingsByPlayerId }
