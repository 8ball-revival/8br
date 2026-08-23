/**
 * The Wayback bracket parser, checked against brackets written by hand for the purpose.
 *
 * The fixtures below are the real page layout in miniature — same tab-aligned columns, same triple
 * structure, same decorations — so a case can be constructed that the captured files do not happen
 * to contain: a page that contradicts itself, a bye carrying a score, a duplicated player. The real
 * files are then parsed too, but only to confirm the parser agrees with what is actually there.
 *
 * No test here reaches the network. The captured files are read from the repository.
 *
 * Run: npx tsx --tsconfig scripts/tsconfig.verify.json --env-file=.env scripts/verify-wayback-parser.mts
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

import { parseWayback, detectFormat, normaliseHandle, identifyFile } from '../src/lib/archive/wayback.ts'

let pass = 0, fail = 0
const check = (label: string, ok: boolean, detail?: string) => {
  if (ok) { pass++; console.log(`  ✓ ${label}`) }
  else { fail++; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`) }
}
const section = (t: string) => console.log(`\n--- ${t} ---`)

/**
 * Build a page in the captured layout.
 *
 * `rounds` are the header labels; `body` rows are given as column→value maps so a fixture reads as
 * the bracket it represents rather than as a wall of tabs.
 */
function page(rounds: string[], body: Record<number, string>[]): string {
  const width = rounds.length * 2
  const header = rounds.map((r, i) => (i === 0 ? r : `\t${r}`)).join('\t')
  const lines = body.map((row) => {
    const cells: string[] = []
    for (let c = 0; c < width; c++) cells.push(row[c] ?? ' ')
    return cells.join('\t')
  })
  return ['A Season', 'Congrats to all listed below.', header, ...lines].join('\n')
}

/** A four-player bracket: two round-1 matches, then a Final. */
const FOUR = ['Round1', 'Round2', 'Winner']

// ─────────────────────────────────────────────────────────────────────────────────────────────────
section('An ordinary bracket')
{
  const text = page(FOUR, [
    { 0: '1', 1: 'alpha' },
    { 0: '7-3', 2: 'alpha' },
    { 0: '4', 1: 'delta' },
    { 2: '9-5', 4: 'alpha' },
    { 0: '2', 1: 'bravo' },
    { 0: '2-7', 2: 'charlie' },
    { 0: '3', 1: 'charlie' },
  ])
  const b = parseWayback(text, 'fixtures/2009 s9.txt')
  check('the layout is recognised', b.format === 'columnar', b.format)
  check('the file names the Season', b.competitionYear === 2009 && b.seasonNumber === 9)
  check('four places, two rounds of play', b.bracketSize === 4 && b.matches.length === 3, `${b.bracketSize}/${b.matches.length}`)
  const r1 = b.matches.filter((m) => m.round === 1)
  check('round 1 pairs the seeds as printed',
    r1[0].home?.normalizedHandle === 'alpha' && r1[0].away?.normalizedHandle === 'delta' &&
    r1[1].home?.normalizedHandle === 'bravo' && r1[1].away?.normalizedHandle === 'charlie')
  check('seeds are read', r1[0].home?.seed === 1 && r1[0].away?.seed === 4)
  check('a score is read the way round it is printed', r1[0].scoreHome === 7 && r1[0].scoreAway === 3)
  check('the winner is who the page carries forward', r1[0].winnerHandle === 'alpha')
  check('the Final is reached', b.matches.some((m) => m.round === 2 && m.scoreHome === 9))
  check('the champion is named', b.champion === 'alpha', String(b.champion))
  check('the runner-up is the other finalist', b.runnerUp === 'charlie', String(b.runnerUp))
  check('the whole bracket validates', b.validation.category === 'full', b.validation.problems.join('; '))
  check('every match is proven', b.matches.every((m) => m.proven))
}

section('A score printed the other way round')
{
  // The lower number first: the away player won, and the page carries them forward.
  const text = page(FOUR, [
    { 0: '1', 1: 'alpha' },
    { 0: '3-7', 2: 'delta' },
    { 0: '4', 1: 'delta' },
    { 2: '5-9', 4: 'charlie' },
    { 0: '2', 1: 'bravo' },
    { 0: '2-7', 2: 'charlie' },
    { 0: '3', 1: 'charlie' },
  ])
  const b = parseWayback(text, 'fixtures/2009 s9.txt')
  const m = b.matches[0]
  check('the away player wins when their score is higher', m.scoreHome === 3 && m.scoreAway === 7 && m.winnerHandle === 'delta')
  check('the bracket still validates', b.validation.category === 'full', b.validation.problems.join('; '))
}

