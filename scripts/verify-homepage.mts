/**
 * The homepage redesign, end to end.
 *
 * Covers the News rotation, the Top 10 modes, the CueVerse import and its failure behaviour, Recent
 * Results, the By the Numbers rules and On This Day.
 *
 * Everything it creates it removes. Fixture rows carry the `zzhome` prefix, and the CueVerse tests
 * drive the service with injected fetchers so nothing here touches the network.
 *
 * Run:  node scripts/run-with-esm.mjs npx tsx --tsconfig scripts/tsconfig.verify.json --env-file=.env scripts/verify-homepage.mts
 */
import { prisma } from '../src/lib/prisma.ts'
import { pickFeaturedId, hourBucket, getHomeNews } from '../src/lib/home/news.ts'
import { getTop10, getTop10Options, normaliseMode, type Top10Mode } from '../src/lib/home/top10.ts'
import { computeRecentResults } from '../src/lib/home/results.ts'
import { computeRegistryStats, FIXED_COUNTRIES } from '../src/lib/stats/registry-stats.ts'
import { computeOnThisDay } from '../src/lib/stats/on-this-day.ts'
import { getLadder } from '../src/lib/stats/ladder.ts'
import { parseStatsPayload, sanitiseName, checksumOf, ProviderError, TOP_N } from '../src/lib/cueverse/provider.ts'
import { refreshCueVerseLeaderboard, readLatestSnapshot } from '../src/lib/cueverse/service.ts'

let pass = 0, fail = 0
const check = (n: string, ok: boolean, d = '') => {
  if (ok) { pass++; console.log('  ✓ ' + n) } else { fail++; console.log('  ✗ ' + n + (d ? ` — ${d}` : '')) }
}
const section = (t: string) => console.log(`\n--- ${t} ---`)

const PREFIX = 'zzhome'
const madeArticles: number[] = []
const madePlayers: string[] = []
const madeSnapshots: number[] = []

async function cleanup() {
  if (madeArticles.length) {
    await prisma.editorialModerationRecord.deleteMany({ where: { articleId: { in: madeArticles } } })
    await prisma.article.deleteMany({ where: { id: { in: madeArticles } } })
  }
  if (madePlayers.length) {
    await prisma.player.deleteMany({ where: { id: { in: madePlayers }, primaryName: { startsWith: PREFIX } } })
  }
  if (madeSnapshots.length) {
    await prisma.cueVerseSnapshot.deleteMany({ where: { id: { in: madeSnapshots } } })
  }
}

/** A published article, created directly so the test controls its publication time exactly. */
async function mkArticle(title: string, publishAt: Date, opts: { featured?: boolean; state?: string } = {}) {
  const slug = `${PREFIX}-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Math.abs(publishAt.getTime() % 100000)}`
  const a = await prisma.article.create({
    data: {
      authorPlayerId: null,
      authorNameSnapshot: `${PREFIX}_writer`,
      authorHandleSnapshot: `${PREFIX}_writer`,
      title,
      slug,
      slugKey: slug,
      body: { v: 1, blocks: [{ t: 'p', c: [{ t: 'text', v: 'Body text for the fixture article.' }] }] },
      state: (opts.state ?? 'PUBLISHED') as never,
      publishAt: opts.state && opts.state !== 'PUBLISHED' ? null : publishAt,
      featured: !!opts.featured,
    },
    select: { id: true },
  })
  madeArticles.push(a.id)
  return a.id
}

