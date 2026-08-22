/**
 * The Finals-forfeit marker must never disagree with the bracket it describes.
 *
 * It is a stored derivative: written on the record so that the six surfaces which show a champion do
 * not each re-read the bracket and risk answering differently. That makes staleness the whole risk,
 * so this proves the marker tracks the canonical Final through every way the Final can change:
 *
 *   - a Final played to a score sets it false
 *   - a Final won by forfeit sets it true
 *   - correcting a forfeited Final to a played one clears it
 *   - correcting a played Final to a forfeit sets it
 *   - undoing the Final entirely leaves no stale `true` behind
 *   - recomputing is idempotent, so reopen/recomplete cycles cannot drift
 *   - it always describes the CANONICAL Final — highest round, lowest slot — and not some other match
 *
 * Fixtures only. Every record it creates is named with the tag and removed afterwards.
 *
 * Run: npx tsx --tsconfig scripts/tsconfig.verify.json --env-file=.env scripts/verify-finals-forfeit.mts
 */
import { prisma } from '../src/lib/prisma.ts'
import { assertLocalDatabase } from '../src/lib/db-guard.ts'
import { finalsForfeitOf, syncFinalsForfeit } from '../src/lib/competition/finals-forfeit.ts'

assertLocalDatabase()

const TAG = 'zzff'
let pass = 0
let fail = 0
const check = (label: string, ok: boolean, detail?: string) => {
  if (ok) { pass++; console.log(`  ✓ ${label}`) }
  else { fail++; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`) }
}
const section = (t: string) => console.log(`\n--- ${t} ---`)

async function cleanup() {
  const seasons = await prisma.season.findMany({ where: { slug: { startsWith: TAG } }, select: { id: true } })
  for (const s of seasons) {
    await prisma.seasonPlayoffMatch.deleteMany({ where: { seasonId: s.id } })
    await prisma.seasonEntrant.deleteMany({ where: { seasonId: s.id } })
    await prisma.season.delete({ where: { id: s.id } }).catch(() => {})
  }
  const tours = await prisma.tournament.findMany({ where: { slug: { startsWith: TAG } }, select: { id: true } })
  for (const t of tours) {
    await prisma.playoffMatch.deleteMany({ where: { tournamentId: t.id } })
    await prisma.registration.deleteMany({ where: { tournamentId: t.id } })
    await prisma.tournament.delete({ where: { id: t.id } }).catch(() => {})
  }
  await prisma.$executeRawUnsafe(`DELETE FROM payload.users WHERE username LIKE '${TAG}%'`)
}

await cleanup()

const series = await prisma.competitionSeries.findFirstOrThrow({ select: { id: true } })

// ── A fixture Season with a two-player bracket ──────────────────────────────────────────────────
const maxNo = (await prisma.season.aggregate({ _max: { number: true }, where: { competitionYear: 2099 } }))._max.number ?? 0
const season = await prisma.season.create({
  data: {
    number: maxNo + 1, competitionYear: 2099, competitionSeriesId: series.id,
    slug: `${TAG}-season`, lifecycleState: 'PLAYOFFS_LIVE',
  },
  select: { id: true },
})
const ents = []
for (let i = 0; i < 2; i++) {
  ents.push(await prisma.seasonEntrant.create({
    data: { seasonId: season.id, username: `${TAG}-s${i}`, displayName: `FF Season ${i}`, playoffIncluded: true },
    select: { id: true },
  }))
}
const sFinal = await prisma.seasonPlayoffMatch.create({
  data: {
    seasonId: season.id, round: 1, slot: 0, label: 'Final',
    homeEntrantId: ents[0].id, awayEntrantId: ents[1].id,
    homeUsername: `${TAG}-s0`, awayUsername: `${TAG}-s1`,
  },
  select: { id: true },
})

section('A Season Final decided by a score is not a forfeit')
await prisma.seasonPlayoffMatch.update({
  where: { id: sFinal.id },
  data: { homeGames: 7, awayGames: 3, winnerEntrantId: ents[0].id, status: 'COMPLETED' },
})
check('the bracket says it was played', (await finalsForfeitOf(prisma, 'season', season.id)) === false)
check('and the marker is written false', (await syncFinalsForfeit(prisma, 'season', season.id)) === false)
check('...on the record itself',
  (await prisma.season.findUniqueOrThrow({ where: { id: season.id }, select: { finalsForfeit: true } })).finalsForfeit === false)

section('Correcting that Final to a forfeit sets the marker')
await prisma.seasonPlayoffMatch.update({
  where: { id: sFinal.id },
  data: { homeGames: null, awayGames: null, status: 'FORFEIT', winnerEntrantId: ents[0].id },
})
await syncFinalsForfeit(prisma, 'season', season.id)
check('the record now says the Final was forfeited',
  (await prisma.season.findUniqueOrThrow({ where: { id: season.id }, select: { finalsForfeit: true } })).finalsForfeit === true)

section('Correcting it back to a played result clears the marker')
await prisma.seasonPlayoffMatch.update({
  where: { id: sFinal.id },
  data: { homeGames: 7, awayGames: 5, status: 'COMPLETED', winnerEntrantId: ents[0].id },
})
await syncFinalsForfeit(prisma, 'season', season.id)
check('the marker is cleared automatically',
  (await prisma.season.findUniqueOrThrow({ where: { id: season.id }, select: { finalsForfeit: true } })).finalsForfeit === false)

section('Undoing the Final leaves no stale marker')
await prisma.seasonPlayoffMatch.update({ where: { id: sFinal.id }, data: { status: 'FORFEIT', winnerEntrantId: ents[0].id } })
await syncFinalsForfeit(prisma, 'season', season.id)
check('it is true while the forfeited Final stands',
  (await prisma.season.findUniqueOrThrow({ where: { id: season.id }, select: { finalsForfeit: true } })).finalsForfeit === true)
await prisma.seasonPlayoffMatch.update({
  where: { id: sFinal.id },
  data: { winnerEntrantId: null, status: 'SCHEDULED', homeGames: null, awayGames: null },
})
await syncFinalsForfeit(prisma, 'season', season.id)
check('with no decided Final it falls back to false, not to a stale true',
  (await prisma.season.findUniqueOrThrow({ where: { id: season.id }, select: { finalsForfeit: true } })).finalsForfeit === false)
check('...and the underlying question answers "no Final to ask about"',
  (await finalsForfeitOf(prisma, 'season', season.id)) === null)

section('Recomputing is idempotent, so correction cycles cannot drift')
await prisma.seasonPlayoffMatch.update({ where: { id: sFinal.id }, data: { status: 'FORFEIT', winnerEntrantId: ents[1].id } })
const runs: boolean[] = []
for (let i = 0; i < 4; i++) runs.push(await syncFinalsForfeit(prisma, 'season', season.id))
check('four runs give one answer', new Set(runs).size === 1 && runs[0] === true, runs.join(','))

section('It describes the CANONICAL Final, not any other match')
// An earlier-round forfeit must not make the Final look forfeited.
await prisma.seasonPlayoffMatch.update({
  where: { id: sFinal.id },
  data: { round: 2, slot: 0, status: 'COMPLETED', homeGames: 7, awayGames: 1, winnerEntrantId: ents[0].id },
})
await prisma.seasonPlayoffMatch.create({
  data: {
    seasonId: season.id, round: 1, slot: 0, label: 'Semifinal',
    homeEntrantId: ents[0].id, awayEntrantId: ents[1].id,
    homeUsername: `${TAG}-s0`, awayUsername: `${TAG}-s1`,
    status: 'FORFEIT', winnerEntrantId: ents[0].id,
  },
})
await syncFinalsForfeit(prisma, 'season', season.id)
check('a forfeited semifinal does not mark the Season',
  (await prisma.season.findUniqueOrThrow({ where: { id: season.id }, select: { finalsForfeit: true } })).finalsForfeit === false)

// ── The same rules for a Tournament ─────────────────────────────────────────────────────────────
section('A Tournament follows the same rules')
const tMax = (await prisma.tournament.aggregate({ _max: { number: true } }))._max.number ?? 0
const tour = await prisma.tournament.create({
  data: {
    number: tMax + 1, name: `${TAG} tournament`, slug: `${TAG}-tournament`, competitionYear: 2099,
    competitionSeriesId: series.id, tournamentFormat: 'SINGLE_ELIM', participantFormat: 'INDIVIDUAL',
    lifecycleState: 'IN_PROGRESS', registrationStatus: 'CLOSED', raceLength: 5,
  },
  select: { id: true },
})
const regs = []
for (let i = 0; i < 2; i++) {
  const u = await prisma.$queryRaw<{ id: number }[]>`
    INSERT INTO payload.users (email, username, hash, salt, updated_at, created_at)
    VALUES (${`${TAG}-t${i}@example.invalid`}, ${`${TAG}-t${i}`}, 'x', 'x', now(), now()) RETURNING id`
  regs.push(await prisma.registration.create({
    data: { tournamentId: tour.id, userId: Number(u[0].id), username: `${TAG}-t${i}`, status: 'APPROVED', seed: i + 1 },
    select: { id: true },
  }))
}
const tFinal = await prisma.playoffMatch.create({
  data: {
    tournamentId: tour.id, round: 1, slot: 0, label: 'Final',
    homeRegistrationId: regs[0].id, awayRegistrationId: regs[1].id,
    homeUsername: `${TAG}-t0`, awayUsername: `${TAG}-t1`,
    homeGames: 5, awayGames: 2, winnerRegistrationId: regs[0].id, status: 'COMPLETED',
  },
  select: { id: true },
})
await syncFinalsForfeit(prisma, 'tournament', tour.id)
check('a played Final is not a forfeit',
  (await prisma.tournament.findUniqueOrThrow({ where: { id: tour.id }, select: { finalsForfeit: true } })).finalsForfeit === false)

await prisma.playoffMatch.update({
  where: { id: tFinal.id },
  data: { status: 'FORFEIT', forfeitRegistrationId: regs[1].id, homeGames: null, awayGames: null },
})
await syncFinalsForfeit(prisma, 'tournament', tour.id)
check('a forfeited Final sets the marker',
  (await prisma.tournament.findUniqueOrThrow({ where: { id: tour.id }, select: { finalsForfeit: true } })).finalsForfeit === true)

await prisma.playoffMatch.update({
  where: { id: tFinal.id },
  data: { status: 'COMPLETED', forfeitRegistrationId: null, homeGames: 5, awayGames: 4 },
})
await syncFinalsForfeit(prisma, 'tournament', tour.id)
check('correcting it to a played result clears the marker',
  (await prisma.tournament.findUniqueOrThrow({ where: { id: tour.id }, select: { finalsForfeit: true } })).finalsForfeit === false)

check('either forfeit signal is enough — status or the forfeiting side',
  await (async () => {
    await prisma.playoffMatch.update({ where: { id: tFinal.id }, data: { status: 'COMPLETED', forfeitRegistrationId: regs[1].id } })
    return (await finalsForfeitOf(prisma, 'tournament', tour.id)) === true
  })())

section('Real records are untouched by any of this')
check('no real Season gained a marker it did not earn',
  (await prisma.season.count({ where: { finalsForfeit: true, slug: { not: { startsWith: TAG } } } })) === 0)
check('nor did any real Tournament',
  (await prisma.tournament.count({ where: { finalsForfeit: true, slug: { not: { startsWith: TAG } } } })) === 0)

await cleanup()
check('every fixture is removed',
  (await prisma.season.count({ where: { slug: { startsWith: TAG } } })) === 0
  && (await prisma.tournament.count({ where: { slug: { startsWith: TAG } } })) === 0)

console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
await prisma.$disconnect()
if (fail > 0) process.exitCode = 1
