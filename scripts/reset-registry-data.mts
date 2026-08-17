/**
 * Authorized destructive reset of the CONTAINED LOCAL database, back to a bare site.
 *
 * What survives: the Admin login and its linked Player profile, the 8BRCAM Competition, the site
 * content and media, the schema and migration history. Everything else competition-related goes.
 *
 * This never relies on foreign-key cascades. Every table is emptied explicitly, children first, and
 * the four references that have NO foreign key behind them - `rating_ledger`, `comp_registration`,
 * `comp_audit_log` and `staff_designation` - are handled by name, because Postgres would not stop us
 * orphaning them.
 *
 * Guards, all of which abort before a single row is touched:
 *   · the connection must be the contained cluster (127.0.0.1:55432, database 8br_dev)
 *   · there must be exactly ONE owner account, and it must have a linked profile
 *   · the offline archive must exist, so the history being deleted is already preserved elsewhere
 *   · --yes must be passed
 *
 * Run:
 *   node scripts/run-with-esm.mjs npx tsx --env-file=.env --tsconfig scripts/tsconfig.verify.json \
 *     scripts/reset-registry-data.mts --yes
 */
try {
  process.loadEnvFile('.env')
} catch {
  /* absent file is fine */
}

import { existsSync } from 'node:fs'
import { prisma } from '../src/lib/prisma.ts'

const CONFIRMED = process.argv.includes('--yes')
const ARCHIVE_HTML = 'C:\\Claude\\Archive Viewer\\8BRCAM\\8brcam-season-archive.html'
const KEEP_COMPETITION_SLUG = '8brcam'

function abort(why: string): never {
  console.error(`\nABORTED: ${why}`)
  console.error('Nothing was deleted.')
  process.exit(1)
}

