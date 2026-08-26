/**
 * The achievement rule engine, tested against archives built by hand.
 *
 * ── Why synthetic rows ───────────────────────────────────────────────────────────────────────────
 * The engine's job is to turn a rule into a holder. Asserting "most losses is tino_nica" against the
 * live archive tests nothing durable: it passes today, breaks the next time a season is imported,
 * and gets "fixed" by editing the expected name. Worse, the real data does not contain the cases
 * that matter most — a deliberate tie, a player one match under a minimum, a rule nobody satisfies.
 *
 * So the row set is constructed. Each case has one known answer and one trap: a minimum that must
 * exclude somebody, a tie that must not be broken silently, an empty result that must not crash.
 *
 * A final section runs the real definitions over the real archive, which is the part a fixture
 * cannot check: that the seeded rules still resolve, produce sane values, and agree with the
 * Rankings aggregate they are derived from.
 */
import { prisma } from '../src/lib/prisma.ts'
import { assertLocalDatabase } from '../src/lib/db-guard.ts'
import { evaluate, evaluateAll, scopeKey, type EvaluationContext } from '../src/lib/achievements/engine.ts'
import { validateDefinition, isValid } from '../src/lib/achievements/validate.ts'
import { validateFormat, applyFormat, statistic, STATISTICS } from '../src/lib/achievements/statistics.ts'
import { shuffleWith } from '../src/lib/achievements/shuffle.ts'
import type { ExplorerRow } from '../src/lib/stats/ladder-explorer.ts'

assertLocalDatabase()

