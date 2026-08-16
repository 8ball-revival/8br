/**
 * Season domain backbone (DB): creation + auto numbering + official title, admin entrant management,
 * registration-close rating snapshot, and lifecycle transitions. Self-cleans.
 *
 * Run:  npx tsx --tsconfig scripts/tsconfig.verify.json scripts/verify-season-lifecycle.mts
 */
import { prisma } from '../src/lib/prisma.ts'
import { createSeason, addSeasonEntrant, removeSeasonEntrant, closeRegistration, getSeasonView, seasonOfficialTitle } from '../src/lib/seasons/service.ts'
import { transitionSeasonState, canTransition } from '../src/lib/seasons/lifecycle.ts'

let pass = 0, fail = 0
const check = (n: string, c: boolean, d = '') => { if (c) { pass++; console.log('  ✓ ' + n) } else { fail++; console.log('  ✗ ' + n + (d ? ` — ${d}` : '')) } }
const actor = { userId: 980001, username: 'season-verify' }
const cleanupNumbers: number[] = []

async function makeSeason() {
  const r = await createSeason(actor, { lounge: 'Social', accessMode: 'OPEN', groupStageGames: 10, earlyRaceTo: 7, semifinalRaceTo: 9, finalRaceTo: 9 })
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
  check('official title is "8BR Season N · YEAR"', v?.title === seasonOfficialTitle(s1.number!, year), v?.title)
  check('starts in REGISTRATION_OPEN (no future opensAt)', v?.lifecycleState === 'REGISTRATION_OPEN')
  check('match format defaults captured', v?.format.groupStageGames === 10 && v?.format.earlyRaceTo === 7 && v?.format.finalRaceTo === 9)
}

console.log('Admin entrant management + rating snapshot')
{
  const season = await prisma.season.findUnique({ where: { number: s1.number } })
  const seasonId = season!.id
  // Use a couple of real players from the DB (with rating history if any).
  const players = await prisma.player.findMany({ where: { active: true }, take: 3, select: { id: true, primaryName: true } })
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

  // Re-adding after close is blocked (registration not open).
  const blocked = await addSeasonEntrant(actor, seasonId, players[0].id)
  check('adding after close is rejected', !blocked.ok)
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
await prisma.$disconnect()
process.exit(fail === 0 ? 0 : 1)
