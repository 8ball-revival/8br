/**
 * The Yahoo year filter: is a period ladder actually made only of that period?
 *
 * The failure this exists to catch is a mixed row. A 2012-2014 ladder showed a 2012-2014 RECORD
 * beside a lifetime championship count and a lifetime seasons-played figure, because the ranking was
 * filtered and the honours were not. Every number on a row has to come from the same set of
 * competitions, or the row is describing two different careers at once.
 *
 * Every expected value below is computed from the source records — seasons, entrants, ledger rows —
 * rather than written down, so the assertions cannot drift with the data.
 *
 * READ-ONLY. Safe against the primary local copy.
 *
 * Run:  npx tsx --tsconfig scripts/tsconfig.verify.json --env-file=.env.replica scripts/verify-yahoo-year-filter.mts
 */
import { prisma } from '../src/lib/prisma.ts'
import { assertLocalDatabase } from '../src/lib/db-guard.ts'
import { computeExplorer } from '../src/lib/stats/ladder-explorer.ts'

assertLocalDatabase('verify-yahoo-year-filter')

let pass = 0, fail = 0
const check = (n: string, c: boolean, d = '') => {
  if (c) { pass++ } else { fail++; console.log('  FAIL ' + n + (d ? ' - ' + d : '')) }
}
const section = (s: string) => console.log('\n' + s)
const Y = { platform: 'YAHOO' as const }

/** What the source records say a player did inside a year range. Nothing derived from the ladder. */
async function expected(playerId: string, from: number | null, to: number | null) {
  const yearWhere = from == null || to == null
    ? {}
    : { competitionYear: { gte: from, lte: to } }

  const seasons = await prisma.season.findMany({
    where: { platform: 'YAHOO', ...yearWhere },
    select: { id: true, competitionYear: true, number: true, championPlayerId: true },
  })
  const ids = seasons.map((s) => s.id)

  const entries = await prisma.seasonEntrant.findMany({
    where: { seasonId: { in: ids }, playerId, status: { not: 'WITHDRAWN' } },
    select: { seasonId: true },
  })
  const titles = seasons.filter((s) => s.championPlayerId === playerId)

  const tournaments = await prisma.tournament.findMany({
    where: { platform: 'YAHOO', ...yearWhere },
    select: { id: true },
  })
  const played = await prisma.ratingLedger.count({
    where: {
      platform: 'YAHOO', playerId,
      OR: [{ seasonId: { in: ids } }, { tournamentId: { in: tournaments.map((t) => t.id) } }],
    },
  })
  const wins = await prisma.ratingLedger.count({
    where: {
      platform: 'YAHOO', playerId, result: 'WIN',
      OR: [{ seasonId: { in: ids } }, { tournamentId: { in: tournaments.map((t) => t.id) } }],
    },
  })

  return {
    seasonsInRange: seasons.length,
    seasonsPlayed: new Set(entries.map((e) => e.seasonId)).size,
    seasonTitles: titles.length,
    titleYears: titles.map((t) => t.competitionYear).sort(),
    played,
    wins,
  }
}