let pass = 0
let fail = 0
const check = (label: string, ok: boolean, detail?: string) => {
  if (ok) { pass++; console.log(`  ✓ ${label}`) }
  else { fail++; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`) }
}
const section = (t: string) => console.log(`\n--- ${t} ---`)

/* ─────────────────────────────────────────────────────────────────────────── fixtures ─────────── */

function row(handle: string, over: Partial<ExplorerRow> = {}): ExplorerRow {
  return {
    playerId: handle, preferredName: handle.toUpperCase(), cueverseId: handle,
    label: handle, slug: handle, rank: 1,
    wins: 0, losses: 0, draws: 0, played: 0, matchWinPct: 0,
    gamesWon: 0, gamesLost: 0, gameDiff: 0, gameWinPct: 0,
    rating: 1500, peakRating: 1500, currentStreak: 0, longestStreak: 0,
    competitionsEntered: 0, seasonsPlayed: 0, forfeits: 0, idleDays: null,
    groupDraws: 0, playoffDraws: 0, tournamentDraws: 0,
    groupWins: 0, groupLosses: 0, playoffWins: 0, playoffLosses: 0,
    tournamentWins: 0, tournamentLosses: 0,
    seasonTitles: 0, tournamentTitles: 0,
    ...over,
  } as ExplorerRow
}

/** A definition with sane defaults; every test overrides only what it is about. */
function def(over: Record<string, unknown> = {}) {
  return {
    id: 1, key: 'test', title: 'TEST', flavorText: 'flavour', description: 'explanation',
    awardType: 'AUTOMATIC', status: 'ACTIVE', sortOrder: 0, displayFormat: '{value}',
    statistic: 'wins', scope: 'ALL_COMPETITIONS', competitionId: null, seasonId: null,
    tournamentId: null, stage: 'ALL_MATCHES', winner: 'HIGHEST', platform: 'YAHOO',
    minMatches: null, minSeasons: null, minFinals: null, minPlayoffMatches: null,
    tiePolicy: 'SHOW_ALL', tieBreakStat: null, emptyBehavior: 'HIDE',
    manualPlayerId: null, manualValue: null, manualNote: null, manualDate: null,
    createdAt: new Date(), updatedAt: new Date(), createdBy: null, updatedBy: null,
    ...over,
  } as unknown as Parameters<typeof evaluate>[0]
}

const ctxOf = (d: ReturnType<typeof def>, rows: ExplorerRow[], finals = new Map()): EvaluationContext => ({
  rows: new Map([[scopeKey(d), rows]]),
  finals,
  manualPlayers: new Map(),
})

const holders = (d: ReturnType<typeof def>, rows: ExplorerRow[], finals?: Map<string, { reached: number; won: number; lost: number }>) => {
  const card = evaluate(d, ctxOf(d, rows, finals ?? new Map()))
  return { card, names: (card?.winners ?? []).map((w) => w.cueverseId).sort() }
}

/* ──────────────────────────────────────────────────────────────────────── winner logic ────────── */

section('Highest and lowest')
{
  const rows = [row('a', { wins: 10 }), row('b', { wins: 30 }), row('c', { wins: 20 })]

  const high = holders(def({ statistic: 'wins', displayFormat: '{value} WINS' }), rows)
  check('highest value picks the top', high.names.join() === 'b', high.names.join())
  check('...and formats the figure', high.card?.stat === '30 WINS', high.card?.stat)

  const low = holders(def({ statistic: 'wins', winner: 'LOWEST' }), rows)
  check('lowest value picks the bottom', low.names.join() === 'a', low.names.join())

  const losses = holders(def({ statistic: 'losses', displayFormat: '{value} LOSSES' }),
    [row('a', { losses: 184 }), row('b', { losses: 186 })])
  check('most losses is a first-class rule', losses.names.join() === 'b')
  check('...and reads the losses column, not the wins one', losses.card?.stat === '186 LOSSES', losses.card?.stat)
}

/* ─────────────────────────────────────────────────────────────────────────── minimums ─────────── */

section('Minimum qualification')
{
  /*
   * The case the minimum exists for: a perfect record over one match must not beat a strong record
   * over a hundred. Without the floor, `oneAndDone` wins every rate-based award on the site.
   */
  const rows = [
    row('oneAndDone', { wins: 1, losses: 0, played: 1, matchWinPct: 100 }),
    row('grinder', { wins: 80, losses: 20, played: 100, matchWinPct: 80 }),
  ]

  const noMin = holders(def({ statistic: 'winPct' }), rows)
  check('with no minimum, a 1-0 record tops the win rate', noMin.names.join() === 'oneAndDone')

  const withMin = holders(def({ statistic: 'winPct', minMatches: 50, displayFormat: '{value}% WIN RATE' }), rows)
  check('a minimum of 50 excludes them', withMin.names.join() === 'grinder', withMin.names.join())
  check('...and the percentage is shown to one decimal', withMin.card?.stat === '80.0% WIN RATE', withMin.card?.stat)

  const seasons = holders(def({ statistic: 'wins', minSeasons: 5 }),
    [row('a', { wins: 99, seasonsPlayed: 2 }), row('b', { wins: 10, seasonsPlayed: 9 })])
  check('a seasons minimum excludes a high scorer who has not played enough', seasons.names.join() === 'b')

  const playoffs = holders(def({ statistic: 'wins', minPlayoffMatches: 10 }),
    [row('a', { wins: 99, playoffWins: 2, playoffLosses: 1 }), row('b', { wins: 5, playoffWins: 8, playoffLosses: 6 })])
  check('a playoff-matches minimum counts wins, losses and draws together', playoffs.names.join() === 'b')

  const finals = new Map([['b', { reached: 4, won: 2, lost: 2 }]])
  const finalsMin = holders(def({ statistic: 'wins', minFinals: 3 }),
    [row('a', { wins: 99 }), row('b', { wins: 5 })], finals)
  check('a finals minimum excludes somebody who has reached none', finalsMin.names.join() === 'b')
}

/* ─────────────────────────────────────────────────────────────────────────────── ties ─────────── */

section('Ties are never broken silently')
{
  const tied = [row('alice', { wins: 30 }), row('bob', { wins: 30 }), row('carol', { wins: 12 })]

  const all = holders(def({ statistic: 'wins' }), tied)
  check('SHOW_ALL lists every tied holder', all.names.join() === 'alice,bob', all.names.join())
  check('...and the card says so', (all.card?.detail ?? '').includes('2 players tied'), all.card?.detail)

  const broken = holders(def({ statistic: 'wins', tiePolicy: 'SECONDARY_STAT', tieBreakStat: 'rating' }),
    [row('alice', { wins: 30, rating: 1600 }), row('bob', { wins: 30, rating: 1900 })])
  check('a secondary statistic resolves it', broken.names.join() === 'bob', broken.names.join())

  /*
   * If the tie-break is ALSO level, everybody survives rather than one being taken by array order.
   * Picking silently is the specific behaviour this policy exists to prevent.
   */
  const stillTied = holders(def({ statistic: 'wins', tiePolicy: 'SECONDARY_STAT', tieBreakStat: 'rating' }),
    [row('alice', { wins: 30, rating: 1700 }), row('bob', { wins: 30, rating: 1700 })])
  check('an unresolved tie-break still shows both', stillTied.names.join() === 'alice,bob', stillTied.names.join())

  const order1 = holders(def({ statistic: 'wins' }), tied).names.join()
  const order2 = holders(def({ statistic: 'wins' }), [...tied].reverse()).names.join()
  check('the order of tied holders does not depend on row order', order1 === order2, `${order1} vs ${order2}`)
}

/* ────────────────────────────────────────────────────────────────────── empty results ─────────── */

section('A rule that matches nobody')
{
  const impossible = def({ statistic: 'winPct', minMatches: 500, emptyBehavior: 'HIDE' })
  const hidden = evaluate(impossible, ctxOf(impossible, [row('a', { played: 10, matchWinPct: 90 })]))
  check('HIDE removes the card entirely', hidden === null)

  const placeholderDef = def({ statistic: 'winPct', minMatches: 500, emptyBehavior: 'SHOW_PLACEHOLDER' })
  const shown = evaluate(placeholderDef, ctxOf(placeholderDef, [row('a', { played: 10, matchWinPct: 90 })]))
  check('SHOW_PLACEHOLDER keeps it and says so', shown != null && shown.stat === 'No qualifying player yet')
  check('...with no winner attached', (shown?.winners.length ?? -1) === 0)

  const noRows = def({ statistic: 'wins', emptyBehavior: 'SHOW_PLACEHOLDER' })
  check('an empty archive does not throw', evaluate(noRows, ctxOf(noRows, [])) != null)

  const unknown = def({ statistic: 'not-a-real-statistic' })
  check('an unknown statistic is refused rather than guessed', evaluate(unknown, ctxOf(unknown, [row('a')])) === null)
}

/* ───────────────────────────────────────────────────────────────────────────── manual ─────────── */

section('Manual awards')
{
  const m = def({ awardType: 'MANUAL', manualPlayerId: 'p1', manualValue: '6-0 in finals', manualNote: 'By hand.' })
  const ctx: EvaluationContext = {
    rows: new Map(), finals: new Map(),
    manualPlayers: new Map([['p1', { cueverseId: 'deep.cerebro', preferredName: 'Luis' }]]),
  }
  const card = evaluate(m, ctx)
  check('the stored value is shown verbatim', card?.stat === '6-0 in finals', card?.stat)
  check('the holder is resolved through the Player record', card?.winners[0]?.cueverseId === 'deep.cerebro')
  check('...including their preferred name', card?.winners[0]?.preferredName === 'Luis')
  check('the note is appended to the explanation', (card?.detail ?? '').includes('By hand.'))

  const siteWide = evaluate(def({ awardType: 'MANUAL', manualValue: 'Still nobody' }), ctx)
  check('a manual award with no player is site-wide rather than empty',
    siteWide?.siteWide === true && siteWide.stat === 'Still nobody')
}

/* ───────────────────────────────────────────────────────────────── scope and stage keys ───────── */

section('Scope and stage select different data')
{
  const all = def({ scope: 'ALL_COMPETITIONS', stage: 'ALL_MATCHES' })
  const seasons = def({ scope: 'SEASONS', stage: 'ALL_MATCHES' })
  const playoffs = def({ scope: 'ALL_COMPETITIONS', stage: 'PLAYOFFS' })
  const oneSeason = def({ scope: 'SPECIFIC_SEASON', seasonId: 443 })

  check('a different competition scope is a different query', scopeKey(all) !== scopeKey(seasons))
  check('a different stage is a different query', scopeKey(all) !== scopeKey(playoffs))
  check('a specific season is a different query again', scopeKey(all) !== scopeKey(oneSeason))
  check('the same rule twice shares one query', scopeKey(all) === scopeKey(def()))
}

/* ─────────────────────────────────────────────────────────────────────────── validation ───────── */

section('Validation refuses what cannot work')
{
  const base = { title: 'X', displayFormat: '{value}', awardType: 'AUTOMATIC' as const }

  check('a percentage without a minimum is refused',
    !isValid(validateDefinition({ ...base, statistic: 'winPct', winner: 'HIGHEST' })))
  check('...and accepted with one',
    isValid(validateDefinition({ ...base, statistic: 'winPct', winner: 'HIGHEST', minMatches: 50 })))
  check('a trivially small minimum is still refused',
    !isValid(validateDefinition({ ...base, statistic: 'winPct', winner: 'HIGHEST', minMatches: 3 })))

  check('a missing statistic is refused', !isValid(validateDefinition({ ...base, statistic: null })))
  check('a specific-competition scope needs a competition',
    !isValid(validateDefinition({ ...base, statistic: 'wins', scope: 'SPECIFIC_COMPETITION' })))
  check('a manual award needs a value',
    !isValid(validateDefinition({ title: 'X', displayFormat: '{value}', awardType: 'MANUAL' })))
  check('...but not a player, so a site-wide fact is expressible',
    isValid(validateDefinition({ title: 'X', displayFormat: '{value}', awardType: 'MANUAL', manualValue: 'Nobody' })))

  /*
   * Both cases carry `winner`, so the only difference between them is the statistic.
   *
   * Without it the "refused" case failed for two reasons at once and would have passed even if the
   * stage rule did nothing — a test that cannot distinguish its own subject.
   */
  check('the Finals stage is refused for a non-finals statistic',
    !isValid(validateDefinition({ ...base, statistic: 'wins', winner: 'HIGHEST', stage: 'FINALS' })))
  check('...and allowed for a finals one',
    isValid(validateDefinition({ ...base, statistic: 'finalsLost', winner: 'HIGHEST', stage: 'FINALS' })))

  check('a tie-break must differ from the main statistic',
    !isValid(validateDefinition({ ...base, statistic: 'wins', tiePolicy: 'SECONDARY_STAT', tieBreakStat: 'wins' })))

  check('an empty title is refused', !isValid(validateDefinition({ ...base, title: '', statistic: 'wins' })))
}

section('Display formats')
{
  check('{value} is accepted', validateFormat('{value} LOSSES').ok)
  check('a format with no token is refused', !validateFormat('LOSSES').ok)
  check('a misspelled token is refused', !validateFormat('{valeu} LOSSES').ok)
  check('two tokens are refused', !validateFormat('{value} of {value}').ok)
  check('an empty format is refused', !validateFormat('   ').ok)
  check('substitution puts the figure in place', applyFormat('{value} LOSSES', '186') === '186 LOSSES')
  check('a percentage format reads correctly', applyFormat('{value}% WIN RATE', '83.2') === '83.2% WIN RATE')
}

/* ──────────────────────────────────────────────────────────────────────────── shuffling ───────── */

section('Homepage shuffling')
{
  const list = [1, 2, 3, 4, 5, 6, 7, 8]
  /* A fixed generator, because a shuffle cannot be tested by asserting on luck. */
  let seed = 0
  const fixed = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280 }

  const a = shuffleWith(list, fixed)
  check('every item survives the shuffle', [...a].sort((x, y) => x - y).join() === list.join(), a.join())
  check('nothing is duplicated', new Set(a).size === list.length)
  check('the input is not mutated', list.join() === '1,2,3,4,5,6,7,8')

  seed = 0
  check('the same source gives the same permutation', shuffleWith(list, fixed).join() === a.join())

  /* Over many real shuffles the first slot should not be dominated by the original first item. */
  const firsts = new Set<number>()
  for (let i = 0; i < 200; i++) firsts.add(shuffleWith(list, Math.random)[0])
  check('the first position is genuinely varied', firsts.size >= 5, `${firsts.size} distinct leaders in 200 shuffles`)
}

/* ────────────────────────────────────────────────────────────── the real seeded set ───────────── */

section('The seeded definitions, against the real archive')
{
  const defs = await prisma.achievementDefinition.findMany({ where: { status: 'ACTIVE' }, orderBy: { sortOrder: 'asc' } })
  check('definitions are seeded', defs.length > 0, `${defs.length}`)

  const auto = defs.filter((d) => d.awardType === 'AUTOMATIC')
  const manual = defs.filter((d) => d.awardType === 'MANUAL')
  check('both award types are represented', auto.length > 0 && manual.length > 0, `${auto.length} auto, ${manual.length} manual`)

  check('every automatic definition names a statistic the registry knows',
    auto.every((d) => statistic(d.statistic) != null),
    auto.filter((d) => !statistic(d.statistic)).map((d) => `${d.key}:${d.statistic}`).join(', '))
  check('every stored display format is valid',
    defs.every((d) => validateFormat(d.displayFormat).ok),
    defs.filter((d) => !validateFormat(d.displayFormat).ok).map((d) => d.key).join(', '))
  check('every stored definition would pass validation today',
    defs.every((d) => isValid(validateDefinition({
      title: d.title, displayFormat: d.displayFormat, awardType: d.awardType,
      statistic: d.statistic, scope: d.scope, competitionId: d.competitionId,
      seasonId: d.seasonId, tournamentId: d.tournamentId, stage: d.stage, winner: d.winner,
      minMatches: d.minMatches, tiePolicy: d.tiePolicy, tieBreakStat: d.tieBreakStat,
      manualPlayerId: d.manualPlayerId, manualValue: d.manualValue,
    }))),
    defs.filter((d) => !isValid(validateDefinition({
      title: d.title, displayFormat: d.displayFormat, awardType: d.awardType,
      statistic: d.statistic, scope: d.scope, competitionId: d.competitionId,
      seasonId: d.seasonId, tournamentId: d.tournamentId, stage: d.stage, winner: d.winner,
      minMatches: d.minMatches, tiePolicy: d.tiePolicy, tieBreakStat: d.tieBreakStat,
      manualPlayerId: d.manualPlayerId, manualValue: d.manualValue,
    }))).map((d) => d.key).join(', '))

  const cards = await evaluateAll(defs)
  check('every definition resolves to a card', cards.length === defs.length, `${cards.length} of ${defs.length}`)
  check('every card carries a title and a figure', cards.every((c) => c.title && c.stat))
  check('every named holder carries a CueVerse ID',
    cards.every((c) => c.winners.every((w) => (w.cueverseId ?? '').length > 0)))

  /* Determinism: the same archive must give the same holders, including the order of tied ones. */
  const again = await evaluateAll(defs)
  check('two runs over the same archive agree exactly', JSON.stringify(cards) === JSON.stringify(again))

  /*
   * The figures reconcile with the Rankings aggregate. Checked on wins, because it is the one an
   * achievement and a leaderboard would most obviously be expected to agree about.
   */
  const winsCard = cards.find((c) => c.title === 'ABSOLUTE UNIT')
  if (winsCard) {
    const { computeExplorer } = await import('../src/lib/stats/ladder-explorer.ts')
    const rows = await computeExplorer('all-time', 'overall', { platform: 'YAHOO' })
    const top = Math.max(...rows.map((r) => r.wins))
    check('the most-wins award matches the Rankings aggregate',
      winsCard.stat === `${top.toLocaleString()} WINS`, `${winsCard.stat} vs ${top}`)
  }

  check('the statistic registry is non-trivial', STATISTICS.length >= 20, `${STATISTICS.length} statistics`)
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
await prisma.$disconnect()
process.exit(fail === 0 ? 0 : 1)
