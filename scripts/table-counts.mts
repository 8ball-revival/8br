/**
 * Row counts for every table this redesign can touch.
 *
 * Recorded before and after so "existing data preserved" is a comparison, not an assurance.
 * Deliberately separate from archive-integrity.mts, which fingerprints CONTENT — this counts rows,
 * which is the cheaper check to run repeatedly during a long change.
 */
import { prisma } from '../src/lib/prisma.ts'
const t: Record<string, number> = {}
const q = async (name: string, fn: () => Promise<number>) => { t[name] = await fn().catch(() => -1) }
await q('season', () => prisma.season.count())
await q('season_entrant', () => prisma.seasonEntrant.count())
await q('season_group', () => prisma.seasonGroup.count())
await q('season_group_player', () => prisma.seasonGroupPlayer.count())
await q('season_match', () => prisma.seasonMatch.count())
await q('season_standing', () => prisma.seasonStanding.count())
await q('season_playoff_match', () => prisma.seasonPlayoffMatch.count())
await q('comp_tournament', () => prisma.tournament.count())
await q('comp_registration', () => prisma.registration.count())
await q('comp_tournament_group', () => prisma.tournamentGroup.count())
await q('comp_tournament_match', () => prisma.tournamentMatch.count())
await q('comp_playoff_match', () => prisma.playoffMatch.count())
await q('comp_standing', () => prisma.standing.count())
await q('competition_series', () => prisma.competitionSeries.count())
await q('Player', () => prisma.player.count())
await q('PlayerAlias', () => prisma.playerAlias.count())
await q('rating_ledger', () => prisma.ratingLedger.count())
await q('comp_audit_log', () => prisma.auditLog.count())
await q('media_upload', () => prisma.mediaUpload.count())
await q('article', () => prisma.article.count())
console.log(JSON.stringify(t, null, 2))
await prisma.$disconnect()
