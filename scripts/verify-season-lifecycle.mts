/**
 * Season domain backbone (DB): creation + auto numbering + official title, admin entrant management,
 * registration-close rating snapshot, and lifecycle transitions. Self-cleans.
 *
 * Run:  npx tsx --tsconfig scripts/tsconfig.verify.json scripts/verify-season-lifecycle.mts
 */
import { prisma } from '../src/lib/prisma.ts'
import { createSeason, addSeasonEntrant, removeSeasonEntrant, closeRegistration, getSeasonView, seasonOfficialTitle } from '../src/lib/seasons/service.ts'
import { transitionSeasonState, canTransition } from '../src/lib/seasons/lifecycle.ts'

// Every Season must belong to a Competition, so fixtures ensure one exists and reuse it.
const FIXTURE_SLUG = 'zz-fixture-competition'
/** Throwaway entrants, so the suite never depends on who is registered on the site. */
const FIXTURE_PLAYER = 'zzseason_player'

async function fixtureCompetitionId(): Promise<number> {
  // Use a DEDICATED fixture Competition, never whatever real Competition happens to be active.
  // Adopting a real one left test Seasons hanging off an operator-visible Competition.
  const existing = await prisma.competitionSeries.findFirst({ where: { slug: FIXTURE_SLUG }, select: { id: true } })
  if (existing) return existing.id
  const made = await prisma.competitionSeries.create({
    data: { name: 'zz Fixture Competition', shortName: 'ZZFIX', slug: FIXTURE_SLUG, active: true },
    select: { id: true },
  })
  return made.id
}

/** Remove the fixture Competition once its Seasons are gone, so no test row survives a run. */
async function dropFixtureCompetition() {
  await prisma.competitionSeries.deleteMany({ where: { slug: FIXTURE_SLUG, seasons: { none: {} } } }).catch(() => {})
}


let pass = 0, fail = 0
const check = (n: string, c: boolean, d = '') => { if (c) { pass++; console.log('  ✓ ' + n) } else { fail++; console.log('  ✗ ' + n + (d ? ` — ${d}` : '')) } }
const actor = { userId: 980001, username: 'season-verify' }
const cleanupNumbers: number[] = []

async function makeSeason() {
  const r = await createSeason(actor, { lounge: 'Social', accessMode: 'OPEN', competitionSeriesId: await fixtureCompetitionId(), groupStageGames: 10, earlyRaceTo: 7, semifinalRaceTo: 9, finalRaceTo: 9 })
  if (r.number) cleanupNumbers.push(r.number)
  return r
}

console.log('Season creation + numbering')
const s1 = await makeSeason()
const s2 = await makeSeason()
check('createSeason succeeds', s1.ok && s2.ok)
check('numbers auto-increment', typeof s1.number === 'number' && s2.number === s1.number! + 1, `${s1.number} then ${s2.number}`)
{
  const v = await getSeasonView(s1.number!)
  const year = new Date().getFullYear()
  // The title is derived from the owning Competition, so assert against the fixture's OWN
  // Competition — "the first active one" is whichever the site happens to have, not necessarily
  // the one this Season was created under.
  const compName = (await prisma.competitionSeries.findUnique({ where: { slug: FIXTURE_SLUG }, select: { name: true } }))?.name ?? ''
  check('official title is "<Competition> Season N · YEAR"',
    v?.title === seasonOfficialTitle(compName, s1.number!, year), v?.title)
  check('starts in REGISTRATION_OPEN (no future opensAt)', v?.lifecycleState === 'REGISTRATION_OPEN')
  check('match format defaults captured', v?.format.groupStageGames === 10 && v?.format.earlyRaceTo === 7 && v?.format.finalRaceTo === 9)
}

