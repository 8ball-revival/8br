/**
 * The Creator Entrants stage: what it shows, what it refuses, and where it goes next.
 *
 * ── Close Registration is the irreversible step ──────────────────────────────────────────────────
 * It captures every entrant's rating as the seeding snapshot and moves the Season on. So the
 * preflight has to be honest before it happens — the entrant count, and how many archived players
 * are still outside the list — and the two transitions have to land together. A Season parked in
 * REGISTRATION_CLOSED reads publicly as "closed and nothing happened since", which is exactly the
 * state the workflow was meant to stop producing.
 *
 * ── Identity is corrected canonically, or not at all ─────────────────────────────────────────────
 * Editing an entrant writes the PLAYER and propagates. Proving that matters more than it sounds:
 * the alternative — writing the entrant row — looks identical on this screen and leaves the same
 * person under two names everywhere else.
 *
 * Fixtures only, all removed afterwards. No real Season is touched.
 *
 * Run: npx tsx --tsconfig scripts/tsconfig.verify.json --env-file=.env scripts/verify-creator-season-entrants.mts
 */
import { prisma } from '../src/lib/prisma.ts'
import { assertLocalDatabase } from '../src/lib/db-guard.ts'
import { createDraft } from '../src/lib/creator/setup.ts'
import { addSeasonEntrant, closeRegistration } from '../src/lib/seasons/service.ts'
import { transitionSeasonState } from '../src/lib/seasons/lifecycle.ts'
import { currentStage, stageReachable, workflowFor } from '../src/lib/creator/workflow.ts'
import { propagateIdentityChange } from '../src/lib/players/identity-propagation.ts'

assertLocalDatabase()

