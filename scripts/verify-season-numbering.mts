/**
 * Season numbering scoped to a Competition and year.
 *
 * A Season number is a LABEL that is unique only within its Competition and year. Nothing addresses
 * a Season by it — routes and relationships use the immutable `id` — which is what lets an
 * administrator renumber a finished Season without disturbing a single result.
 *
 * Fixtures are created and removed; the real 8BR 2005 Season 1 is read but never written to.
 *
 * Run:  npx tsx --tsconfig scripts/tsconfig.verify.json scripts/verify-season-numbering.mts
 */
import { readFileSync } from 'node:fs'
import { Prisma } from '@prisma/client'
import { prisma } from '../src/lib/prisma.ts'
import {
  parseSeasonNumber, suggestSeasonNumber, isSeasonNumberTaken, isSeasonNumberCollision,
} from '../src/lib/seasons/numbering.ts'
import { getSeasonBrowseData, seasonNeighbours, newestSeasonId } from '../src/lib/seasons/browse.ts'

let pass = 0, fail = 0
const check = (n: string, c: boolean, d = '') => {
  if (c) { pass++; console.log('  ✓ ' + n) } else { fail++; console.log('  ✗ ' + n + (d ? ` — ${d}` : '')) }
}
const threw = async (fn: () => unknown | Promise<unknown>): Promise<unknown> => {
  try { await fn(); return null } catch (e) { return e }
}

const PREFIX = 'zzsn-'
async function cleanup() {
  await prisma.season.deleteMany({ where: { slug: { startsWith: PREFIX } } }).catch(() => {})
  await prisma.competitionSeries.deleteMany({ where: { slug: { startsWith: PREFIX } } }).catch(() => {})
}
await cleanup()

async function comp(slug: string, name: string): Promise<number> {
  const found = await prisma.competitionSeries.findFirst({ where: { slug }, select: { id: true } })
  if (found) return found.id
  const c = await prisma.competitionSeries.create({
    data: { name, shortName: name.slice(0, 8), slug, active: true }, select: { id: true },
  })
  return c.id
}

/**
 * Create a Season directly, so a test can set up a shape without going through the form.
 *
 * The slug is made unique per call on purpose. A slug derived from Competition/year/number would
 * collide on its OWN unique index first, and the duplicate tests below would then be proving slug
 * uniqueness instead of the numbering constraint they are named after.
 */
let slugSeq = 0
async function season(competitionSeriesId: number, year: number, number: number) {
  slugSeq += 1
  return prisma.season.create({
    data: {
      competitionSeriesId, competitionYear: year, number,
      slug: `${PREFIX}${competitionSeriesId}-${year}-${number}-${slugSeq}`,
      lifecycleState: 'REGISTRATION_OPEN', lounge: 'Social', accessMode: 'OPEN',
      groupStageGames: 10, earlyRaceTo: 7, semifinalRaceTo: 9, finalRaceTo: 9,
    },
    select: { id: true, number: true, competitionYear: true, competitionSeriesId: true },
  })
}