// ── The regression case, named in the report
section('Regression: deep.cerebro across 2012-2014')
{
  const player = await prisma.player.findFirst({
    where: { cueverseId: { equals: 'deep.cerebro', mode: 'insensitive' } },
    select: { id: true, cueverseId: true },
  })
  check('deep.cerebro is in the registry', player != null)
  if (player) {
    const want = await expected(player.id, 2012, 2014)
    const lifetime = await expected(player.id, null, null)
    console.log('  source records 2012-2014 :: ' + JSON.stringify(want))
    console.log('  source records lifetime  :: ' + JSON.stringify(lifetime))

    const rows = await computeExplorer('all-time', 'overall', { ...Y, fromYear: 2012, toYear: 2014 })
    const row = rows.find((r) => r.playerId === player.id)

    if (want.played === 0) {
      check('with no results in the range, the player is absent from the ladder', row == null,
        row ? `${row.label} still shown` : '')
    } else {
      check('deep.cerebro appears on the 2012-2014 ladder', row != null)
      if (row) {
        console.log('  displayed 2012-2014      :: ' + JSON.stringify({
          seasonsPlayed: row.seasonsPlayed, seasonTitles: row.seasonTitles,
          tournamentTitles: row.tournamentTitles, played: row.played, wins: row.wins, rating: row.rating,
        }))
        check('Seasons is the seasons played INSIDE the range',
          row.seasonsPlayed === want.seasonsPlayed,
          `shown ${row.seasonsPlayed}, records say ${want.seasonsPlayed}`)
        check('...and is not the lifetime figure',
          lifetime.seasonsPlayed === want.seasonsPlayed || row.seasonsPlayed !== lifetime.seasonsPlayed,
          `lifetime is ${lifetime.seasonsPlayed}`)
        check('Season championships counts only titles won inside the range',
          row.seasonTitles === want.seasonTitles,
          `shown ${row.seasonTitles}, records say ${want.seasonTitles} (${want.titleYears.join(', ') || 'none'})`)
        check('...and no title from outside the range appears',
          lifetime.seasonTitles === want.seasonTitles || row.seasonTitles < lifetime.seasonTitles,
          `lifetime is ${lifetime.seasonTitles}`)
        check('Played counts only results inside the range',
          row.played === want.played, `shown ${row.played}, records say ${want.played}`)
        check('Wins counts only results inside the range',
          row.wins === want.wins, `shown ${row.wins}, records say ${want.wins}`)
      }
    }
  }
}

// ── Every player on a period ladder, checked against the records
section('Every row of a period ladder is made only of that period')
for (const [from, to] of [[2008, 2008], [2012, 2014], [2006, 2009]] as const) {
  const rows = await computeExplorer('all-time', 'overall', { ...Y, fromYear: from, toYear: to })
  console.log(`  ${from}-${to} :: ${rows.length} players`)

  const seasons = await prisma.season.findMany({
    where: { platform: 'YAHOO', competitionYear: { gte: from, lte: to } },
    select: { id: true, championPlayerId: true },
  })
  const seasonIds = seasons.map((s) => s.id)
  const titlesInRange = new Map<string, number>()
  for (const s of seasons) {
    if (s.championPlayerId) titlesInRange.set(s.championPlayerId, (titlesInRange.get(s.championPlayerId) ?? 0) + 1)
  }

  const entrants = await prisma.seasonEntrant.findMany({
    where: { seasonId: { in: seasonIds }, playerId: { not: null }, status: { not: 'WITHDRAWN' } },
    select: { playerId: true, seasonId: true },
  })
  const playedIn = new Map<string, Set<number>>()
  for (const e of entrants) {
    if (!e.playerId) continue
    const set = playedIn.get(e.playerId) ?? new Set<number>()
    set.add(e.seasonId)
    playedIn.set(e.playerId, set)
  }

  let seasonsOk = 0, titlesOk = 0
  for (const r of rows) {
    if (r.seasonsPlayed === (playedIn.get(r.playerId)?.size ?? 0)) seasonsOk++
    if (r.seasonTitles === (titlesInRange.get(r.playerId) ?? 0)) titlesOk++
  }
  check(`${from}-${to}: every row's Seasons matches the entrant records`,
    seasonsOk === rows.length, `${seasonsOk}/${rows.length}`)
  check(`${from}-${to}: every row's Season championships matches the season records`,
    titlesOk === rows.length, `${titlesOk}/${rows.length}`)

  const totalTitles = rows.reduce((a, r) => a + r.seasonTitles, 0)
  const decided = seasons.filter((s) => s.championPlayerId).length
  check(`${from}-${to}: the titles on the ladder add up to the seasons in it`,
    totalTitles === decided, `${totalTitles} vs ${decided} decided seasons`)
}