section('A bye')
{
  // The page prints 7-0 beside the walkover. It must not become a played result.
  const text = page(FOUR, [
    { 0: '1', 1: 'alpha' },
    { 0: '7-0', 2: 'alpha' },
    { 0: '4', 1: 'bye' },
    { 2: '9-5', 4: 'alpha' },
    { 0: '2', 1: 'bravo' },
    { 0: '2-7', 2: 'charlie' },
    { 0: '3', 1: 'charlie' },
  ])
  const b = parseWayback(text, 'fixtures/2009 s9.txt')
  const m = b.matches[0]
  check('a bye is marked as one', m.bye)
  check('a bye carries no score, even though the page prints one',
    m.scoreHome === null && m.scoreAway === null, `${m.scoreHome}-${m.scoreAway}`)
  check('what the page printed is still recorded', m.rawScore === '7-0')
  check('the surviving player advances', m.winnerHandle === 'alpha')
  check('a bye does not stop the bracket validating', b.validation.category === 'full', b.validation.problems.join('; '))
}

section('Decorations and annotations')
{
  const text = page(FOUR, [
    { 0: '1', 1: 'the_pool_professor®' },
    { 0: '7-3', 2: 'the_pool_professor®' },
    { 0: '4', 1: 'x_majik.shots_x [w/c]' },
    { 2: '9-5', 4: 'the_pool_professor®' },
    { 0: '2', 1: 'l1_stephen_1' },
    { 0: '2-7', 2: 'xlx_spg_xlx' },
    { 0: '3', 1: 'xlx_spg_xlx' },
  ])
  const b = parseWayback(text, 'fixtures/2010 s2.txt')
  const r1 = b.matches.filter((m) => m.round === 1)
    check('a decorative suffix is removed', r1[0].home?.normalizedHandle === 'the_pool_professor',
    r1[0].home?.normalizedHandle)
  check('the raw text is kept as printed', r1[0].home?.rawHandle.includes('®'))
  check('a wildcard annotation is removed', r1[0].away?.normalizedHandle === 'x_majik.shots_x',
    r1[0].away?.normalizedHandle)
  check('underscores and digits survive', r1[1].home?.normalizedHandle === 'l1_stephen_1')
  check('dots inside a handle survive', normaliseHandle('cool.combos') === 'cool.combos')
}

section('A page that records no result')
{
  const text = page(FOUR, [
    { 0: '1', 1: 'alpha' },
    { 0: 'RT7 Win By 2', 2: 'alpha' },
    { 0: '4', 1: 'delta' },
    { 2: '9-5', 4: 'alpha' },
    { 0: '2', 1: 'bravo' },
    { 0: '2-7', 2: 'charlie' },
    { 0: '3', 1: 'charlie' },
  ])
  const b = parseWayback(text, 'fixtures/2009 s9.txt')
  const m = b.matches[0]
  check('the format text is not mistaken for a score', m.scoreHome === null && m.rawScore === 'RT7 Win By 2')
  check('that match is not proven', !m.proven)
  check('but its neighbours still are', b.matches[1].proven && b.matches[2].proven)
  check('the bracket is partial rather than full', b.validation.category === 'partial', b.validation.category)
  check('the first unsupported match is named',
    b.validation.firstUnsupported?.round === 1 && b.validation.firstUnsupported?.position === 0,
    JSON.stringify(b.validation.firstUnsupported))
}

section('Empty cells are not byes')
{
  const text = page(FOUR, [
    { 0: '1', 1: 'alpha' },
    { 0: '7-3', 2: 'alpha' },
    { 0: '4', 1: 'delta' },
    { 2: ' ', 4: 'alpha' },
    { 0: '2', 1: 'bravo' },
    { 0: '2-7', 2: 'charlie' },
    { 0: '3', 1: 'charlie' },
  ])
  const b = parseWayback(text, 'fixtures/2009 s9.txt')
  const fin = b.matches.find((m) => m.round === 2)!
  check('a blank result cell is not read as a bye', !fin.bye)
  check('a blank result cell yields no score', fin.scoreHome === null)
  check('the bracket is partial, not full', b.validation.category === 'partial', b.validation.category)
}

