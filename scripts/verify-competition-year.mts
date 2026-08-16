/**
 * Verification for the Competition Year field on Seasons and Tournaments.
 *
 * Read-only against the database: it asserts the backfill, the constraints and the ordering as they
 * actually exist, and exercises the shared validation helper directly. Nothing is written, so it is
 * safe to re-run.
 *
 * Run:  npx tsx --tsconfig scripts/tsconfig.verify.json scripts/verify-competition-year.mts
 */
import { prisma } from '../src/lib/prisma.ts'
import {
  COMPETITION_YEAR_MAX,
  COMPETITION_YEAR_MIN,
  SEASON_ORDER,
  TOURNAMENT_ORDER,
  currentCompetitionYear,
  isValidCompetitionYear,
  parseCompetitionYear,
} from '../src/lib/competition/competition-year.ts'

let pass = 0, fail = 0
const check = (n: string, ok: boolean, d = '') => {
  if (ok) { pass++; console.log('  ✓ ' + n) } else { fail++; console.log('  ✗ ' + n + (d ? ` — ${d}` : '')) }
}

async function main() {
  console.log('--- Validation rules ---')
  check('default is the current calendar year', currentCompetitionYear() === new Date().getFullYear())
  check('accepts a historical year (1975)', isValidCompetitionYear(1975))
  check('accepts a future scheduled year (2031)', isValidCompetitionYear(2031))
  check(`accepts the lower bound (${COMPETITION_YEAR_MIN})`, isValidCompetitionYear(COMPETITION_YEAR_MIN))
  check(`accepts the upper bound (${COMPETITION_YEAR_MAX})`, isValidCompetitionYear(COMPETITION_YEAR_MAX))
  check('rejects below range (1899)', !isValidCompetitionYear(1899))
  check('rejects above range (2101)', !isValidCompetitionYear(2101))
  check('rejects a non-integer (2026.5)', !isValidCompetitionYear(2026.5))
  check('rejects text', !isValidCompetitionYear('nineteen ninety'))
  check('rejects empty', !isValidCompetitionYear(''))
  check('accepts a numeric string from a form post', parseCompetitionYear(' 2024 ').ok)
  const parsed = parseCompetitionYear('2024')
  check('parses the numeric string to a number', parsed.ok && parsed.year === 2024)

  console.log('\n--- Backfill (existing records) ---')
  const tours = await prisma.tournament.findMany({
    select: { id: true, name: true, competitionYear: true, scheduledStartAt: true, createdAt: true },
  })
  const seasons = await prisma.season.findMany({ select: { id: true, number: true, competitionYear: true } })
  check('every tournament has a competition year', tours.every((t) => Number.isInteger(t.competitionYear)), `${tours.length} rows`)
  check('every season has a competition year', seasons.every((s) => Number.isInteger(s.competitionYear)), `${seasons.length} rows`)
  const wrong = tours.filter(
    (t) => t.competitionYear !== new Date(t.scheduledStartAt ?? t.createdAt).getFullYear(),
  )
  check('tournament years match start-date-else-createdAt', wrong.length === 0, wrong.map((w) => w.name).join(', '))
  check(
    'every value sits inside the supported range',
    [...tours, ...seasons].every((r) => r.competitionYear >= COMPETITION_YEAR_MIN && r.competitionYear <= COMPETITION_YEAR_MAX),
  )

  console.log('\n--- Not unique: records may share a year ---')
  const seasonYears = seasons.map((s) => s.competitionYear)
  const shared = seasonYears.length !== new Set(seasonYears).size
  check('multiple seasons already share a year (no unique constraint)', shared || seasons.length < 2,
        shared ? 'confirmed by data' : 'too few rows to demonstrate')
  const dupIdx: Array<{ indexdef: string }> = await prisma.$queryRawUnsafe(
    `SELECT indexdef FROM pg_indexes WHERE indexname LIKE '%competitionYear%' AND indexdef LIKE '%UNIQUE%'`,
  )
  check('no UNIQUE index on competitionYear', dupIdx.length === 0)

  console.log('\n--- Constraints ---')
  const notNull: Array<{ n: bigint }> = await prisma.$queryRawUnsafe(
    `SELECT count(*) n FROM information_schema.columns WHERE column_name='competitionYear' AND is_nullable='NO' AND table_schema='public'`,
  )
  check('competitionYear is NOT NULL on both tables', Number(notNull[0].n) === 2, `found ${notNull[0].n}`)
  const checks: Array<{ n: bigint }> = await prisma.$queryRawUnsafe(
    `SELECT count(*) n FROM pg_constraint WHERE conname LIKE '%competitionYear_range'`,
  )
  check('range CHECK constraint on both tables', Number(checks[0].n) === 2, `found ${checks[0].n}`)
  const idx: Array<{ n: bigint }> = await prisma.$queryRawUnsafe(
    `SELECT count(*) n FROM pg_indexes WHERE indexname LIKE '%competitionYear_idx'`,
  )
  check('ordering index on both tables', Number(idx[0].n) === 2, `found ${idx[0].n}`)

  console.log('\n--- Default ordering (year desc, then start date desc, then name) ---')
  const ordered = await prisma.tournament.findMany({
    orderBy: TOURNAMENT_ORDER,
    select: { competitionYear: true, scheduledStartAt: true, name: true },
  })
  const yearsDesc = ordered.every((r, i) => i === 0 || ordered[i - 1].competitionYear >= r.competitionYear)
  check('tournaments come back newest year first', yearsDesc, ordered.map((r) => r.competitionYear).join(','))
  const sOrdered = await prisma.season.findMany({ orderBy: SEASON_ORDER, select: { competitionYear: true, number: true } })
  check('seasons come back newest year first',
        sOrdered.every((r, i) => i === 0 || sOrdered[i - 1].competitionYear >= r.competitionYear),
        sOrdered.map((r) => r.competitionYear).join(','))

  console.log('\n--- Filtering by year ---')
  const y = tours[0]?.competitionYear ?? currentCompetitionYear()
  const filtered = await prisma.tournament.count({ where: { competitionYear: y } })
  const expected = tours.filter((t) => t.competitionYear === y).length
  check(`filtering tournaments by ${y} returns the right count`, filtered === expected, `${filtered} vs ${expected}`)

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
  await prisma.$disconnect()
  process.exit(fail === 0 ? 0 : 1)
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1) })