async function main() {
  console.log('=== authorized local registry reset ===\n')

  // ---- guard: the contained cluster, nothing else
  const url = process.env.DATABASE_URL ?? ''
  const target = /127\.0\.0\.1:55432|localhost:55432/.test(url) && /\/8br_dev(\?|$)/.test(url)
  const dbRow = await prisma.$queryRaw<{ db: string; port: number }[]>`
    SELECT current_database() AS db, inet_server_port()::int AS port`
  const { db, port } = dbRow[0]
  console.log(`database        : ${db} on port ${port}`)
  if (!target || db !== '8br_dev' || Number(port) !== 55432) {
    abort(`this is not the contained local database (saw ${db}:${port})`)
  }

  // ---- guard: the archive that preserves the history must already exist
  if (!existsSync(ARCHIVE_HTML)) abort(`the offline archive is missing at ${ARCHIVE_HTML}`)
  console.log('offline archive : present')

  // ---- guard: exactly one owner, unambiguous, with a linked profile
  const owners = await prisma.$queryRaw<{ id: number; username: string }[]>`
    SELECT DISTINCT u.id, u.username FROM payload.users u
    JOIN payload.users_roles r ON r.parent_id = u.id
    WHERE r.value = 'owner' ORDER BY u.id`
  if (owners.length !== 1) abort(`expected exactly one owner account, found ${owners.length}`)
  const admin = owners[0]
  const adminProfile = await prisma.player.findFirst({
    where: { linkedUserId: String(admin.id) },
    select: { id: true, cueverseId: true, primaryName: true },
  })
  if (!adminProfile) abort(`the owner (@${admin.username}) has no linked Player profile to preserve`)
  console.log(`admin           : user ${admin.id} @${admin.username}`)
  console.log(`admin profile   : ${adminProfile.id} (${adminProfile.cueverseId})`)

  const keep = await prisma.competitionSeries.findUnique({
    where: { slug: KEEP_COMPETITION_SLUG },
    select: { id: true, name: true },
  })
  if (!keep) abort(`the ${KEEP_COMPETITION_SLUG} Competition does not exist`)
  console.log(`keep competition: ${keep.name} (#${keep.id})`)

  if (!CONFIRMED) {
    console.log('\nAll guards passed. Re-run with --yes to apply.')
    return
  }

  const A = admin.id
  const AP = adminProfile.id
  const deleted: Record<string, number> = {}
  const note = (k: string, n: number) => { if (n) deleted[k] = n }

  console.log('\ndeleting…')
  await prisma.$transaction(async (tx) => {
    // ---- 1. Season graph. Children first; the rating ledger points at seasons, so it goes before them.
    note('season_group_player', (await tx.seasonGroupPlayer.deleteMany({})).count)
    note('season_match', (await tx.seasonMatch.deleteMany({})).count)
    note('season_standing', (await tx.seasonStanding.deleteMany({})).count)
    note('season_playoff_match', (await tx.seasonPlayoffMatch.deleteMany({})).count)
    note('season_entrant', (await tx.seasonEntrant.deleteMany({})).count)
    note('season_group', (await tx.seasonGroup.deleteMany({})).count)

    // ---- 2. SOFT REFERENCE: rating_ledger has no FK to season or Player. Explicit.
    note('rating_ledger', (await tx.ratingLedger.deleteMany({})).count)

    note('season', (await tx.season.deleteMany({})).count)

    // ---- 3. Tournament graph, children first.
    note('comp_playoff_match', (await tx.playoffMatch.deleteMany({})).count)
    note('comp_swiss_match', (await tx.swissMatch.deleteMany({})).count)
    note('comp_tournament_match', (await tx.tournamentMatch.deleteMany({})).count)
    note('comp_standing', (await tx.standing.deleteMany({})).count)
    note('comp_group_player', (await tx.groupPlayer.deleteMany({})).count)
    note('comp_tournament_group', (await tx.tournamentGroup.deleteMany({})).count)
    note('comp_tournament_bracket_match', (await tx.tournamentBracketMatch.deleteMany({})).count)
    note('comp_tournament_team_member', (await tx.tournamentTeamMember.deleteMany({})).count)
    note('comp_tournament_team', (await tx.tournamentTeam.deleteMany({})).count)
    note('comp_tournament_free_agent', (await tx.tournamentFreeAgent.deleteMany({})).count)

    // ---- 4. SOFT REFERENCE: comp_registration keys off a username string. Explicit.
    note('comp_registration', (await tx.registration.deleteMany({})).count)

    // ---- 5. Generated summary derived from the removed records.
    note('comp_tournament_snapshot', (await tx.tournamentSnapshot.deleteMany({})).count)
    note('comp_tournament', (await tx.tournament.deleteMany({})).count)
    note('tournament_flair_default', (await tx.tournamentFlairDefault.deleteMany({})).count)

    // ---- 6. The legacy competition graph (the archive-shaped models), children first.
    note('MatchResult', (await tx.matchResult.deleteMany({})).count)
    note('HeadToHead', (await tx.headToHead.deleteMany({})).count)
    note('Championship', (await tx.championship.deleteMany({})).count)
    note('Match', (await tx.match.deleteMany({})).count)
    note('StandingRow', (await tx.standingRow.deleteMany({})).count)
    note('Seed', (await tx.seed.deleteMany({})).count)
    note('Bracket', (await tx.bracket.deleteMany({})).count)
    note('Group', (await tx.group.deleteMany({})).count)
    note('Stage', (await tx.stage.deleteMany({})).count)
    note('CompetitionEntry', (await tx.competitionEntry.deleteMany({})).count)
    note('Division', (await tx.division.deleteMany({})).count)
    note('RankingSnapshotItem', (await tx.rankingSnapshotItem.deleteMany({})).count)
    note('RankingSnapshot', (await tx.rankingSnapshot.deleteMany({})).count)

    // ---- 7. Historical Player records. None of these are required by the Admin profile.
    note('PlayerSeasonStat', (await tx.playerSeasonStat.deleteMany({})).count)
    note('PlayerCareerStat', (await tx.playerCareerStat.deleteMany({})).count)
    note('HallOfFameEntry', (await tx.hallOfFameEntry.deleteMany({})).count)
    note('Achievement', (await tx.achievement.deleteMany({})).count)
    note('Competitor', (await tx.competitor.deleteMany({})).count)
    note('TeamMembership', (await tx.teamMembership.deleteMany({})).count)
    note('Team', (await tx.team.deleteMany({})).count)
    note('PlayerMerge', (await tx.playerMerge.deleteMany({})).count)
    note('PlayerSplit', (await tx.playerSplit.deleteMany({})).count)
    note('PlayerAlias', (await tx.playerAlias.deleteMany({})).count)
    note('Competition', (await tx.competition.deleteMany({})).count)

    // ---- 8. Provenance / reporting tables tied to the removed records.
    note('SourceReference', (await tx.sourceReference.deleteMany({})).count)
    note('HistoricalCorrection', (await tx.historicalCorrection.deleteMany({})).count)
    note('IssueReport', (await tx.issueReport.deleteMany({})).count)
    note('account_claim', (await tx.accountClaim.deleteMany({})).count)

    // ---- 9. Every Player except the Admin's linked profile.
    note('Player', (await tx.player.deleteMany({ where: { id: { not: AP } } })).count)

    // ---- 10. Member state for everyone but the Admin.
    note('member_warning', (await tx.warning.deleteMany({})).count)
    note('member_penalty', (await tx.penalty.deleteMany({ where: { userId: { not: A } } })).count)
    note('member_moderation', (await tx.memberModeration.deleteMany({ where: { userId: { not: A } } })).count)
    note('password_reset_state', (await tx.passwordResetState.deleteMany({})).count)

    // ---- 11. SOFT REFERENCE: staff_designation keys off a bare user id. Keep only the Admin's.
    note('staff_designation', (await tx.staffDesignation.deleteMany({ where: { userId: { not: A } } })).count)

    // ---- 12. SOFT REFERENCE: comp_audit_log keys off actorUsername/entityId with no FK. Every row
    //          describes work on data that no longer exists, so the log is cleared and a single
    //          entry recording this reset is written afterwards.
    note('comp_audit_log', (await tx.auditLog.deleteMany({})).count)

    // ---- 13. Competitions: keep only 8BRCAM. Safe now that no Season references one.
    note('competition_series', (await tx.competitionSeries.deleteMany({ where: { id: { not: keep.id } } })).count)

    // ---- 14. Payload accounts. Sessions and roles are children of users, removed first.
    note('payload.users_sessions', await tx.$executeRaw`DELETE FROM payload.users_sessions WHERE _parent_id <> ${A}`)
    note('payload.users_roles', await tx.$executeRaw`DELETE FROM payload.users_roles WHERE parent_id <> ${A}`)
    note('payload.users', await tx.$executeRaw`DELETE FROM payload.users WHERE id <> ${A}`)
  }, { timeout: 15 * 60_000, maxWait: 60_000 })

  // ---- keep the surviving Competition active
  await prisma.competitionSeries.update({ where: { id: keep.id }, data: { active: true } })

  // ---- the one audit entry that documents this
  await prisma.auditLog.create({
    data: {
      actorUserId: A,
      actorUsername: admin.username,
      action: 'registry.reset',
      entity: 'System',
      reason: 'Authorized local registry data reset for manual rebuild. History preserved in the ' +
        'offline 8BRCAM Season Archive; the Admin account, its linked profile and the 8BRCAM ' +
        'Competition were retained.',
      newValue: { deleted, keptUserId: A, keptPlayerId: AP, keptCompetitionId: keep.id },
    },
  })

  const rows = Object.entries(deleted).sort((a, b) => b[1] - a[1])
  for (const [k, n] of rows) console.log(`  ${String(n).padStart(7)}  ${k}`)
  console.log(`\ntotal rows deleted: ${rows.reduce((s, [, n]) => s + n, 0)}`)
  console.log('audit entry written: registry.reset')
}

let failed = false
main()
  .catch((e) => { console.error(e); failed = true })
  .finally(async () => {
    await prisma.$disconnect()
    process.exit(failed ? 1 : 0)
  })