section('A page that contradicts itself')
{
  // The Final's score gives charlie, but the page names alpha as champion.
  const text = page(FOUR, [
    { 0: '1', 1: 'alpha' },
    { 0: '7-3', 2: 'alpha' },
    { 0: '4', 1: 'delta' },
    { 2: '5-9', 4: 'alpha' },
    { 0: '2', 1: 'bravo' },
    { 0: '2-7', 2: 'charlie' },
    { 0: '3', 1: 'charlie' },
  ])
  const b = parseWayback(text, 'fixtures/2009 s9.txt')
  check('the disagreement is caught', b.validation.category === 'contradictory', b.validation.category)
  check('it says what disagrees',
    b.validation.problems.some((p) => /does not produce the champion/.test(p)),
    b.validation.problems.join('; '))
  check('no side of the contradiction is silently preferred',
    b.champion === 'alpha' && b.matches.find((m) => m.round === 2)?.scoreHome === 5)
}

section('One player in two places')
{
  const text = page(FOUR, [
    { 0: '1', 1: 'alpha' },
    { 0: '7-3', 2: 'alpha' },
    { 0: '4', 1: 'delta' },
    { 2: '9-5', 4: 'alpha' },
    { 0: '2', 1: 'alpha' },
    { 0: '2-7', 2: 'charlie' },
    { 0: '3', 1: 'charlie' },
  ])
  const b = parseWayback(text, 'fixtures/2009 s9.txt')
  check('a duplicated player is caught', b.validation.category === 'contradictory', b.validation.category)
  check('the duplicate is named',
    b.validation.problems.some((p) => /alpha occupies 2 positions/.test(p)), b.validation.problems.join('; '))
}

section('The 2005-era pages record no result at all')
{
  const era = 'Congrats to all listed below.\nROUND 1:\t\t\tQUARTER FINALS :\t\t\tSEMI FINALS:\n(A1) xlx_cerebro_xlx\nRace to 7 win by 2\n(D4) mtvaldo'
  check('the older layout is recognised as its own era', detectFormat(era) === 'era-2005')
  const b = parseWayback(era, 'fixtures/2005 s1.txt')
  check('it is classified as placement evidence only', b.validation.category === 'placement-only', b.validation.category)
  check('it yields no matches to import', b.matches.length === 0)
  check('and says why', b.validation.problems.some((p) => /record no result/.test(p)))
}

