/**
 * Query count and timing for the Rankings page's data layer.
 *
 * Counts real statements, not calls: a single `computeExplorer` that quietly issued one query per
 * player would look identical from the outside, so the meter is attached to Prisma's own query
 * event. That makes an N+1 impossible to miss and gives a number to compare against after any
 * optimisation.
 *
 * The fixture flag builds a synthetic archive large enough for a pathological query to show up —
 * this database holds two seasons, which no amount of bad SQL would strain — and removes it again.
 *
 *   npx tsx --tsconfig scripts/tsconfig.verify.json --env-file=.env scripts/profile-rankings.mts
 *   ... --fixture 400        (400 synthetic players across 24 synthetic seasons)
 */
import { PrismaClient } from '@prisma/client'
import { assertLocalDatabase } from '../src/lib/db-guard.ts'

assertLocalDatabase('profile-rankings')

const wantFixture = process.argv.includes('--fixture')
const fixtureSize = Number(process.argv[process.argv.indexOf('--fixture') + 1]) || 400

const meter = new PrismaClient({ log: [{ level: 'query', emit: 'event' }] })
let queries = 0
let dbMs = 0
// @ts-expect-error — the event map is only typed when the log config is a literal.
meter.$on('query', (e: { duration: number }) => { queries += 1; dbMs += e.duration })

// src/lib/prisma.ts memoises its client on globalThis and only builds one if none is there. Seeding
// that slot BEFORE the services are imported is what makes them run on the metered client — no
// rewriting them to accept an injected client, and no chance of measuring a different connection
// than the one the page uses.
;(globalThis as unknown as { prisma?: unknown }).prisma = meter

const { computeExplorer, computeFacets, computePlayerDetail } = await import('../src/lib/stats/ladder-explorer.ts')

const FIXTURE_SERIES = 'zzperf-series'

async function buildFixture(players: number) {
  const seasons = 24
  const series = await meter.competitionSeries.create({
    data: { name: 'zz Perf', shortName: 'zzperf', slug: FIXTURE_SERIES, active: true },
    select: { id: true },
  })
  const playerIds: string[] = []
  for (let i = 0; i < players; i++) {
    const p = await meter.player.create({
      data: { primaryName: `Perf Player ${i}`, cueverseId: `zzperf_${i}`, cueverseIdNormalized: `zzperf_${i}` },
      select: { id: true },
    })
    playerIds.push(p.id)
  }
  let seq = 900_000
  for (let s = 0; s < seasons; s++) {
    const season = await meter.season.create({
      data: {
        competitionSeriesId: series.id, number: 9000 + s, competitionYear: 2000 + s,
        slug: `zzperf-season-${s}`, lifecycleState: 'COMPLETED', lounge: 'Social', accessMode: 'OPEN',
        groupStageGames: 10, earlyRaceTo: 7, semifinalRaceTo: 9, finalRaceTo: 9,
      },
      select: { id: true },
    })
    // Every player plays a handful of matches per season, which is what makes the ledger big.
    const rows = []
    for (let i = 0; i < players; i++) {
      for (let k = 0; k < 4; k++) {
        const win = (i + k + s) % 2 === 0
        rows.push({
          seasonId: season.id, matchKey: `zzperf:${s}:${i}:${k}`, stage: k < 3 ? 'GROUP' : 'PLAYOFF',
          roundLabel: k < 3 ? 'Group A' : 'Final', playerId: playerIds[i], playerName: `zzperf_${i}`,
          opponentName: `zzperf_${(i + 1) % players}`, result: win ? 'WIN' : 'LOSS',
          actual: win ? 1 : 0, preRating: 1500, expected: 0.5, ratingChange: win ? 16 : -16,
          postRating: win ? 1516 : 1484, sequence: seq++, completedAt: new Date(Date.UTC(2000 + s, 5, 1)),
        })
      }
    }
    await meter.ratingLedger.createMany({ data: rows })
  }
}

async function dropFixture() {
  await meter.ratingLedger.deleteMany({ where: { matchKey: { startsWith: 'zzperf:' } } })
  await meter.season.deleteMany({ where: { slug: { startsWith: 'zzperf-season-' } } })
  await meter.competitionSeries.deleteMany({ where: { slug: FIXTURE_SERIES } })
  await meter.player.deleteMany({ where: { cueverseId: { startsWith: 'zzperf_' } } })
}

async function measure(label: string, fn: () => Promise<unknown>) {
  queries = 0; dbMs = 0
  const t0 = performance.now()
  const out = await fn()
  const wall = performance.now() - t0
  const size = Array.isArray(out) ? out.length : undefined
  console.log(
    `  ${label.padEnd(34)} ${String(queries).padStart(4)} queries  ${dbMs.toFixed(1).padStart(8)}ms db  ${wall.toFixed(1).padStart(8)}ms wall${size != null ? `  ${size} rows` : ''}`,
  )
  return { label, queries, dbMs: +dbMs.toFixed(1), wallMs: +wall.toFixed(1), rows: size }
}

try {
  if (wantFixture) {
    console.log(`building fixture: ${fixtureSize} players x 24 seasons …`)
    await dropFixture()
    await buildFixture(fixtureSize)
    queries = 0; dbMs = 0
  }

  const ledger = await meter.ratingLedger.count()
  const people = await meter.player.count()
  console.log(`\nrating_ledger rows: ${ledger}   players: ${people}\n`)

  const results = []
  results.push(await measure('explorer current/overall', () => computeExplorer('current', 'overall')))
  results.push(await measure('explorer all-time/overall', () => computeExplorer('all-time', 'overall')))
  results.push(await measure('explorer all-time/group', () => computeExplorer('all-time', 'group')))
  results.push(await measure('explorer all-time/playoff', () => computeExplorer('all-time', 'playoff')))
  results.push(await measure('facets', () => computeFacets()))

  const someone = await meter.ratingLedger.findFirst({ select: { playerId: true } })
  if (someone) {
    results.push(await measure('player detail (one row expanded)', () => computePlayerDetail(someone.playerId, 'all-time')))
  }

  console.log(`\nJSON: ${JSON.stringify({ ledgerRows: ledger, players: people, results })}`)
} finally {
  if (wantFixture) {
    console.log('\nremoving fixture …')
    await dropFixture()
    const left = await meter.ratingLedger.count({ where: { matchKey: { startsWith: 'zzperf:' } } })
    const leftPlayers = await meter.player.count({ where: { cueverseId: { startsWith: 'zzperf_' } } })
    console.log(`fixture removed — ${left} ledger rows and ${leftPlayers} players remain (both must be 0)`)
  }
  await meter.$disconnect()
}
