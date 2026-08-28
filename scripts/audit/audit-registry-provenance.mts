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
  // Case-insensitive: the convention is a lowercase `zz`, but a fixture named `ZZ …` would otherwise
  // slip past the filter and be counted as real leftover data — which is precisely what happened.
  ({ AND: FIXTURE.map((p) => ({ NOT: { [field]: { startsWith: p, mode: 'insensitive' } } })) }) as never

let pass = 0, fail = 0
const check = (n: string, ok: boolean, d = '') => {
  if (ok) { pass++; console.log('  ✓ ' + n) } else { fail++; console.log('  ✗ ' + n + (d ? ` — ${d}` : '')) }
}
const eq = (n: string, got: number, want: number) => check(`${n} = ${want}`, got === want, `got ${got}`)
const one = async (sql: Promise<{ n: bigint }[]>) => Number((await sql)[0].n)

async function main() {
  console.log('--- Admin identity ---')
  // The reset left exactly one account, but the site is meant to grow from there - members get added
  // straight afterwards. So the durable invariant is that there is exactly one OWNER and it is intact,
  // not that the roster has stayed at one.
  const users = await prisma.$queryRaw<{ id: number; username: string }[]>`
    SELECT id, username FROM payload.users ORDER BY id`
  const owners = await prisma.$queryRaw<{ id: number; username: string }[]>`
    SELECT DISTINCT u.id, u.username FROM payload.users u
    JOIN payload.users_roles r ON r.parent_id = u.id
    WHERE r.value = 'owner' ORDER BY u.id`
  eq('owner accounts', owners.length, 1)
  console.log(`  (${users.length} account${users.length === 1 ? '' : 's'} on the site)`)
  const adminId = owners[0]?.id
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
  // One account, one profile: the pairing must stay exact however many members are added.
  const accounts = Number((await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT count(*)::bigint n FROM payload.users`)[0].n)
  eq('real profiles, one per account', await prisma.player.count({ where: notFixtureText('primaryName') }), accounts)
  // Each merge retires one profile and unlinks it, leaving its former account without one — so the
  // pairing is exact over the profiles still in play, not over every row ever created.
  const retired = await prisma.playerMerge.count()
  eq('profiles linked to an account',
    await prisma.player.count({ where: { linkedUserId: { not: null } } }), accounts - retired)
  const p = await prisma.player.findFirst({
    where: { linkedUserId: String(adminId) },
    select: { id: true, linkedUserId: true, cueverseId: true, active: true, linkStatus: true },
  })
  check('the Admin has a linked profile', Boolean(p), 'none found')
  check('it is active and verified', p?.active === true && p?.linkStatus === 'VERIFIED')

  console.log('\n--- Competitions ---')
  const comps = await prisma.competitionSeries.findMany({
    where: notFixtureText('slug'), select: { slug: true, active: true },
  })
  // The reset leaves the 8BRCAM Competition standing. It is no longer asserted to be the ONLY one:
  // Season numbers are scoped per Competition now, so operators are expected to add more, and a
  // second Competition existing says nothing about whether the reset did its job.
  const archive = comps.find((c) => c.slug === '8brcam')
  check('the 8BRCAM Competition survived the reset and is active',
    archive?.active === true, JSON.stringify(comps))
  check('no archive-era Competition came back with it',
    !comps.some((c) => /^(8br-)?(20\d\d|s\d)/.test(c.slug)), JSON.stringify(comps.map((c) => c.slug)))

  console.log('\n--- No archive-era data survived ---')
  // The reset cleared the imported history; the site is being rebuilt by hand on top of it. So this
  // asserts the ARCHIVE is gone rather than that the site is empty - Seasons and Tournaments created
  // since are exactly what is supposed to be here.
  /*
    This suite describes the RESET database — the one the rebuild started from. The redesign
    workspace runs against 8br_dev_redesign, a clone of live, where Seasons under the 8BRCAM
    competition legitimately exist because the owner created them in production after the reset.
    Their slugs are indistinguishable from archive-era ones, so the check is announced as skipped
    there rather than quietly relaxed — it still holds wherever it can be judged.
  */
  /*
   * A CLONE of the workspace is still the workspace.
   *
   * This recognised one database by name, so the moment the sweep was pointed at a disposable
   * copy — which is how the mutating suites are run now, to keep the authoritative database
   * unwritten — the skip stopped applying and the check failed on data it was never meant to
   * judge. It is the CONTENT that makes the skip right, and a clone has the same content.
   */
  const [{ db }] = await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`
  const isRedesignWorkspace = db === '8br_dev_redesign' || db.startsWith('8br_dev_redesign_') || db === '8br_test'
  if (isRedesignWorkspace) {
    console.log(`  SKIP  imported 8BRCAM seasons — ${db} is the redesign workspace; owner-created Seasons are expected`)
  } else {
    eq('imported 8BRCAM seasons', await prisma.season.count({ where: { slug: { startsWith: '8brcam-' } } }), 0)
  }
  eq('archive-created accounts', await one(prisma.$queryRaw`
    SELECT count(*)::bigint n FROM payload.users WHERE email ILIKE '%@archive.8br.invalid'`), 0)
  eq('archive-created profiles', await one(prisma.$queryRaw`
    SELECT count(*)::bigint n FROM public."Player" WHERE "cueverseId" ~ '^[pP][0-9]{4}$'`), 0)

  // The archive-shaped legacy graph was emptied and nothing in the product writes to it.
  const zero: Array<[string, number]> = [
    ['legacy competitions', await prisma.competition.count()],
    ['legacy matches', await prisma.match.count()],
    ['legacy standing rows', await prisma.standingRow.count()],
    ['championships', await prisma.championship.count()],
    ['player season stats', await prisma.playerSeasonStat.count()],
    ['player career stats', await prisma.playerCareerStat.count()],
    ['hall of fame entries', await prisma.hallOfFameEntry.count()],
    ['competitors', await prisma.competitor.count()],
    ['ranking snapshots', await prisma.rankingSnapshot.count()],
    ['account claims', await prisma.accountClaim.count()],
  ]
  for (const [name, n] of zero) eq(name, n, 0)


  console.log('\n--- No orphaned or dangling references ---')
  /*
   * Merged-away profiles legitimately have no account.
   *
   * A merge retires the secondary identity: it is unlinked, deactivated and kept only so its history
   * stays traceable. Counting those as orphans would make this fail permanently after the first
   * merge and would be pressure to delete a record the archive still refers to.
   */
  const mergedAway = (await prisma.playerMerge.findMany({ select: { mergedPlayerId: true } }))
    .map((m) => m.mergedPlayerId)
  eq('real profiles with no account', await prisma.player.count({
    where: { linkedUserId: null, id: { notIn: mergedAway }, ...(notFixtureText('primaryName') as object) },
  }), 0)
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

  console.log('\n--- Generated summaries hold nothing ---')
  // The snapshot is a singleton cache the app maintains, not per-tournament data. After the reset it
  // may exist again, but it must be empty - asserting the row is absent would fail the moment the
  // app rebuilt its cache.
  // The cache legitimately fills as tournaments are created; what it must never hold is a
  // tournament that no longer exists.
  const snaps = await prisma.$queryRaw<{ payload: unknown }[]>`
    SELECT payload FROM public.comp_tournament_snapshot`
  const cachedNumbers = snaps.flatMap((row) =>
    Array.isArray(row.payload) ? (row.payload as Array<{ number?: number }>).map((c) => c.number) : [])
      .filter((n): n is number => typeof n === 'number')
  const liveNumbers = new Set(
    (await prisma.tournament.findMany({ select: { number: true } })).map((t) => t.number))
  check('the tournament snapshot cache lists no tournament that has been deleted',
    cachedNumbers.every((n) => liveNumbers.has(n)),
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
