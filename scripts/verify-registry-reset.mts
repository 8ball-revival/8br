/**
 * Asserts the local database is in the post-reset state: one Admin, one linked profile, one active
 * 8BRCAM Competition, and nothing else competition-related left behind.
 *
 * Read-only. Deliberately checks the four soft references by hand, since no foreign key would have
 * stopped them being orphaned.
 *
 * Run: npx tsx --tsconfig scripts/tsconfig.verify.json scripts/verify-registry-reset.mts
 */
import { prisma } from '../src/lib/prisma.ts'

/**
 * Prefixes the verification suites use for their own throwaway rows.
 *
 * The counts below must be able to run alongside the rest of the suite, which legitimately creates
 * and removes fixtures while it works. Excluding these prefixes keeps the check order-independent
 * without weakening it: real leftover data - an archive account, an imported Season - carries none of
 * them and is still caught.
 */
const FIXTURE = ['zz', 'idv-', 'APV-']
const notFixtureText = (field: string) =>
  ({ AND: FIXTURE.map((p) => ({ NOT: { [field]: { startsWith: p } } })) }) as never

let pass = 0, fail = 0
const check = (n: string, ok: boolean, d = '') => {
  if (ok) { pass++; console.log('  ✓ ' + n) } else { fail++; console.log('  ✗ ' + n + (d ? ` — ${d}` : '')) }
}
const eq = (n: string, got: number, want: number) => check(`${n} = ${want}`, got === want, `got ${got}`)
const one = async (sql: Promise<{ n: bigint }[]>) => Number((await sql)[0].n)