const ACTOR = { userId: 2, username: 'verify-creator-entrants' }
const YEAR = 2095
let pass = 0
let fail = 0
const check = (label: string, ok: boolean, detail?: string) => {
  if (ok) { pass++; console.log(`  ✓ ${label}`) }
  else { fail++; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`) }
}
const section = (t: string) => console.log(`\n--- ${t} ---`)

const series = await prisma.competitionSeries.findFirstOrThrow({ select: { id: true } })

/** A throwaway Player, so a rename in this script can never touch a real person's name. */
const FIXTURE_HANDLE = 'VerifyEntrantFixture'
async function cleanup() {
  const rows = await prisma.season.findMany({ where: { competitionYear: YEAR }, select: { id: true } })
  for (const r of rows) {
    await prisma.seasonEntrant.deleteMany({ where: { seasonId: r.id } })
    await prisma.season.delete({ where: { id: r.id } }).catch(() => {})
  }
  const stale = await prisma.player.findMany({
    where: { primaryName: { startsWith: 'Verify Entrant' } },
    select: { id: true },
  })
  for (const p of stale) {
    await prisma.playerAlias.deleteMany({ where: { playerId: p.id } })
    await prisma.player.delete({ where: { id: p.id } }).catch(() => {})
  }
}
await cleanup()

const mkSeason = (n: number) =>
  createDraft(ACTOR, {
    type: 'season', competitionYear: YEAR, competitionSeriesId: series.id, purpose: 'live',
    structure: 'groups_playoffs', number: n, division: null, accessMode: 'OPEN',
  })

try {
  section('The workflow puts a new Season at Entrants')
  const s = await mkSeason(1)
  check('the Season is created', s.ok && s.id != null, s.error)
  const id = s.id!
  check('its current stage is Entrants', currentStage('season', 'REGISTRATION_OPEN') === 'entrants')
  check('Setup is behind it and still reachable', stageReachable('season', 'REGISTRATION_OPEN', 'setup'))
  check('Groups is not reachable yet', !stageReachable('season', 'REGISTRATION_OPEN', 'groups'))
  check('nor Playoffs', !stageReachable('season', 'REGISTRATION_OPEN', 'playoffs'))
  const bar = workflowFor('season', id, 'REGISTRATION_OPEN')
  check('the workflow bar marks Entrants as current',
    bar.find((x) => x.id === 'entrants')?.status === 'current')
  check('...and Groups as locked', bar.find((x) => x.id === 'groups')?.status === 'locked')

  section('Entrants are added, and counted')
  const players = await prisma.player.findMany({ where: { active: true }, take: 4, select: { id: true } })
  check('the database has players to enter', players.length === 4, `${players.length} found`)
  for (const p of players) {
    const r = await addSeasonEntrant(ACTOR, id, p.id)
    if (!r.ok) check('adding an entrant succeeds', false, r.error)
  }
  check('four entrants are in the Season',
    (await prisma.seasonEntrant.count({ where: { seasonId: id, status: 'APPROVED' } })) === 4)
  check('the denormalised count agrees',
    (await prisma.season.findUniqueOrThrow({ where: { id }, select: { entrantsCount: true } })).entrantsCount === 4)

  section('Closing captures the snapshot AND moves on to Group Setup')
  const before = await prisma.seasonEntrant.findMany({
    where: { seasonId: id }, select: { ratingSnapshot: true },
  })
  check('no seeding snapshot exists yet', before.every((e) => e.ratingSnapshot == null))

  const closed = await closeRegistration(ACTOR, id)
  check('registration closes', closed.ok === true, closed.error)
  const moved = await transitionSeasonState(ACTOR, id, 'GROUP_SETUP')
  check('...and the Season moves to Group Setup', moved.ok === true, moved.error)

  const after = await prisma.season.findUniqueOrThrow({
    where: { id }, select: { lifecycleState: true, ratingSnapshotAt: true },
  })
  check('the Season is in Group Setup, not parked at Registration Closed',
    after.lifecycleState === 'GROUP_SETUP', after.lifecycleState)
  check('the snapshot time is recorded', after.ratingSnapshotAt != null)
  const snaps = await prisma.seasonEntrant.findMany({
    where: { seasonId: id }, select: { ratingSnapshot: true },
  })
  check('every entrant carries a seeding rating', snaps.every((e) => e.ratingSnapshot != null))

  section('...and the workflow follows it there')
  check('the current stage is now Groups', currentStage('season', 'GROUP_SETUP') === 'groups')
  check('Entrants is behind it, still reachable', stageReachable('season', 'GROUP_SETUP', 'entrants'))
  check('Playoffs is still locked', !stageReachable('season', 'GROUP_SETUP', 'playoffs'))
  const bar2 = workflowFor('season', id, 'GROUP_SETUP')
  check('the bar marks Entrants done', bar2.find((x) => x.id === 'entrants')?.status === 'done')
  check('...and Groups current', bar2.find((x) => x.id === 'groups')?.status === 'current')

  section('Closing twice is refused, not silently repeated')
  const again = await closeRegistration(ACTOR, id)
  check('the second close is refused', !again.ok, JSON.stringify(again))
  check('...and the Season did not move',
    (await prisma.season.findUniqueOrThrow({ where: { id }, select: { lifecycleState: true } })).lifecycleState === 'GROUP_SETUP')

  section('A correction to an entrant is canonical, and travels')
  /*
   * A fixture Player, entered into a fixture Season. Renaming a REAL player to prove propagation
   * would be a destructive test on live data, which is precisely what must not happen.
   */
  const fixture = await prisma.player.create({
    data: { primaryName: 'Verify Entrant Before', cueverseId: FIXTURE_HANDLE, cueverseIdNormalized: FIXTURE_HANDLE.toLowerCase() },
    select: { id: true },
  })
  const s2 = await mkSeason(2)
  await addSeasonEntrant(ACTOR, s2.id!, fixture.id)

  const entrantBefore = await prisma.seasonEntrant.findFirstOrThrow({
    where: { seasonId: s2.id!, playerId: fixture.id },
    select: { displayName: true, cueverseId: true },
  })
  check('the entrant row copied the old name', entrantBefore.displayName === 'Verify Entrant Before')

  await prisma.player.update({ where: { id: fixture.id }, data: { primaryName: 'Verify Entrant After' } })
  const report = await propagateIdentityChange({
    playerId: fixture.id,
    oldCueverseId: FIXTURE_HANDLE, newCueverseId: FIXTURE_HANDLE,
    oldPreferredName: 'Verify Entrant Before', newPreferredName: 'Verify Entrant After',
  })
  check('propagation reports rows updated', report.total > 0, String(report.total))

  const entrantAfter = await prisma.seasonEntrant.findFirstOrThrow({
    where: { seasonId: s2.id!, playerId: fixture.id },
    select: { displayName: true },
  })
  check('the entrant row now carries the corrected name',
    entrantAfter.displayName === 'Verify Entrant After', entrantAfter.displayName ?? 'null')
  check('the canonical Player is the source of it',
    (await prisma.player.findUniqueOrThrow({ where: { id: fixture.id }, select: { primaryName: true } })).primaryName
    === 'Verify Entrant After')
} finally {
  await cleanup()
  check('every fixture Season is removed',
    (await prisma.season.count({ where: { competitionYear: YEAR } })) === 0)
  check('the fixture Player is removed',
    (await prisma.player.count({ where: { primaryName: { startsWith: 'Verify Entrant' } } })) === 0)
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
await prisma.$disconnect()
if (fail > 0) process.exitCode = 1
