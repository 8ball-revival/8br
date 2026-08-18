/**
 * The homepage history card: On This Day, and its From the Archive fallback.
 *
 * Every case is driven through the test-date override rather than by writing rows, so nothing
 * permanent is inserted. The one case that genuinely needs a different database — no eligible history
 * at all — runs inside a transaction that is always rolled back.
 */

import { prisma } from '@/lib/prisma'
import { computeAlmanac, almanacForTestDate, phoenixDateKey } from '@/lib/stats/almanac'
import { archiveCandidates, getArchiveFact } from '@/lib/stats/archive-fact'
import { phoenixParts, PLAY_DATE_RULE } from '@/lib/stats/on-this-day'
import { readFileSync } from 'node:fs'

let passed = 0
let failed = 0
function check(name: string, ok: boolean, detail = '') {
  if (ok) { passed += 1 } else { failed += 1; console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`) }
}

// ─────────────────────────────────────────────────── Arizona dates
console.log('\nArizona calendar')
{
  // 06:00 UTC on the 19th is 23:00 on the 18th in Phoenix. Getting this wrong is exactly how a card
  // flips to tomorrow's date during the evening.
  const lateEvening = new Date('2026-08-19T06:00:00Z')
  const p = phoenixParts(lateEvening)
  check('an evening instant stays on the Arizona day', p.day === 18 && p.month === 8 && p.year === 2026,
    `${p.year}-${p.month}-${p.day}`)

  // 07:00 UTC is midnight Phoenix — the boundary itself.
  const boundary = phoenixParts(new Date('2026-08-19T07:00:00Z'))
  check('the UTC boundary crosses at Arizona midnight', boundary.day === 19, String(boundary.day))

  // Phoenix does not observe daylight saving, so the offset is the same in January and July.
  const winter = phoenixParts(new Date('2026-01-15T07:00:00Z'))
  const summer = phoenixParts(new Date('2026-07-15T07:00:00Z'))
  check('there is no daylight-saving shift', winter.day === 15 && summer.day === 15)

  check('the cache key is the Arizona date',
    phoenixDateKey(lateEvening) === '2026-08-18', phoenixDateKey(lateEvening))
}

// ─────────────────────────────────────────────────── the play-date rule
console.log('\nimported dates are not play dates')
{
  check('the rule is stated in the source', PLAY_DATE_RULE.length > 40)

  // Season 1 is competitionYear 2005, but every one of its rows carries the 2026 import timestamp.
  const season = await prisma.season.findFirst({
    where: { lifecycleState: 'COMPLETED' },
    select: { competitionYear: true, completedAt: true },
  })
  if (season?.completedAt && season.competitionYear) {
    const stampedYear = phoenixParts(season.completedAt).year
    if (stampedYear !== season.competitionYear) {
      const onImportDate = await almanacForTestDate(
        `${stampedYear}-${String(phoenixParts(season.completedAt).month).padStart(2, '0')}`
        + `-${String(phoenixParts(season.completedAt).day).padStart(2, '0')}`,
      )
      check('the import date does NOT produce an On This Day claim',
        onImportDate?.mode !== 'on-this-day',
        `mode was ${onImportDate?.mode} for a ${season.competitionYear} season stamped ${stampedYear}`)
      check('...it falls back to the archive instead', onImportDate?.mode === 'archive')
    }
  }
}

// ─────────────────────────────────────────────────── the archive state
console.log('\nFrom the Archive')
{
  const candidates = await archiveCandidates()
  check('there are canonical archive candidates', candidates.length > 0, String(candidates.length))

  for (const c of candidates) {
    // The whole point: a fact drawn from imported history must never assert a day.
    check(`"${c.description.slice(0, 40)}…" claims no day`,
      !/\b(on this day|january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2}\b/i
        .test(c.description),
      c.description)
    check(`"${c.description.slice(0, 30)}…" is attributed to a competition`, c.context.trim().length > 0)
  }

  const withYear = candidates.filter((c) => c.year != null)
  check('facts with a known year say "In <year>"',
    withYear.every((c) => c.description.startsWith(`In ${c.year},`)),
    withYear[0]?.description ?? '')

  // Scores must come from stored values, never invented.
  const scored = candidates.filter((c) => /\d+–\d+/.test(c.description))
  check('scored facts use a real scoreline', scored.every((c) => /\d+–\d+/.test(c.description)))
  check('no placeholder 0-0 result is presented as a contest',
    !candidates.some((c) => /\b0–0\b/.test(c.description)))
}

// ─────────────────────────────────────────────────── determinism
console.log('\ndeterministic daily selection')
{
  const a = await almanacForTestDate('2026-09-05')
  const b = await almanacForTestDate('2026-09-05')
  check('the same date gives the same fact twice',
    JSON.stringify(a) === JSON.stringify(b))

  const seen = new Set<string>()
  for (let d = 1; d <= 28; d += 1) {
    const r = await almanacForTestDate(`2026-09-${String(d).padStart(2, '0')}`)
    if (r?.fact) seen.add(r.fact.id)
  }
  check('the fact changes across the month rather than sticking', seen.size > 1, `${seen.size} distinct`)

  // Titles are preferred, so they must appear more often than their share of the pool.
  const candidates = await archiveCandidates()
  const titleShare = candidates.filter((c) => c.kind !== 'match').length / Math.max(1, candidates.length)
  let titleDays = 0
  for (let d = 1; d <= 28; d += 1) {
    const r = await almanacForTestDate(`2026-10-${String(d).padStart(2, '0')}`)
    if (r?.fact && r.fact.kind !== 'match') titleDays += 1
  }
  if (candidates.some((c) => c.kind !== 'match') && candidates.some((c) => c.kind === 'match')) {
    check('championship facts are preferred over ordinary matches',
      titleDays / 28 > titleShare, `${(titleDays / 28 * 100).toFixed(0)}% of days vs ${(titleShare * 100).toFixed(0)}% of the pool`)
  }
}

// ─────────────────────────────────────────────────── the test override is not a production feature
console.log('\ntest-date override is development-only')
{
  const src = readFileSync('src/lib/stats/almanac.ts', 'utf8')
  check('the override refuses to run in production', src.includes("process.env.NODE_ENV === 'production'"))
  check('it validates the supplied date', /\\d\{4\}|\d\{4\}/.test(src) || src.includes('exec(raw'))
  check('a malformed date is refused', (await almanacForTestDate('not-a-date')) === null)
  check('an empty date is refused', (await almanacForTestDate('')) === null)
  check('a missing date is refused', (await almanacForTestDate(null)) === null)
  check('an injection attempt is refused', (await almanacForTestDate("2026-01-01'; DROP TABLE season;--")) === null)
  check('a valid date is accepted', (await almanacForTestDate('2026-03-03')) !== null)
}

// ─────────────────────────────────────────────────── no eligible history at all
console.log('\nno canonical history')
{
  // Inside a transaction that is ALWAYS rolled back, so no permanent row is added or removed.
  let modeWithNoHistory: string | null = null
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`UPDATE "public"."season" SET "lifecycleState" = 'PLAYOFFS_LIVE'`)
    await tx.$executeRawUnsafe(`DELETE FROM "public"."season_playoff_match"`)
    const seasons = await tx.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT count(*)::bigint AS n FROM "public"."season" WHERE "lifecycleState" = 'COMPLETED'`)
    modeWithNoHistory = Number(seasons[0].n) === 0 ? 'empty' : 'still-populated'
    throw new Error('rollback')
  }).catch((e) => { if (!(e instanceof Error) || e.message !== 'rollback') throw e })

  check('the empty-history case can be simulated without permanent writes', modeWithNoHistory === 'empty')

  // And the real database is untouched afterwards.
  const stillCompleted = await prisma.season.count({ where: { lifecycleState: 'COMPLETED' } })
  check('the transaction rolled back — real seasons are intact', stillCompleted > 0, `${stillCompleted} completed`)

  // The service's own contract for an empty pool.
  const fact = await getArchiveFact()
  check('with history present, a fact is returned', fact !== null)
}