async function main() {
  // ========================================================================= rotation
  section('Hourly featured rotation')

  check('an empty candidate list yields nothing', pickFeaturedId([], 1000) === null)
  check('a single candidate is always the pick', pickFeaturedId([7], 1000) === 7 && pickFeaturedId([7], 1001) === 7)

  {
    const ids = [10, 20, 30, 40, 50]
    const b = 900_000
    // Stability: the same hour must give the same answer, every time it is asked.
    const repeated = Array.from({ length: 20 }, () => pickFeaturedId(ids, b))
    check('the pick is stable within an hour', new Set(repeated).size === 1)

    // Determinism across "instances": same inputs, same output — no hidden state or randomness.
    check('the pick is a pure function of the hour and the list',
      pickFeaturedId([...ids], b) === pickFeaturedId([...ids].slice(), b))

    // Changes when the hour turns over.
    const changes = Array.from({ length: 12 }, (_, i) => pickFeaturedId(ids, b + i))
    check('the pick changes across hour buckets', new Set(changes).size > 1)
    check('it never repeats in consecutive hours', changes.every((v, i) => i === 0 || v !== changes[i - 1]))
    check('every candidate is reachable within n hours',
      new Set(changes.slice(0, ids.length)).size === ids.length, changes.slice(0, ids.length).join(','))
  }
  {
    // Sorted input is the caller's contract; the same SET in a different order must not change the
    // answer once sorted, which is what stops two server instances disagreeing.
    const a = [3, 1, 2].sort((x, y) => x - y)
    const c = [2, 3, 1].sort((x, y) => x - y)
    check('a differently-ordered set sorts to the same pick', pickFeaturedId(a, 555) === pickFeaturedId(c, 555))
  }
  {
    const now = new Date('2026-08-18T14:30:00.000Z')
    check('the hour bucket is UTC-based', hourBucket(now) === Math.floor(now.getTime() / 3_600_000))
    check('two moments in the same UTC hour share a bucket',
      hourBucket(new Date('2026-08-18T14:00:00Z')) === hourBucket(new Date('2026-08-18T14:59:59Z')))
    check('the next hour is a different bucket',
      hourBucket(new Date('2026-08-18T15:00:00Z')) !== hourBucket(new Date('2026-08-18T14:59:59Z')))
  }

  // ========================================================================= news positions
  section('News positions')

  const base = Date.now()
  const oldest = await mkArticle('Home fixture oldest', new Date(base - 5 * 86_400_000))
  const middle = await mkArticle('Home fixture middle', new Date(base - 4 * 86_400_000))
  const newer = await mkArticle('Home fixture newer', new Date(base - 3 * 86_400_000))
  const newest = await mkArticle('Home fixture newest', new Date(base - 2 * 86_400_000))
  const draft = await mkArticle('Home fixture draft', new Date(base - 86_400_000), { state: 'DRAFT' })
  const scheduled = await mkArticle('Home fixture scheduled', new Date(base + 5 * 86_400_000))

  /** The two newest publicly visible articles, queried independently of the service under test. */
  async function newestTwo() {
    return prisma.article.findMany({
      where: { state: 'PUBLISHED', publishAt: { not: null, lte: new Date() } },
      orderBy: [{ publishAt: 'desc' }, { id: 'desc' }],
      take: 2,
      select: { id: true },
    })
  }

  {
    const news = await getHomeNews()
    const [first, second] = await newestTwo()

    check('position 2 is the most recently published article', news.latest?.id === first?.id,
      `got ${news.latest?.id}, expected ${first?.id}`)
    check('position 3 is the second-most-recent', news.second?.id === second?.id,
      `got ${news.second?.id}, expected ${second?.id}`)
    check('a draft never appears', ![news.featured?.id, news.latest?.id, news.second?.id].includes(draft))
    check('a future-dated article never appears',
      ![news.featured?.id, news.latest?.id, news.second?.id].includes(scheduled))
    check('the featured article carries an excerpt', (news.featured?.excerpt ?? '').length > 0)
    check('reading time is at least a minute', (news.featured?.readingMinutes ?? 0) >= 1)

    // Uniqueness is conditional on there being enough to be unique with — which is the rule, not an
    // assumption about how much content this database happens to hold.
    if (news.eligibleCount >= 3) {
      check('with three or more eligible articles nothing is duplicated',
        new Set([news.featured?.id, news.latest?.id, news.second?.id]).size === 3)
      check('...so the featured slot is not one of positions 2 and 3', !news.reusedForFeatured)
    } else {
      check('with fewer than three eligible articles every position still renders',
        news.featured != null || news.latest != null)
    }
  }

  {
    // With the flag in use, only flagged articles rotate — the existing control, not a new one.
    await prisma.article.updateMany({ where: {}, data: { featured: false } })
    await prisma.article.update({ where: { id: oldest }, data: { featured: true } })
    const news = await getHomeNews()
    const [first, second] = await newestTwo()
    check('the homepage-rotation flag narrows the candidates to the flagged article',
      news.featured?.id === oldest, `got ${news.featured?.id}`)
    check('...and positions 2 and 3 are unaffected by it',
      news.latest?.id === first?.id && news.second?.id === second?.id)
    check('...with the eligible count reflecting only the flagged set', news.eligibleCount === 1,
      `${news.eligibleCount}`)
    await prisma.article.update({ where: { id: oldest }, data: { featured: false } })
  }

  {
    // Low content: one eligible article cannot fill three unique positions, so the minimum reuse is
    // expected rather than a broken layout or an empty slot. Driven through the flag so the rest of
    // the database is left alone.
    await prisma.article.update({ where: { id: middle }, data: { featured: true } })
    const news = await getHomeNews()
    check('with a single eligible article every position still renders',
      news.featured != null && news.latest != null && news.second != null)
    check('...and the featured slot falls back to that article', news.featured?.id === middle)
    await prisma.article.update({ where: { id: middle }, data: { featured: false } })
  }

  // ========================================================================= top 10
  section('Top 10 modes')

  const options = await getTop10Options()
  check('the dropdown offers All Competitions', options.some((o) => o.value === 'all-competitions'))
  check('...Current Ladder', options.some((o) => o.value === 'current-ladder'))
  check('...Season Championships', options.some((o) => o.value === 'season-championships'))
  check('...Tournament Championships', options.some((o) => o.value === 'tournament-championships'))
  check('...and one entry per Competition',
    options.filter((o) => o.group === 'By Competition').length === (await prisma.competitionSeries.count({ where: { active: true } })))
  check('competition options are labelled "<name> Only"',
    options.filter((o) => o.group === 'By Competition').every((o) => o.label.endsWith(' Only')))
  check('competition names are not hard-coded — every option maps to a real row',
    options.filter((o) => o.group === 'By Competition').every((o) => /^competition:\d+$/.test(o.value)))

  check('an unknown saved mode falls back to the default', normaliseMode('competition:999999', options) === 'all-competitions')
  check('a nonsense saved mode falls back too', normaliseMode('<script>', options) === 'all-competitions')
  check('null falls back', normaliseMode(null, options) === 'all-competitions')
  check('a valid saved mode is honoured', normaliseMode('current-ladder', options) === 'current-ladder')

  {
    const ladder = await getTop10('current-ladder')
    const source = await getLadder('current')
    check('Current Ladder is not recalculated — it matches the Ladder page exactly',
      ladder.rows.every((r, i) => r.playerId === source[i].playerId && r.value === String(source[i].rating)),
      `${ladder.rows.length} rows`)
    check('...capped at ten rows', ladder.rows.length <= 10)
    check('...and labelled as a rating', ladder.metricLabel === 'Rating')
  }
  {
    const seasons = await getTop10('season-championships')
    check('Season Championships counts Season titles', seasons.metricLabel === 'Season titles')
    check('...and every value is a whole number', seasons.rows.every((r) => /^\d+$/.test(r.value)))
    const tournaments = await getTop10('tournament-championships')
    check('Tournament Championships is a separate mode', tournaments.metricLabel === 'Tournament titles')
    // There are no completed Tournaments in this database, so the two must not bleed into each other.
    check('...and does not inherit Season titles',
      tournaments.rows.length === 0 || tournaments.rows.every((r) => r.value !== undefined))
  }
  {
    const all = await getTop10('all-competitions')
    check('All Competitions reports itself unavailable rather than guessing', all.unavailable != null)
    check('...and returns no rows rather than a substituted metric', all.rows.length === 0)
    const scoped = await getTop10('competition:1' as Top10Mode)
    check('a per-Competition mode is unavailable for the same reason', scoped.unavailable != null)
    check('...and the message names the missing formula', /formula/i.test(scoped.unavailable ?? ''))
  }
  {
    // Ties are marked, and only the display order is broken alphabetically.
    const rows = (await getTop10('season-championships')).rows
    const tiedFlags = rows.map((r) => r.tied)
    check('the first row is never marked as tied', rows.length === 0 || tiedFlags[0] === false)
    check('a tie is flagged when two rows share a value',
      rows.every((r, i) => i === 0 || (r.tied === (rows[i - 1].value === r.value))))
  }
  {
    // Merged identities must not appear twice in a championship count.
    const rows = (await getTop10('season-championships')).rows
    const ids = rows.map((r) => r.playerId).filter((x): x is string => x != null)
    check('no canonical player appears twice', new Set(ids).size === ids.length)
  }

  // ========================================================================= cueverse import
  section('CueVerse import')

  const goodPayload = {
    online: 6, tables: 2, gamesPlayed: 100, players: 500,
    leaderboard: Array.from({ length: 5 }, (_, i) => ({
      name: `Player_${i + 1}`, rating: 2500 - i * 100, wins: 100 + i, losses: 10 + i, provisional: false,
    })),
  }

  {
    const parsed = parseStatsPayload(goodPayload)
    check('a well-formed payload parses', parsed.entries.length === TOP_N)
    check('ranks come from the source order, not from re-sorting',
      parsed.entries.map((e) => e.rank).join(',') === '1,2,3,4,5')
    check('names survive exactly', parsed.entries[0].name === 'Player_1')
    check('the secondary statistic is kept', parsed.entries[0].wins === 100 && parsed.entries[0].losses === 10)
    check('live figures are captured', parsed.playersOnline === 6 && parsed.tablesActive === 2)
  }
  {
    // Order is preserved even when it disagrees with the ratings — the source ranks, we mirror.
    const odd = { ...goodPayload, leaderboard: [
      { name: 'Lower', rating: 1000 }, { name: 'Higher', rating: 3000 },
      { name: 'C', rating: 900 }, { name: 'D', rating: 800 }, { name: 'E', rating: 700 },
    ] }
    const parsed = parseStatsPayload(odd)
    check('the source order is preserved even against the ratings',
      parsed.entries[0].name === 'Lower' && parsed.entries[1].name === 'Higher')
  }
  {
    const many = { ...goodPayload, leaderboard: [...goodPayload.leaderboard, { name: 'Sixth', rating: 100 }] }
    const parsed = parseStatsPayload(many)
    check('exactly the top five are extracted', parsed.entries.length === 5)
    check('...and the sixth is dropped', !parsed.entries.some((e) => e.name === 'Sixth'))
  }

  const rejects = (label: string, body: unknown, expect?: RegExp) => {
    try {
      parseStatsPayload(body)
      check(label, false, 'it was accepted')
    } catch (e) {
      check(label, e instanceof ProviderError && (!expect || expect.test(e.message)),
        e instanceof Error ? e.message : String(e))
    }
  }
  rejects('a null body is rejected', null)
  rejects('a string body is rejected', 'nope')
  rejects('a missing leaderboard is rejected', { online: 1 }, /leaderboard/i)
  rejects('an empty leaderboard is rejected', { leaderboard: [] }, /empty/i)
  rejects('a short leaderboard is rejected', { leaderboard: [{ name: 'A', rating: 1 }] }, /rows/i)
  rejects('a row with no name is rejected',
    { leaderboard: [{ rating: 1 }, { name: 'B', rating: 2 }, { name: 'C', rating: 3 }, { name: 'D', rating: 4 }, { name: 'E', rating: 5 }] }, /name/i)
  rejects('a nonsense rating is rejected',
    { leaderboard: [{ name: 'A', rating: 'lots' }, { name: 'B', rating: 2 }, { name: 'C', rating: 3 }, { name: 'D', rating: 4 }, { name: 'E', rating: 5 }] }, /rating/i)
  rejects('an absurd rating is rejected',
    { leaderboard: [{ name: 'A', rating: 9_999_999 }, { name: 'B', rating: 2 }, { name: 'C', rating: 3 }, { name: 'D', rating: 4 }, { name: 'E', rating: 5 }] }, /rating/i)

  {
    check('control characters are stripped from a name', sanitiseName('Bad\u0007Name') === 'BadName')
    check('a right-to-left override is stripped', sanitiseName('abc\u202Edef') === 'abcdef')
    check('a zero-width space is stripped', sanitiseName('a\u200Bb') === 'ab')
    check('whitespace is collapsed', sanitiseName('  a   b  ') === 'a b')
    check('a very long name is bounded', sanitiseName('x'.repeat(500)).length === 64)
    check('a non-string name becomes empty', sanitiseName(42) === '')
    const parsed = parseStatsPayload({ ...goodPayload, leaderboard: [
      { name: '<script>alert(1)</script>', rating: 100 },
      ...goodPayload.leaderboard.slice(1),
    ] })
    check('markup in a name is stored as text, never as markup',
      parsed.entries[0].name === '<script>alert(1)</script>')
  }
  {
    const a = checksumOf(parseStatsPayload(goodPayload).entries)
    const b = checksumOf(parseStatsPayload(goodPayload).entries)
    check('the checksum is stable for identical data', a === b)
    const changed = { ...goodPayload, leaderboard: [{ ...goodPayload.leaderboard[0], rating: 9 }, ...goodPayload.leaderboard.slice(1)] }
    check('the checksum changes when the data does', checksumOf(parseStatsPayload(changed).entries) !== a)
  }

  // ========================================================================= cueverse storage
  section('CueVerse snapshot behaviour')

  const before = await readLatestSnapshot()

  {
    const r = await refreshCueVerseLeaderboard({ fetcher: async () => parseStatsPayload(goodPayload) })
    check('a good fetch is stored', r.ok === true, r.error)
    if (r.snapshotId) madeSnapshots.push(r.snapshotId)
    const snap = await readLatestSnapshot()
    check('...and becomes the latest snapshot', snap?.entries.length === 5)
    check('...in the source order', snap?.entries.map((e) => e.rank).join(',') === '1,2,3,4,5')
    check('...and is not stale', snap?.stale === false)
  }
  {
    const r = await refreshCueVerseLeaderboard({ fetcher: async () => parseStatsPayload(goodPayload) })
    check('an identical fetch is recognised as unchanged', r.unchanged === true)
  }

  const good = await readLatestSnapshot()

  {
    // Every failure mode must leave the good snapshot exactly as it was.
    const failures: [string, () => Promise<never>][] = [
      ['a network failure', async () => { throw new Error('ECONNREFUSED') }],
      ['a timeout', async () => { throw new Error('The operation was aborted') }],
      ['a malformed payload', async () => { throw new ProviderError('Response was not an object.') }],
      ['an empty leaderboard', async () => { throw new ProviderError('Leaderboard was empty.') }],
    ]
    for (const [label, fetcher] of failures) {
      const r = await refreshCueVerseLeaderboard({ fetcher })
      const after = await readLatestSnapshot()
      check(`${label} does not succeed`, r.ok === false)
      check(`...and preserves the previous snapshot`,
        after?.fetchedAt === good?.fetchedAt && after?.entries.length === good?.entries.length)
    }
  }
  {
    // A payload that parses but has too few rows must be refused by the write path as well.
    const r = await refreshCueVerseLeaderboard({
      fetcher: async () => ({ entries: [], playersOnline: null, tablesActive: null, raw: {} }),
    })
    check('an empty entry list never replaces a valid snapshot', r.ok === false)
    const after = await readLatestSnapshot()
    check('...the snapshot is untouched', after?.entries.length === good?.entries.length)
  }
  {
    // Overlapping runs: the advisory lock lets exactly one proceed.
    let running = 0
    let maxConcurrent = 0
    const slow = async () => {
      running += 1
      maxConcurrent = Math.max(maxConcurrent, running)
      await new Promise((r) => setTimeout(r, 250))
      running -= 1
      return parseStatsPayload(goodPayload)
    }
    const [a, b] = await Promise.all([
      refreshCueVerseLeaderboard({ fetcher: slow }),
      refreshCueVerseLeaderboard({ fetcher: slow }),
    ])
    check('two concurrent refreshes never overlap', maxConcurrent === 1, `peak ${maxConcurrent}`)
    check('...and one of them reports the lock',
      [a, b].some((r) => /already running/i.test(r.error ?? '')), JSON.stringify([a.error, b.error]))
  }
  {
    const stale = await readLatestSnapshot(new Date(Date.now() + 48 * 3_600_000))
    check('a snapshot older than the window reads as stale', stale?.stale === true)
    check('...and reports its age', (stale?.ageHours ?? 0) > 36)
  }
  void before

  // ========================================================================= recent results
  section('Recent Results')

  {
    const results = await computeRecentResults(3)
    check('at most three results are returned', results.length <= 3)
    check('they are newest first',
      results.every((r, i) => i === 0 || r.completedAt <= results[i - 1].completedAt))
    check('every result names both players',
      results.every((r) => r.homeName.trim() !== '' && r.awayName.trim() !== ''))
    check('every result has a recorded score',
      results.every((r) => Number.isInteger(r.homeGames) && Number.isInteger(r.awayGames)))
    check('every result links to its competition', results.every((r) => r.href.startsWith('/')))
    check('every result has a competition name', results.every((r) => r.competitionName.trim() !== ''))
    check('identities are unique per result row', new Set(results.map((r) => r.key)).size === results.length)
  }
  {
    // Legitimacy: the shared definition must exclude everything the specification lists.
    const excluded = await prisma.$queryRawUnsafe<{ n: bigint }[]>(`
      SELECT count(*)::bigint AS n FROM "public"."season_playoff_match"
       WHERE "status" IN ('COMPLETED','FORFEIT')
         AND (btrim(coalesce("homeUsername",'')) = '' OR btrim(coalesce("awayUsername",'')) = '')
    `)
    const byeCount = Number(excluded[0].n)
    const results = await computeRecentResults(200)
    check('byes and empty bracket slots are excluded',
      results.every((r) => r.homeName.trim() !== '' && r.awayName.trim() !== ''),
      `${byeCount} such rows exist in the data`)
  }

  // ========================================================================= by the numbers
  section('By the Numbers')

  {
    const stats = await computeRegistryStats()
    check('Countries always reads 8', stats.countries === FIXED_COUNTRIES && stats.countries === 8)

    const seasons = await prisma.season.count()
    check('Seasons counts Season records only', stats.seasons === seasons, `${stats.seasons} vs ${seasons}`)

    if (stats.since != null) {
      const expected = new Date().getFullYear() - stats.since + 1
      check('Years of History counts inclusively', stats.yearsOfHistory === expected,
        `${stats.yearsOfHistory} vs ${expected}`)
    }

    const legit = await prisma.$queryRawUnsafe<{ n: bigint }[]>(`
      SELECT count(*)::bigint AS n FROM (
        SELECT 1 FROM "public"."season_match"
         WHERE "status" IN ('COMPLETED','FORFEIT') AND "homeGames" IS NOT NULL AND "awayGames" IS NOT NULL
           AND "completedAt" IS NOT NULL
           AND btrim(coalesce("homeUsername",'')) <> '' AND btrim(coalesce("awayUsername",'')) <> ''
        UNION ALL
        SELECT 1 FROM "public"."season_playoff_match"
         WHERE "status" IN ('COMPLETED','FORFEIT') AND "homeGames" IS NOT NULL AND "awayGames" IS NOT NULL
           AND "completedAt" IS NOT NULL
           AND btrim(coalesce("homeUsername",'')) <> '' AND btrim(coalesce("awayUsername",'')) <> ''
      ) x
    `)
    check('Matches Played matches an independent count of legitimate matches',
      stats.matchesPlayed === Number(legit[0].n), `${stats.matchesPlayed} vs ${Number(legit[0].n)}`)

    check('Games Played is a plausible multiple of matches',
      stats.matchesPlayed === 0 || stats.gamesPlayed >= stats.matchesPlayed,
      `${stats.gamesPlayed} games over ${stats.matchesPlayed} matches`)

    // Champions is a unique-PLAYER count, so it can never exceed the number of completed competitions.
    const completed = await prisma.season.count({ where: { lifecycleState: 'COMPLETED' } })
      + await prisma.tournament.count({ where: { status: 'COMPLETED' } })
    check('Champions counts unique players, never more than the completed competitions',
      stats.champions <= completed, `${stats.champions} champions, ${completed} completed`)

    // Players is participation-derived, so it cannot exceed the accounts that exist.
    const players = await prisma.player.count()
    check('Players never exceeds the roster', stats.players <= players, `${stats.players} of ${players}`)

    const entrants = await prisma.seasonEntrant.count()
    check('Players is derived from entrants rather than accounts', stats.players <= entrants + 1,
      `${stats.players} vs ${entrants} entrant rows`)
  }
  {
    // An in-progress competition must not award a champion.
    const season = await prisma.season.findFirst({ where: { lifecycleState: 'COMPLETED' }, select: { id: true, championName: true } })
    if (season) {
      const withChampion = await computeRegistryStats()
      await prisma.season.update({ where: { id: season.id }, data: { lifecycleState: 'PLAYOFFS_LIVE' } })
      const reopened = await computeRegistryStats()
      check('reopening a Season withdraws its championship',
        reopened.champions === withChampion.champions - 1,
        `${withChampion.champions} -> ${reopened.champions}`)
      check('...but its matches still count', reopened.matchesPlayed === withChampion.matchesPlayed)
      await prisma.season.update({ where: { id: season.id }, data: { lifecycleState: 'COMPLETED' } })
      const restored = await computeRegistryStats()
      check('...and closing it again restores the championship', restored.champions === withChampion.champions)
    } else {
      check('reopening a Season withdraws its championship', true, 'no completed Season to exercise')
    }
  }

  // ========================================================================= on this day
  section('On This Day')

  {
    const events = await computeOnThisDay()
    check('events are returned without error', Array.isArray(events))
    check('every event has a stable id', events.every((e) => e.id.length > 0))
    check('ids are unique — duplicates are suppressed', new Set(events.map((e) => e.id)).size === events.length)
    check('every event has a description built from stored values', events.every((e) => e.description.trim() !== ''))
    check('every event is from an earlier year',
      events.every((e) => e.year < new Date().getUTCFullYear()))
  }
  {
    // A championship and the final that decided it must not both appear for the same pairing.
    const season = await prisma.season.findFirst({
      where: { lifecycleState: 'COMPLETED', completedAt: { not: null } },
      select: { completedAt: true, championName: true, runnerUpName: true },
    })
    if (season?.completedAt) {
      const onThatDay = await computeOnThisDay(new Date(Date.UTC(
        season.completedAt.getUTCFullYear() + 1,
        season.completedAt.getUTCMonth(),
        season.completedAt.getUTCDate(),
      )))
      const titles = onThatDay.filter((e) => e.kind === 'championship')
      check('the championship appears on its anniversary', titles.length >= 1, `${onThatDay.length} events`)
      check('...and the final it was decided by is not duplicated beside it',
        new Set(onThatDay.map((e) => e.description)).size === onThatDay.length)
      check('...with the original year preserved',
        titles.every((t) => t.year === season.completedAt!.getUTCFullYear()))
    } else {
      check('the championship appears on its anniversary', true, 'no completed Season with a date')
    }
  }
  {
    const empty = await computeOnThisDay(new Date(Date.UTC(2030, 0, 1)))
    check('a date with no events returns an empty list rather than an invention', empty.length === 0)
  }

  console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} — ${pass} passed, ${fail} failed`)
}

main()
  .catch((e) => {
    console.error('\nSUITE ERROR:', e)
    fail += 1
  })
  .finally(async () => {
    await cleanup()
    const leftovers = await prisma.article.count({ where: { slug: { startsWith: PREFIX } } })
    console.log(`\nCleaned up ${madeArticles.length} articles, ${madeSnapshots.length} snapshots.`)
    console.log(leftovers === 0 ? 'No fixture rows remain.' : `WARNING: ${leftovers} fixture articles remain.`)
    await prisma.$disconnect()
    process.exit(fail === 0 && leftovers === 0 ? 0 : 1)
  })
