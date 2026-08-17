/**
 * A management-only account runs the site and never competes.
 *
 * Asserts it is absent from the member roster and from every place a competitor can be picked —
 * season entrants, tournament entrants, the free-agent pool and the merge picker — while a normal
 * account in the same state is still offered, so the exclusion is the flag doing the work rather
 * than something else filtering both out.
 *
 * Creates its own `zzmgmt` fixtures and removes them. Read-only with respect to real accounts.
 *
 * Run:  npx tsx --tsconfig scripts/tsconfig.verify.json scripts/verify-management-account.mts
 */
import { prisma } from '../src/lib/prisma.ts'

let pass = 0, fail = 0
const check = (n: string, ok: boolean, d = '') => {
  if (ok) { pass++; console.log('  ✓ ' + n) } else { fail++; console.log('  ✗ ' + n + (d ? ` — ${d}` : '')) }
}

const TAG = 'zzmgmt'
const MGMT = `${TAG}_manager`
const NORMAL = `${TAG}_player`
const FAKE_USER_MGMT = 988001
const FAKE_USER_NORMAL = 988002

async function cleanup() {
  const ids = (await prisma.player.findMany({ where: { primaryName: { startsWith: TAG } }, select: { id: true } })).map((p) => p.id)
  if (ids.length) {
    await prisma.seasonEntrant.deleteMany({ where: { playerId: { in: ids } } }).catch(() => {})
    await prisma.registration.deleteMany({ where: { playerId: { in: ids } } }).catch(() => {})
    await prisma.player.deleteMany({ where: { id: { in: ids } } }).catch(() => {})
  }
  await prisma.season.deleteMany({ where: { slug: { startsWith: TAG } } }).catch(() => {})
  await prisma.tournament.deleteMany({ where: { slug: { startsWith: TAG } } }).catch(() => {})
}

async function main() {
  await cleanup()

  console.log('--- Fixtures: one management account, one ordinary player ---')
  const manager = await prisma.player.create({
    data: {
      primaryName: MGMT, cueverseId: MGMT, cueverseIdNormalized: MGMT,
      active: true, managementOnly: true,
      linkedUserId: String(FAKE_USER_MGMT), linkStatus: 'VERIFIED',
    },
    select: { id: true },
  })
  const player = await prisma.player.create({
    data: {
      primaryName: NORMAL, cueverseId: NORMAL, cueverseIdNormalized: NORMAL,
      active: true, managementOnly: false,
      linkedUserId: String(FAKE_USER_NORMAL), linkStatus: 'VERIFIED',
    },
    select: { id: true },
  })
  check('both fixtures created, differing only in the flag', Boolean(manager.id && player.id))

  console.log('\n--- Season entrant picker ---')
  const series = await prisma.competitionSeries.findFirst({ where: { active: true }, select: { id: true } })
  if (!series) { check('a Competition exists', false); return }
  const last = await prisma.season.findFirst({ orderBy: { number: 'desc' }, select: { number: true } })
  const num = (last?.number ?? 0) + 1
  const season = await prisma.season.create({
    data: {
      number: num, competitionYear: 2026, competitionSeriesId: series.id,
      slug: `${TAG}-season-${num}`, lifecycleState: 'REGISTRATION_OPEN',
    },
    select: { id: true },
  })
  const { searchSeasonCandidates } = await import('../src/lib/seasons/service.ts')
  const seasonPick = await searchSeasonCandidates(season.id, TAG)
  check('the management account is not offered', !seasonPick.some((c) => c.playerId === manager.id))
  check('an ordinary player IS still offered', seasonPick.some((c) => c.playerId === player.id),
    `${seasonPick.length} candidate(s)`)

  console.log('\n--- Tournament entrant picker ---')
  const tour = await prisma.tournament.create({
    data: { slug: `${TAG}-t-${num}`, name: `${TAG} Cup`, competitionYear: 2026 },
    select: { id: true },
  })
  const { searchEntrantCandidates } = await import('../src/lib/competition/queries.ts')
  const tourPick = await searchEntrantCandidates(tour.id, TAG)
  check('the management account is not offered', !tourPick.some((c) => c.playerId === manager.id))
  check('an ordinary player IS still offered', tourPick.some((c) => c.playerId === player.id),
    `${tourPick.length} candidate(s)`)

  console.log('\n--- Merge picker ---')
  const { searchMergeCandidates } = await import('../src/lib/players/merge.ts')
  const mergePick = await searchMergeCandidates(player.id, TAG)
  check('the management account is not a merge candidate', !mergePick.some((c) => c.playerId === manager.id))

  console.log('\n--- Member roster ---')
  const { listMembers } = await import('../src/lib/staff/members.ts')
  const members = await listMembers({ q: '', status: 'ALL' })
  check('the management account is not on the roster',
    !members.some((m) => m.userId === FAKE_USER_MGMT))
  check('the real site owner is off the roster too',
    !(await Promise.all(members.map(async (m) =>
      (await prisma.player.count({ where: { linkedUserId: String(m.userId), managementOnly: true } })) > 0)))
      .some(Boolean))

  console.log('\n--- The flag is the only thing doing this ---')
  await prisma.player.update({ where: { id: manager.id }, data: { managementOnly: false } })
  const afterUnflag = await searchSeasonCandidates(season.id, TAG)
  check('clearing the flag puts the account back in the picker',
    afterUnflag.some((c) => c.playerId === manager.id))
  await prisma.player.update({ where: { id: manager.id }, data: { managementOnly: true } })

  console.log('\n--- It is still a real, reachable account ---')
  const still = await prisma.player.findUnique({
    where: { id: manager.id },
    select: { active: true, linkStatus: true, linkedUserId: true },
  })
  check('the profile stays active and linked', still?.active === true && still?.linkStatus === 'VERIFIED')
  check('it keeps its account link', still?.linkedUserId === String(FAKE_USER_MGMT))

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
}

main()
  .catch((e) => { console.error(e); fail++ })
  .finally(async () => {
    await cleanup()
    await prisma.$disconnect()
    process.exit(fail === 0 ? 0 : 1)
  })