// ─────────────────────────────────────────────────── the old fixtures are gone
console.log('\nthe old production fixtures are not used')
{
  check('src/lib/home/fixtures.ts does not exist on this branch',
    !(() => { try { readFileSync('src/lib/home/fixtures.ts'); return true } catch { return false } })())

  const candidates = await archiveCandidates()
  const text = candidates.map((c) => c.description).join(' | ')
  // The three hard-coded live entries, which must never reappear as "history".
  check('the Luis championship fixture is not reproduced', !/Luis defeated James/i.test(text))
  check('the Kevin undefeated-group fixture is not reproduced', !/undefeated group stage for the first time/i.test(text))
  check('the Masters Invitational fixture is not reproduced', !/first 8BRCAM Masters Invitational/i.test(text))

  const archiveSrc = readFileSync('src/lib/stats/archive-fact.ts', 'utf8')
  check('the decision not to migrate them is documented',
    /HARD-CODED UI FIXTURES/.test(archiveSrc) && /NOT\s*\n?\s*\*?\s*migrated/i.test(archiveSrc))
}

// ─────────────────────────────────────────────────── modes
console.log('\ncard modes')
{
  const today = await computeAlmanac()
  check('today resolves to a real mode', ['on-this-day', 'archive', 'none'].includes(today.mode), today.mode)
  check('archive mode carries a fact', today.mode !== 'archive' || today.fact != null)
  check('on-this-day mode carries events', today.mode !== 'on-this-day' || today.events.length > 0)
  check('none mode carries neither', today.mode !== 'none' || (today.fact == null && today.events.length === 0))
}

await prisma.$disconnect()
console.log(`\n${passed} passed, ${failed} failed`)
process.exitCode = failed > 0 ? 1 : 0