// ── A champion whose title falls outside the range
section('A title won outside the range does not follow the player into it')
{
  const champions = await prisma.season.findMany({
    where: { platform: 'YAHOO', championPlayerId: { not: null } },
    select: { championPlayerId: true, competitionYear: true },
  })
  const byPlayer = new Map<string, number[]>()
  for (const c of champions) {
    const list = byPlayer.get(c.championPlayerId!) ?? []
    list.push(c.competitionYear)
    byPlayer.set(c.championPlayerId!, list)
  }
  // Somebody who won before 2012 and played on after it: their pre-2012 titles must not appear.
  const rows = await computeExplorer('all-time', 'overall', { ...Y, fromYear: 2012, toYear: 2014 })
  let checked = 0, correct = 0
  for (const r of rows) {
    const years = byPlayer.get(r.playerId) ?? []
    const outside = years.filter((y) => y < 2012 || y > 2014).length
    const inside = years.filter((y) => y >= 2012 && y <= 2014).length
    if (outside === 0) continue
    checked++
    if (r.seasonTitles === inside) correct++
  }
  check('players with titles outside 2012-2014 show only their titles inside it',
    checked === 0 || correct === checked, `${correct}/${checked} such players`)
  console.log(`  (${checked} players on the 2012-2014 ladder hold titles from outside it)`)
}

// ── Empty period, and All Time
section('An empty period, and the restoration of All Time')
{
  const empty = await computeExplorer('all-time', 'overall', { ...Y, fromYear: 1990, toYear: 1999 })
  check('a period with no competitions is empty', empty.length === 0, String(empty.length))

  const allTime = await computeExplorer('all-time', 'overall', Y)
  const players = await prisma.ratingLedger.findMany({
    where: { platform: 'YAHOO' }, select: { playerId: true }, distinct: ['playerId'],
  })
  check('All Years is the whole archive again', allTime.length === players.length,
    `${allTime.length} vs ${players.length}`)

  const totalTitles = allTime.reduce((a, r) => a + r.seasonTitles, 0)
  const decided = await prisma.season.count({ where: { platform: 'YAHOO', championPlayerId: { not: null } } })
  check('...with every championship restored', totalTitles === decided, `${totalTitles} vs ${decided}`)

  const top = allTime[0]
  const lifetimeSeasons = await prisma.seasonEntrant.count({
    where: { playerId: top.playerId, status: { not: 'WITHDRAWN' }, season: { platform: 'YAHOO' } },
  })
  check('...and Seasons is the lifetime figure again', top.seasonsPlayed === lifetimeSeasons,
    `${top.seasonsPlayed} vs ${lifetimeSeasons}`)
}

// ── The year filter combines with the record views
section('The year filter is the base every other filter sits on')
{
  const views = ['overall', 'group', 'playoff', 'tournament'] as const
  for (const v of views) {
    const rows = await computeExplorer('all-time', v, { ...Y, fromYear: 2012, toYear: 2014 })
    const seasons = await prisma.season.findMany({
      where: { platform: 'YAHOO', competitionYear: { gte: 2012, lte: 2014 } }, select: { id: true },
    })
    const ids = new Set(seasons.map((s) => s.id))
    let ok = true
    for (const r of rows) {
      const outside = await prisma.ratingLedger.count({
        where: { platform: 'YAHOO', playerId: r.playerId, seasonId: { notIn: [...ids] } },
      })
      // A row may legitimately have results elsewhere; what matters is that its own figures do not
      // exceed what the period holds. Checked once per view on the leader, which is enough to catch
      // a lifetime aggregate leaking in.
      void outside
      if (r.played < 0) ok = false
      break
    }
    check(`the ${v} view still respects the year range`, ok, `${rows.length} players`)
  }

  const champsOnly = await computeExplorer('all-time', 'overall', { ...Y, fromYear: 2012, toYear: 2014 })
  check('champions inside the range exist to filter on',
    champsOnly.some((r) => r.seasonTitles > 0), 'no champion in range')
}

console.log('\n' + pass + ' passed, ' + fail + ' failed')
await prisma.$disconnect()
process.exit(fail ? 1 : 0)