try {
  const A = await comp(`${PREFIX}a`, 'zz 8BR')
  const B = await comp(`${PREFIX}b`, 'zz 8BR Retro')

  console.log('--- The same number in different Competitions and years ---')
  {
    const a2005 = await season(A, 2005, 1)
    const b2026 = await season(B, 2026, 1)
    const a2026 = await season(A, 2026, 1)
    check('two Competitions can each hold Season 1 in the same year',
      b2026.number === 1 && a2026.number === 1 && b2026.competitionSeriesId !== a2026.competitionSeriesId)
    check('one Competition can hold Season 1 in different years',
      a2005.number === 1 && a2026.number === 1 && a2005.competitionYear !== a2026.competitionYear)
    check('all three are distinct rows', new Set([a2005.id, b2026.id, a2026.id]).size === 3)

    // The exact trio the requirement names, all valid at once.
    const trio = await prisma.season.findMany({
      where: { slug: { startsWith: PREFIX } }, select: { competitionSeriesId: true, competitionYear: true, number: true },
    })
    check('8BR/2005/1, 8BR Retro/2026/1 and 8BR/2026/1 coexist',
      trio.some(t => t.competitionSeriesId === A && t.competitionYear === 2005 && t.number === 1) &&
      trio.some(t => t.competitionSeriesId === B && t.competitionYear === 2026 && t.number === 1) &&
      trio.some(t => t.competitionSeriesId === A && t.competitionYear === 2026 && t.number === 1))
  }

  console.log('')
  console.log('--- A repeat of the same Competition, year AND number is refused ---')
  {
    const e = await threw(() => season(A, 2026, 1))
    check('the database rejects the duplicate', e != null)
    check('and it is recognisably the numbering constraint', isSeasonNumberCollision(e),
      e instanceof Prisma.PrismaClientKnownRequestError ? String(e.code) : String(e))
    check('the pre-flight check agrees', await isSeasonNumberTaken(A, 2026, 1))
    check('and does not object to a free number', !(await isSeasonNumberTaken(A, 2026, 7)))
    check('a Season does not conflict with itself when re-saved',
      !(await isSeasonNumberTaken(A, 2026, 1, (await prisma.season.findFirstOrThrow({
        where: { competitionSeriesId: A, competitionYear: 2026, number: 1 }, select: { id: true },
      })).id)))
  }

  console.log('')
  console.log('--- Suggestions are scoped, and never backfill a gap ---')
  {
    check('an empty Competition/year starts at 1', (await suggestSeasonNumber(A, 2099)) === 1)
    await season(A, 2030, 1)
    await season(A, 2030, 2)
    await season(A, 2030, 3)
    check('otherwise it is the highest used plus one', (await suggestSeasonNumber(A, 2030)) === 4)
    check('the suggestion is scoped to the Competition',
      (await suggestSeasonNumber(B, 2030)) === 1, String(await suggestSeasonNumber(B, 2030)))
    check('and to the year', (await suggestSeasonNumber(A, 2031)) === 1)

    // Delete the middle one: the hole stays open rather than being silently reused.
    await prisma.season.delete({ where: { id: (await prisma.season.findFirstOrThrow({
      where: { competitionSeriesId: A, competitionYear: 2030, number: 2 }, select: { id: true } })).id } })
    check('a gap left by a deletion is NOT refilled automatically',
      (await suggestSeasonNumber(A, 2030)) === 4, String(await suggestSeasonNumber(A, 2030)))
    check('but the gap is still free to claim by hand', !(await isSeasonNumberTaken(A, 2030, 2)))
  }

  console.log('')
  console.log('--- Only positive whole numbers are accepted ---')
  {
    check('a normal number passes', parseSeasonNumber(3).ok && parseSeasonNumber('12').ok)
    for (const [label, v] of [
      ['zero', 0], ['a negative', -1], ['a decimal', 1.5], ['a decimal string', '2.5'],
      ['blank', ''], ['whitespace', '   '], ['nonsense', 'abc'], ['null', null], ['undefined', undefined],
      ['beyond a 32-bit integer', 2_147_483_648], ['infinity', Infinity],
    ] as const) {
      check(`${label} is rejected`, !parseSeasonNumber(v).ok, JSON.stringify(v))
    }
    check('the largest storable number is allowed', parseSeasonNumber(2_147_483_647).ok)
    const r = parseSeasonNumber('  4 ')
    check('a padded string is read as its number', r.ok && r.value === 4)
  }

  console.log('')
  console.log('--- Two simultaneous claims: only one can win ---')
  {
    const settled = await Promise.allSettled([
      season(B, 2040, 1),
      season(B, 2040, 1),
      season(B, 2040, 1),
    ])
    const ok = settled.filter((s) => s.status === 'fulfilled')
    const bad = settled.filter((s) => s.status === 'rejected')
    check('exactly one create succeeded', ok.length === 1, `${ok.length} succeeded`)
    check('the others were refused by the database', bad.length === 2)
    check('and only one row exists',
      (await prisma.season.count({ where: { competitionSeriesId: B, competitionYear: 2040, number: 1 } })) === 1)
  }

  console.log('')
  console.log('--- Renumbering keeps the id, the URL and every dependent record ---')
  {
    const s = await season(B, 2050, 5)
    const entrant = await prisma.seasonEntrant.create({
      data: { seasonId: s.id, username: 'zzsn_p1', cueverseId: 'zzsn_p1', status: 'APPROVED', playoffSeed: 3 },
      select: { id: true },
    })
    const group = await prisma.seasonGroup.create({
      data: { seasonId: s.id, code: 'A', ordinal: 0, published: true }, select: { id: true },
    })
    const match = await prisma.seasonPlayoffMatch.create({
      data: { seasonId: s.id, round: 1, slot: 0, homeEntrantId: entrant.id, homeUsername: 'zzsn_p1', awayUsername: 'Bye' },
      select: { id: true },
    })

    await prisma.season.update({ where: { id: s.id }, data: { number: 9 } })
    const after = await prisma.season.findUniqueOrThrow({ where: { id: s.id }, select: { id: true, number: true } })
    check('the number changed', after.number === 9)
    check('the internal id did not', after.id === s.id)
    check('so the URL is unchanged', `/seasons/${after.id}` === `/seasons/${s.id}`)
    check('its entrant, seed, group and playoff match all survive',
      (await prisma.seasonEntrant.count({ where: { seasonId: s.id } })) === 1 &&
      (await prisma.seasonEntrant.findUniqueOrThrow({ where: { id: entrant.id }, select: { playoffSeed: true } })).playoffSeed === 3 &&
      (await prisma.seasonGroup.count({ where: { id: group.id } })) === 1 &&
      (await prisma.seasonPlayoffMatch.count({ where: { id: match.id } })) === 1)
    check('every dependent row still points at the same Season',
      (await prisma.seasonPlayoffMatch.findUniqueOrThrow({ where: { id: match.id }, select: { seasonId: true } })).seasonId === s.id)
  }

  console.log('')
  console.log('--- Ordering: year descending, then number descending ---')
  {
    const rows = await prisma.season.findMany({
      where: { slug: { startsWith: PREFIX } },
      orderBy: [
        { competitionYear: 'desc' }, { number: 'desc' },
        { competitionSeries: { name: 'asc' } }, { id: 'asc' },
      ],
      select: { competitionYear: true, number: true, competitionSeries: { select: { name: true } } },
    })
    const ordered = rows.every((r, i) => {
      if (i === 0) return true
      const p = rows[i - 1]
      if (p.competitionYear !== r.competitionYear) return p.competitionYear > r.competitionYear
      if (p.number !== r.number) return p.number > r.number
      return p.competitionSeries.name <= r.competitionSeries.name
    })
    check('year descending, then number descending, then Competition name', ordered,
      rows.map(r => `${r.competitionYear}/${r.number}/${r.competitionSeries.name}`).join(' '))

    // The tie-break has to be real: two Competitions share 2026 Season 1.
    const tied = rows.filter(r => r.competitionYear === 2026 && r.number === 1)
    check('a shared year AND number is broken deterministically by Competition name',
      tied.length === 2 && tied[0].competitionSeries.name < tied[1].competitionSeries.name,
      tied.map(t => t.competitionSeries.name).join(' then '))
  }

  console.log('')
  console.log('--- Browsing and navigation work on ids ---')
  {
    const browse = await getSeasonBrowseData(`${PREFIX}a`)
    check('browse rows carry the immutable id', browse.seasons.every((s) => typeof s.id === 'number' && s.id > 0))
    check('newestSeasonId returns an id that resolves',
      (await prisma.season.count({ where: { id: (await newestSeasonId(`${PREFIX}a`))! } })) === 1)
    const mid = await prisma.season.findFirstOrThrow({
      where: { competitionSeriesId: A, competitionYear: 2030, number: 3 }, select: { id: true } })
    const nb = await seasonNeighbours(mid.id, `${PREFIX}a`)
    check('neighbours are ids, not numbers',
      (nb.prev == null || (await prisma.season.count({ where: { id: nb.prev } })) === 1) &&
      (nb.next == null || (await prisma.season.count({ where: { id: nb.next } })) === 1))
  }

  /*
   * "The real 8BR 2005 Season 1 is untouched" ran here: its number, its year, its champion and its
   * sixteen playoff seeds, read from the live archive. Renumbering behaviour is proven above with
   * Seasons this suite creates itself; the 2005 record is a fact about production, and needing it
   * made a numbering suite depend on a copy of the live database.
   *
   * It is asserted in scripts/audit/audit-production.mts.
   */

  console.log('')
  console.log('--- Schema enforces the rule, not just the application ---')
  {
    const idx = await prisma.$queryRaw<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes WHERE schemaname='public' AND tablename='season'`
    check('the global unique on number is gone', !idx.some((i) => i.indexname === 'season_number_key'))
    // Asserted by COLUMNS rather than by name: the `name:` given to @@unique is Prisma's client-API
    // name, while the database index keeps Prisma's column-derived name. Checking the name meant
    // this passed or failed on a naming detail rather than on the constraint being there.
    const composite = await prisma.$queryRaw<{ indexdef: string }[]>`
      SELECT indexdef FROM pg_indexes
       WHERE schemaname='public' AND tablename='season' AND indexdef LIKE '%UNIQUE%'`
    /*
     * The composite now carries the DIVISION as well.
     *
     * The 8BRCAM archive ran Division A and Division B of one Season under a single number, so the
     * three-column form rejected the second of every historical pair. The division is folded with
     * COALESCE(division, '') rather than added plainly: Postgres treats two NULLs as distinct, so a
     * bare four-column index would have let two UNDIVIDED Seasons share a number — which the old
     * constraint forbade and this one still must.
     */
    check('a composite unique on Competition/year/number exists',
      composite.some((i) =>
        /"competitionSeriesId"/.test(i.indexdef) &&
        /"competitionYear"/.test(i.indexdef) &&
        /number/.test(i.indexdef)),
      composite.map((i) => i.indexdef).join(' | '))
    check('...and it includes the division, so a divisional pair can share a number',
      composite.some((i) => /number.*division/i.test(i.indexdef)),
      composite.map((i) => i.indexdef).join(' | '))
    check('...folding a NULL division, so two undivided Seasons still cannot',
      composite.some((i) => /COALESCE\(division/i.test(i.indexdef)),
      composite.map((i) => i.indexdef).join(' | '))

    const cons = await prisma.$queryRaw<{ conname: string; def: string }[]>`
      SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid='public.season'::regclass`
    const positive = cons.find((c) => c.conname === 'season_number_positive')
    check('a CHECK keeps the number positive', !!positive && /number.*> 0/.test(positive.def), positive?.def ?? 'missing')

    // The CHECK is the last line of defence, below the application.
    const e = await threw(() => prisma.$executeRawUnsafe(
      `INSERT INTO "public"."season" ("number","competitionYear","competitionSeriesId","slug","lifecycleState","lounge","accessMode","groupStageGames","earlyRaceTo","semifinalRaceTo","finalRaceTo","createdAt","updatedAt")
       VALUES (0, 2060, ${A}, '${PREFIX}zero', 'REGISTRATION_OPEN', 'Social', 'OPEN', 10, 7, 9, 9, now(), now())`))
    check('the database itself refuses a Season number of 0', e != null)

    const migration = readFileSync('prisma/migrations/20260817220000_season_number_per_competition_year/migration.sql', 'utf8')
    check('the migration aborts rather than renumbering existing data',
      /RAISE EXCEPTION/.test(migration) && !/UPDATE .*season.*SET .*number/i.test(migration))
    check('and history is intact', readFileSync('prisma/migrations/20260729182415_init/migration.sql', 'utf8').length > 0)
  }
} catch (e) {
  fail++
  console.error(e)
} finally {
  await cleanup()
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
await prisma.$disconnect()
process.exit(fail === 0 ? 0 : 1)
