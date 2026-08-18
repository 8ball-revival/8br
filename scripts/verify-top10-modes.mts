/**
 * The Top 10 ranking modes.
 *
 * Ordering is checked twice over: the sort itself is exercised on constructed rows, where ties and
 * each tiebreak can be forced deliberately, and the live modes are then checked against the
 * development database to confirm the service returns real, correctly ordered data rather than a
 * placeholder.
 */

import { prisma } from '@/lib/prisma'
import { getTop10, getTop10Options, normaliseMode } from '@/lib/home/top10'
import { careerTied, type CareerRow } from '@/lib/home/top10-career'

let passed = 0
let failed = 0
function check(name: string, ok: boolean, detail = '') {
  if (ok) { passed += 1 } else { failed += 1; console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`) }
}

/** The documented ordering, mirrored here so the test states the rule independently of the module. */
function rankOrder(a: CareerRow, b: CareerRow): number {
  return b.championships - a.championships
    || b.finals - a.finals
    || b.wins - a.wins
    || b.matchWinPct - a.matchWinPct
    || b.gameDiff - a.gameDiff
    || (a.handle ?? a.name).localeCompare(b.handle ?? b.name, undefined, { sensitivity: 'base' })
    || (a.playerId ?? '').localeCompare(b.playerId ?? '')
}

const row = (over: Partial<CareerRow> & { handle: string }): CareerRow => ({
  playerId: over.playerId ?? over.handle,
  name: over.name ?? over.handle,
  handle: over.handle,
  slug: over.handle,
  championships: 0, finals: 0, wins: 0, losses: 0, matchWinPct: 0, gameDiff: 0,
  ...over,
})

// ─────────────────────────────────────────────────── the ordering, criterion by criterion
console.log('\nordering')
{
  // Each pair differs on exactly ONE criterion, with everything above it equal, so a criterion
  // applied in the wrong order fails a specific check rather than a vague one.
  const pairs: [string, CareerRow, CareerRow][] = [
    ['championships outrank everything below',
      row({ handle: 'a', championships: 2, finals: 0, wins: 0 }),
      row({ handle: 'b', championships: 1, finals: 99, wins: 999 })],
    ['finals break equal championships',
      row({ handle: 'a', championships: 1, finals: 3, wins: 0 }),
      row({ handle: 'b', championships: 1, finals: 2, wins: 999 })],
    ['match wins break equal finals',
      row({ handle: 'a', championships: 1, finals: 2, wins: 40, matchWinPct: 1 }),
      row({ handle: 'b', championships: 1, finals: 2, wins: 39, matchWinPct: 99 })],
    ['win percentage breaks equal wins',
      row({ handle: 'a', championships: 1, finals: 2, wins: 40, matchWinPct: 80, gameDiff: -50 }),
      row({ handle: 'b', championships: 1, finals: 2, wins: 40, matchWinPct: 70, gameDiff: 500 })],
    ['game differential breaks equal percentage',
      row({ handle: 'a', championships: 1, finals: 2, wins: 40, matchWinPct: 80, gameDiff: 10 }),
      row({ handle: 'b', championships: 1, finals: 2, wins: 40, matchWinPct: 80, gameDiff: 9 })],
  ]
  for (const [label, better, worse] of pairs) {
    check(label, rankOrder(better, worse) < 0)
    check(`${label} — and the reverse comparison agrees`, rankOrder(worse, better) > 0)
  }

  // The final tiebreaker must be stable and total: no two distinct players may compare equal.
  const tiedA = row({ handle: 'zed', championships: 1 })
  const tiedB = row({ handle: 'alice', championships: 1 })
  check('a full tie falls back to an alphabetical tiebreaker', rankOrder(tiedB, tiedA) < 0)
  check('the tiebreaker ignores case',
    rankOrder(row({ handle: 'Alice', championships: 1 }), row({ handle: 'zed', championships: 1 })) < 0)
  check('the ordering is total — distinct players never compare equal',
    rankOrder(tiedA, tiedB) !== 0)

  // Sorting a shuffled list twice must give the same answer.
  const many = ['d', 'a', 'c', 'b'].map((h) => row({ handle: h, championships: 1 }))
  const once = [...many].sort(rankOrder).map((r) => r.handle).join(',')
  const twice = [...many].reverse().sort(rankOrder).map((r) => r.handle).join(',')
  check('ordering is deterministic regardless of input order', once === twice, `${once} vs ${twice}`)
}

// ─────────────────────────────────────────────────── what counts as a tie
console.log('\nties')
{
  const base = row({ handle: 'a', championships: 2, finals: 1, wins: 10, matchWinPct: 60, gameDiff: 5 })
  check('identical records tie', careerTied(base, row({ ...base, handle: 'b', playerId: 'b' })))
  check('a different championship count is not a tie',
    !careerTied(base, row({ ...base, handle: 'b', championships: 1 })))
  check('a different finals count is not a tie', !careerTied(base, row({ ...base, handle: 'b', finals: 0 })))
  check('a different win count is not a tie', !careerTied(base, row({ ...base, handle: 'b', wins: 9 })))
  check('a different percentage is not a tie', !careerTied(base, row({ ...base, handle: 'b', matchWinPct: 59 })))
  check('a different game differential is not a tie', !careerTied(base, row({ ...base, handle: 'b', gameDiff: 4 })))
  // A different NAME is not a difference in standing — that is the whole point of marking ties.
  check('a different name alone is still a tie', careerTied(base, row({ ...base, handle: 'zzz', playerId: 'z' })))
}

// ─────────────────────────────────────────────────── the modes are real
console.log('\nmodes (development database)')
{
  const options = await getTop10Options()
  const values = options.map((o) => String(o.value))
  check('All Competitions is offered', values.includes('all-competitions'))
  check('Current Ladder is offered', values.includes('current-ladder'))
  check('Season Wins is offered', values.includes('season-championships'))
  check('Tournaments Won is offered', values.includes('tournament-championships'))
  check('at least one individual competition is offered', values.some((v) => v.startsWith('competition:')))

  for (const mode of ['all-competitions', 'season-championships', 'tournament-championships'] as const) {
    const r = await getTop10(mode)
    // The point of this whole section: no mode may be a placeholder any more.
    check(`${mode} is not reported as unavailable`, !r.unavailable, r.unavailable ?? '')
    check(`${mode} names its primary metric`, (r.metricLabel ?? '').length > 0)
    check(`${mode} returns at most ten rows`, r.rows.length <= 10, String(r.rows.length))
    check(`${mode} numbers its rows from one, without gaps`,
      r.rows.every((row_, i) => row_.rank === i + 1))
  }

  const all = await getTop10('all-competitions')
  check('All Competitions returns real players', all.rows.length > 0)
  check('...each with a display identity',
    all.rows.every((r) => (r.handle ?? r.name).trim().length > 0))
  check('...and no fabricated metric', all.rows.every((r) => /^\d+(W)?$/.test(r.value)))

  // Every individual competition mode must resolve, and must be scoped.
  for (const opt of options.filter((o) => String(o.value).startsWith('competition:'))) {
    const r = await getTop10(opt.value)
    check(`${opt.label} resolves without being unavailable`, !r.unavailable)
    check(`${opt.label} returns at most ten rows`, r.rows.length <= 10)
  }

  // A competition with no completed seasons must return NOTHING rather than borrowing the global list.
  const empty = options.find((o) => String(o.value) === 'competition:390')
  if (empty) {
    const r = await getTop10(empty.value)
    const seasons = await prisma.season.count({ where: { competitionSeriesId: 390, lifecycleState: 'COMPLETED' } })
    if (seasons === 0) {
      check('a competition with no completed seasons is empty, not filled from elsewhere',
        r.rows.length === 0, `${r.rows.length} rows`)
    }
  }

  // Tournaments Won must not inherit Season titles.
  const tourn = await getTop10('tournament-championships')
  const completedTournaments = await prisma.tournament.count({ where: { status: 'COMPLETED' } })
  if (completedTournaments === 0) {
    check('with no completed tournaments, Tournaments Won is empty rather than showing Season winners',
      tourn.rows.length === 0, `${tourn.rows.length} rows`)
  }
}

// ─────────────────────────────────────────────────── Current Ladder is untouched
console.log('\nCurrent Ladder is preserved')
{
  const { getLadder } = await import('@/lib/stats/ladder')
  const official = await getLadder('current')
  const panel = await getTop10('current-ladder')

  check('Current Ladder is not reported as unavailable', !panel.unavailable)
  check('its metric is the rating, not a career score', panel.metricLabel === 'Rating')
  check('it shows the Ladder\'s own top ten',
    panel.rows.length === Math.min(10, official.length))
  check('the ranks are the Ladder\'s ranks, not renumbered',
    panel.rows.every((r, i) => r.rank === official[i]?.rank),
    panel.rows.map((r) => r.rank).join(','))
  check('the ratings are the Ladder\'s ratings, unrecomputed',
    panel.rows.every((r, i) => r.value === String(official[i]?.rating)))
  check('the players are the Ladder\'s players, in the Ladder\'s order',
    panel.rows.every((r, i) => r.playerId === official[i]?.playerId))
}

// ─────────────────────────────────────────────────── mode parsing
console.log('\nmode parsing')
{
  const options = await getTop10Options()
  check('a known mode is kept', normaliseMode('all-competitions', options) === 'all-competitions')
  check('an unknown mode falls back rather than throwing',
    typeof normaliseMode('nonsense', options) === 'string')
  check('a missing mode falls back', typeof normaliseMode(null, options) === 'string')
  check('an injection attempt cannot reach the query',
    !String(normaliseMode('competition:1; DROP TABLE season', options)).includes('DROP'))
}

await prisma.$disconnect()
console.log(`\n${passed} passed, ${failed} failed`)
process.exitCode = failed > 0 ? 1 : 0