section('Division isolation')
{
  const b = parseWayback(page(FOUR, [{ 0: '1', 1: 'alpha' }, { 0: '7-3', 2: 'alpha' }, { 0: '4', 1: 'delta' }]), 'fixtures/2011 s1.txt')
  check('every captured bracket is Division A', b.division === 'A')
  check('the file name identifies the Season', identifyFile('2011 s1.txt')?.seasonNumber === 1)
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
section('The captured files themselves')
const ROOT = 'archive/wayback-seasons'
if (!existsSync(ROOT)) {
  check('the captured Wayback files are present', false)
} else {
  const files: string[] = []
  for (const year of readdirSync(ROOT)) {
    const dir = join(ROOT, year)
    for (const f of readdirSync(dir)) files.push(join(dir, f))
  }
  check(`every captured file parses without throwing (${files.length})`, files.length > 0)

  let columnar = 0, era = 0, other = 0, withScores = 0
  const categories: Record<string, number> = {}
  for (const f of files) {
    const b = parseWayback(readFileSync(f, 'utf8'), f)
    if (b.format === 'columnar') columnar++
    else if (b.format === 'era-2005') era++
    else other++
    if (b.matches.some((m) => m.scoreHome !== null)) withScores++
    categories[b.validation.category] = (categories[b.validation.category] ?? 0) + 1
  }
  check('the two layouts are both present', columnar > 0 && era > 0, `${columnar} columnar, ${era} era-2005, ${other} other`)
  check('no 2005-era file yields a score',
    files.filter((f) => /200[56]/.test(f)).every((f) => !parseWayback(readFileSync(f, 'utf8'), f).matches.some((m) => m.scoreHome !== null)))
  console.log(`  (categories: ${JSON.stringify(categories)}; ${withScores} file(s) carry at least one score)`)

  // Parsing must be a pure function of the file.
  const sample = files.find((f) => f.includes('2009')) ?? files[0]
  const a = parseWayback(readFileSync(sample, 'utf8'), sample)
  const c = parseWayback(readFileSync(sample, 'utf8'), sample)
  check('parsing the same file twice gives the same answer', JSON.stringify(a) === JSON.stringify(c))
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
if (fail > 0) process.exitCode = 1

// ─────────────────────────────────────────────────────────────────────────────────────────────────
section('Forfeits, walkovers and disqualifications')
{
  const withResult = (cell: string) => page(FOUR, [
    { 0: '1', 1: 'alpha' },
    { 0: cell, 2: 'delta' },
    { 0: '4', 1: 'delta' },
    { 2: '9-5', 4: 'delta' },
    { 0: '2', 1: 'bravo' },
    { 0: '2-7', 2: 'charlie' },
    { 0: '3', 1: 'charlie' },
  ])

  // "0-FF": the away side gave it up, so the home player advances... except the page carries delta,
  // so this fixture puts the FF on the home side to match.
  const homeGaveUp = parseWayback(withResult('FF-7'), 'fixtures/2008 s4.txt')
  const m1 = homeGaveUp.matches[0]
  check('FF on the printed left is the home player forfeiting',
    m1.outcome === 'forfeit' && m1.forfeitedBy === 'home', `${m1.outcome}/${m1.forfeitedBy}`)
  check('a forfeit awards no games to either side', m1.scoreHome === null && m1.scoreAway === null)
  check('the raw text is kept', m1.rawScore === 'FF-7')
  check('the opponent advances', m1.winnerHandle === 'delta')
  check('a forfeit counts as proven', m1.proven)

  const awayGaveUp = parseWayback(page(FOUR, [
    { 0: '1', 1: 'alpha' },
    { 0: '0-FF', 2: 'alpha' },
    { 0: '4', 1: 'delta' },
    { 2: '9-5', 4: 'alpha' },
    { 0: '2', 1: 'bravo' },
    { 0: '2-7', 2: 'charlie' },
    { 0: '3', 1: 'charlie' },
  ]), 'fixtures/2008 s4.txt')
  const m2 = awayGaveUp.matches[0]
  check('FF on the printed right is the away player forfeiting',
    m2.outcome === 'forfeit' && m2.forfeitedBy === 'away', `${m2.outcome}/${m2.forfeitedBy}`)
  check('and the home player advances', m2.winnerHandle === 'alpha')
  check('a bracket decided by forfeit still validates', awayGaveUp.validation.category === 'full',
    awayGaveUp.validation.problems.join('; '))

  const dq = parseWayback(withResult('7-DQ'), 'fixtures/2011 s5.txt')
  const m3 = dq.matches[0]
  check('a disqualification is its own outcome', m3.outcome === 'disqualification', m3.outcome)
  check('a disqualification is never treated as a forfeit', m3.forfeitedBy === null)
  check('it awards no score', m3.scoreHome === null && m3.scoreAway === null)
  check('it is not proven', !m3.proven)
  check('the bracket stops there rather than guessing', dq.validation.category === 'partial', dq.validation.category)
  check('the reason names the disqualification',
    dq.validation.problems.some((p) => /disqualification/.test(p)), dq.validation.problems.join('; '))

  const dqff = parseWayback(withResult("DQ'd-FF'd"), 'fixtures/2011 s5.txt')
  check('a cell naming both stays a disqualification', dqff.matches[0].outcome === 'disqualification',
    dqff.matches[0].outcome)

  const wo = parseWayback(withResult('--W/O'), 'fixtures/2008 s3.txt')
  check('a walkover with no side named is not a forfeit', wo.matches[0].outcome === 'walkover', wo.matches[0].outcome)
  check('and names nobody', wo.matches[0].forfeitedBy === null)
  check('so it is not proven', !wo.matches[0].proven)

  // A bye beside a forfeit must stay a bye.
  const byeAndFf = parseWayback(page(FOUR, [
    { 0: '1', 1: 'alpha' },
    { 0: '0-FF', 2: 'alpha' },
    { 0: '4', 1: 'bye' },
    { 2: '9-5', 4: 'alpha' },
    { 0: '2', 1: 'bravo' },
    { 0: '2-7', 2: 'charlie' },
    { 0: '3', 1: 'charlie' },
  ]), 'fixtures/2008 s4.txt')
  check('a bye beside a forfeit marker is still a bye',
    byeAndFf.matches[0].outcome === 'bye' && byeAndFf.matches[0].bye, byeAndFf.matches[0].outcome)
  check('and awards nothing', byeAndFf.matches[0].scoreHome === null)

  // Reading is deterministic.
  check('reading the same forfeit twice gives the same answer',
    JSON.stringify(parseWayback(withResult('FF-7'), 'fixtures/2008 s4.txt')) === JSON.stringify(homeGaveUp))
}