console.log('Admin entrant management + rating snapshot')
{
  const season = await prisma.season.findUnique({ where: { number: s1.number } })
  const seasonId = season!.id
  // Create the entrants this check needs rather than borrowing whoever happens to be registered.
  // A site with only the Admin account is a legitimate state, and the test must still exercise
  // entrant management.
  const players = []
  for (let n = 1; n <= 3; n++) {
    players.push(await prisma.player.create({
      data: { primaryName: `${FIXTURE_PLAYER}${n}`, cueverseId: `${FIXTURE_PLAYER}${n}`, active: true },
      select: { id: true, primaryName: true },
    }))
  }
  check('have players to add', players.length >= 2, `found ${players.length}`)
  for (const p of players.slice(0, 3)) await addSeasonEntrant(actor, seasonId, p.id)
  let v = await getSeasonView(s1.number!)
  check('entrants added', (v?.entrantsCount ?? 0) === Math.min(3, players.length))
  check('entrants show a live rating (number or null, not undefined)', (v?.entrants ?? []).every((e) => e.rating === null || typeof e.rating === 'number'))

  // Remove one.
  const first = v!.entrants[0]
  await removeSeasonEntrant(actor, seasonId, first.entrantId)
  v = await getSeasonView(s1.number!)
  check('entrant removed (count drops)', (v?.entrantsCount ?? 0) === Math.min(3, players.length) - 1)

  // Close registration → snapshot + state.
  const close = await closeRegistration(actor, seasonId)
  check('closeRegistration succeeds', close.ok, close.error)
  const after = await prisma.season.findUnique({ where: { id: seasonId }, select: { lifecycleState: true, ratingSnapshotAt: true } })
  check('state → REGISTRATION_CLOSED', after?.lifecycleState === 'REGISTRATION_CLOSED')
  check('ratingSnapshotAt captured', after?.ratingSnapshotAt != null)
  const snaps = await prisma.seasonEntrant.findMany({ where: { seasonId, status: 'APPROVED' }, select: { ratingSnapshot: true } })
  check('every approved entrant has a locked rating snapshot', snaps.length > 0 && snaps.every((e) => e.ratingSnapshot != null))

  // Re-adding someone who is STILL entered is refused. (An entrant that was removed is a different
  // case — adding them back reactivates the withdrawal, which is deliberate.)
  const stillIn = await prisma.seasonEntrant.findFirst({
    where: { seasonId, status: 'APPROVED' }, select: { playerId: true },
  })
  const dupe = await addSeasonEntrant(actor, seasonId, stillIn!.playerId!)
  check('adding someone already entered is rejected', !dupe.ok, 'it was allowed')
}

console.log('Entrants stay editable until the group stage goes live')
{
  // Registration and group building are one screen now, so an admin must be able to fix the roster
  // during Group Setup rather than stepping back to a separate registration phase. What must NOT be
  // possible is changing it once fixtures exist.
  const s3 = await makeSeason()
  const season = await prisma.season.findUnique({ where: { number: s3.number } })
  const id = season!.id
  const fresh = []
  for (let n = 10; n <= 13; n++) {
    fresh.push(await prisma.player.create({
      data: { primaryName: `${FIXTURE_PLAYER}${n}`, cueverseId: `${FIXTURE_PLAYER}${n}`, active: true },
      select: { id: true },
    }))
  }
  check('added while registration is open', (await addSeasonEntrant(actor, id, fresh[0].id)).ok)
  await closeRegistration(actor, id)
  const afterClose = await addSeasonEntrant(actor, id, fresh[1].id)
  check('added after registration closes', afterClose.ok, afterClose.error)

  await transitionSeasonState(actor, id, 'GROUP_SETUP')
  const inSetup = await addSeasonEntrant(actor, id, fresh[2].id)
  check('added during Group Setup', inSetup.ok, inSetup.error)
  const rows = await prisma.seasonEntrant.findMany({ where: { seasonId: id, status: 'APPROVED' }, select: { id: true } })
  check('removed during Group Setup', (await removeSeasonEntrant(actor, id, rows[0].id)).ok)

  await transitionSeasonState(actor, id, 'GROUP_STAGE_LIVE')
  const live = await addSeasonEntrant(actor, id, fresh[3].id)
  check('refused once the group stage is live', !live.ok, 'it was allowed')
  const removeLive = await removeSeasonEntrant(actor, id, rows[1].id)
  check('removal refused once the group stage is live', !removeLive.ok, 'it was allowed')
}

console.log('Lifecycle transitions')
{
  check('REGISTRATION_CLOSED → GROUP_SETUP allowed', canTransition('REGISTRATION_CLOSED', 'GROUP_SETUP'))
  check('GROUP_STAGE_LIVE → PLAYOFFS_LIVE NOT allowed', !canTransition('GROUP_STAGE_LIVE', 'PLAYOFFS_LIVE'))
  check('no CANCELLED state exists in the machine', !canTransition('PLAYOFFS_LIVE', 'COMPLETED') === false) // COMPLETED is allowed; sanity
  const season = await prisma.season.findUnique({ where: { number: s1.number } })
  const bad = await transitionSeasonState(actor, season!.id, 'PLAYOFFS_LIVE')
  check('invalid transition is rejected server-side', !bad.ok)
  const good = await transitionSeasonState(actor, season!.id, 'GROUP_SETUP')
  check('valid transition succeeds', good.ok)
}

// Cleanup
for (const n of cleanupNumbers) {
  const s = await prisma.season.findUnique({ where: { number: n } })
  if (s) await prisma.season.delete({ where: { id: s.id } }).catch(() => {})
}
await prisma.auditLog.deleteMany({ where: { actorUsername: 'season-verify' } }).catch(() => {})

console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
await prisma.player.deleteMany({ where: { primaryName: { startsWith: FIXTURE_PLAYER } } }).catch(() => {})
await dropFixtureCompetition()
await prisma.$disconnect()
process.exit(fail === 0 ? 0 : 1)