async function main() {
  console.log('--- Admin identity ---')
  const users = await prisma.$queryRaw<{ id: number; username: string }[]>`
    SELECT id, username FROM payload.users ORDER BY id`
  eq('users', users.length, 1)
  const adminId = users[0]?.id
  check('the surviving account holds the owner role',
    (await one(prisma.$queryRaw`SELECT count(*)::bigint n FROM payload.users_roles
      WHERE parent_id = ${adminId} AND value = 'owner'`)) > 0)
  check('its authentication material is intact',
    (await one(prisma.$queryRaw`SELECT count(*)::bigint n FROM payload.users
      WHERE id = ${adminId} AND hash IS NOT NULL AND salt IS NOT NULL AND email IS NOT NULL`)) === 1)
  eq('staff designations', await prisma.staffDesignation.count(), 1)
  check('the staff designation belongs to the Admin',
    (await prisma.staffDesignation.count({ where: { userId: adminId } })) === 1)
  check('the Admin is not under moderation',
    (await prisma.memberModeration.count({ where: { userId: adminId } })) === 0)

  console.log('\n--- Players ---')
  eq('real (non-fixture) players', await prisma.player.count({ where: notFixtureText('primaryName') }), 1)
  eq('profiles linked to an account', await prisma.player.count({ where: { linkedUserId: { not: null } } }), 1)
  const p = await prisma.player.findFirst({
    where: { linkedUserId: { not: null } },
    select: { id: true, linkedUserId: true, cueverseId: true, active: true, linkStatus: true },
  })
  check('the one profile is linked to the Admin', p?.linkedUserId === String(adminId), String(p?.linkedUserId))
  check('it is active and verified', p?.active === true && p?.linkStatus === 'VERIFIED')

  console.log('\n--- Competitions ---')
  const comps = await prisma.competitionSeries.findMany({
    where: notFixtureText('slug'), select: { slug: true, active: true },
  })
  eq('real (non-fixture) competitions', comps.length, 1)
  check('it is 8BRCAM and active', comps[0]?.slug === '8brcam' && comps[0]?.active === true, JSON.stringify(comps[0]))

  console.log('\n--- Everything else is empty ---')
  const zero: Array<[string, number]> = [
    ['real seasons', await prisma.season.count({ where: notFixtureText('slug') })],
    ['entrants on a real season', await prisma.seasonEntrant.count({ where: { season: notFixtureText('slug') } })],
    ['groups on a real season', await prisma.seasonGroup.count({ where: { season: notFixtureText('slug') } })],
    ['group players on a real season', await prisma.seasonGroupPlayer.count({ where: { group: { season: notFixtureText('slug') } } })],
    ['matches on a real season', await prisma.seasonMatch.count({ where: { season: notFixtureText('slug') } })],
    ['standings on a real season', await prisma.seasonStanding.count({ where: { season: notFixtureText('slug') } })],
    ['playoff matches on a real season', await prisma.seasonPlayoffMatch.count({ where: { season: notFixtureText('slug') } })],
    ['real tournaments', await prisma.tournament.count({ where: notFixtureText('slug') })],
    ['registrations', await prisma.registration.count()],
    ['tournament teams', await prisma.tournamentTeam.count()],
    ['tournament team members', await prisma.tournamentTeamMember.count()],
    ['tournament groups', await prisma.tournamentGroup.count()],
    ['tournament group players', await prisma.groupPlayer.count()],
    ['tournament matches', await prisma.tournamentMatch.count()],
    ['tournament standings', await prisma.standing.count()],
    ['tournament playoff matches', await prisma.playoffMatch.count()],
    ['swiss matches', await prisma.swissMatch.count()],
    ['bracket matches', await prisma.tournamentBracketMatch.count()],
    ['free agents', await prisma.tournamentFreeAgent.count()],
    ['rating rows for a real player', await prisma.ratingLedger.count({ where: notFixtureText('playerName') })],
    ['championships', await prisma.championship.count()],
    ['achievements', await prisma.achievement.count()],
    ['aliases on a real player', await prisma.playerAlias.count({ where: { player: notFixtureText('primaryName') } })],
    ['player merges', await prisma.playerMerge.count()],
    ['player splits', await prisma.playerSplit.count()],
    ['player season stats', await prisma.playerSeasonStat.count()],
    ['player career stats', await prisma.playerCareerStat.count()],
    ['hall of fame entries', await prisma.hallOfFameEntry.count()],
    ['competitors', await prisma.competitor.count()],
    ['teams', await prisma.team.count()],
    ['team memberships', await prisma.teamMembership.count()],
    ['legacy competitions', await prisma.competition.count()],
    ['legacy matches', await prisma.match.count()],
    ['legacy standing rows', await prisma.standingRow.count()],
    ['ranking snapshots', await prisma.rankingSnapshot.count()],
    ['moderation rows', await prisma.memberModeration.count()],
    ['penalties', await prisma.penalty.count()],
    ['warnings', await prisma.warning.count()],
    ['account claims', await prisma.accountClaim.count()],
  ]
  for (const [name, n] of zero) eq(name, n, 0)

  console.log('\n--- No orphaned or dangling references ---')
  eq('real profiles with no account', await prisma.player.count({ where: { linkedUserId: null, ...(notFixtureText('primaryName') as object) } }), 0)
  eq('profiles pointing at a missing account', await one(prisma.$queryRaw`
    SELECT count(*)::bigint n FROM public."Player" p
    WHERE p."linkedUserId" IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM payload.users u WHERE u.id::text = p."linkedUserId")`), 0)
  eq('roles for a missing account', await one(prisma.$queryRaw`
    SELECT count(*)::bigint n FROM payload.users_roles r
    WHERE NOT EXISTS (SELECT 1 FROM payload.users u WHERE u.id = r.parent_id)`), 0)
  eq('sessions for a missing account', await one(prisma.$queryRaw`
    SELECT count(*)::bigint n FROM payload.users_sessions s
    WHERE NOT EXISTS (SELECT 1 FROM payload.users u WHERE u.id = s._parent_id)`), 0)
  eq('staff designations for a missing account', await one(prisma.$queryRaw`
    SELECT count(*)::bigint n FROM public.staff_designation d
    WHERE NOT EXISTS (SELECT 1 FROM payload.users u WHERE u.id = d."userId")`), 0)
  eq('archive-created accounts left behind', await one(prisma.$queryRaw`
    SELECT count(*)::bigint n FROM payload.users WHERE email ILIKE '%@archive.8br.invalid'`), 0)
  eq('archive-created profiles left behind', await one(prisma.$queryRaw`
    SELECT count(*)::bigint n FROM public."Player" WHERE "cueverseId" ILIKE 'p0%' OR "cueverseId" ILIKE 'p1%'`), 0)

  console.log('\n--- Generated summaries hold nothing ---')
  // The snapshot is a singleton cache the app maintains, not per-tournament data. After the reset it
  // may exist again, but it must be empty - asserting the row is absent would fail the moment the
  // app rebuilt its cache.
  const snaps = await prisma.$queryRaw<{ payload: unknown }[]>`
    SELECT payload FROM public.comp_tournament_snapshot`
  check('the tournament snapshot cache is empty',
    snaps.every((s) => !Array.isArray(s.payload) || s.payload.length === 0),
    JSON.stringify(snaps).slice(0, 120))

  console.log('\n--- Audit trail ---')
  // Exclusivity is not asserted: the verification suites write audit rows of their own, so the
  // invariant that matters is that the reset itself is on the record, attributed to the Admin.
  const resets = await prisma.auditLog.findMany({
    where: { action: 'registry.reset' },
    orderBy: { createdAt: 'asc' },
    select: { actorUserId: true, reason: true, createdAt: true },
  })
  check('the reset is recorded in the audit log', resets.length >= 1, `${resets.length} entries`)
  check('it is attributed to the Admin', resets.every((r) => r.actorUserId === adminId))
  check('it states that the reset was authorized',
    resets.some((r) => /authorized/i.test(r.reason ?? '')), resets[0]?.reason?.slice(0, 60) ?? '')
  // The durable invariant: the old competition history really was cleared. An audit log is meant to
  // outlive the rows it describes, so newer entries referencing deleted entities are correct - what
  // must not exist is anything from before the reset.
  if (resets[0]) {
    eq('audit rows predating the reset',
      await prisma.auditLog.count({ where: { createdAt: { lt: resets[0].createdAt } } }), 0)
  }

  console.log('\n--- Preserved site configuration ---')
  check('Payload media preserved',
    (await one(prisma.$queryRaw`SELECT count(*)::bigint n FROM payload.media`)) > 0)
  check('homepage content preserved',
    (await one(prisma.$queryRaw`SELECT count(*)::bigint n FROM payload.homepage_hero`)) > 0)
  check('site branding preserved',
    (await one(prisma.$queryRaw`SELECT count(*)::bigint n FROM payload.site_branding`)) > 0)
  check('migration history preserved',
    (await one(prisma.$queryRaw`SELECT count(*)::bigint n FROM payload.payload_migrations`)) > 0)
  check('admin preferences preserved',
    (await one(prisma.$queryRaw`SELECT count(*)::bigint n FROM payload.payload_preferences`)) > 0)

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
}

main()
  .catch((e) => { console.error(e); fail++ })
  .finally(async () => {
    await prisma.$disconnect()
    process.exit(fail === 0 ? 0 : 1)
  })
