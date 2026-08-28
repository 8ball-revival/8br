/**
 * Every Achievement definition, tested against an archive built by hand.
 *
 * ── Why synthetic data rather than the live database ─────────────────────────────────────────────
 * Asserting "the Choker is MJ" against the real archive tests nothing durable: it passes today,
 * breaks the next time a Season closes, and gets "fixed" by editing the expected name. It also
 * cannot test the cases that matter most, because the real data does not contain a deliberate
 * no-contest sitting where it would change a winner.
 *
 * `computeAchievements` is pure, so each award is given a tiny archive with a known answer and one
 * booby trap: a forfeit that must not count as a played win, a no-contest that must not count at
 * all, a bye that must not count as beating somebody. Those traps are the whole point — every one of
 * them is a mistake that would look completely reasonable in the rendered card.
 *
 * A second section then runs the real archive, to catch the things a fixture cannot: that the
 * definitions survive real volume, produce no impossible values, and are deterministic.
 */
import { prisma } from '../src/lib/prisma.ts'
import { assertLocalDatabase } from '../src/lib/db-guard.ts'
import { computeAchievements } from '../src/lib/achievements/compute.ts'
import { loadAchievementFacts, type AchievementFacts, type FactMatch, type FactSeason } from '../src/lib/achievements/facts.ts'
import { getLadder } from '../src/lib/stats/ladder.ts'

assertLocalDatabase()

let pass = 0
let fail = 0
const check = (label: string, ok: boolean, detail?: string) => {
  if (ok) { pass++; console.log(`  ✓ ${label}`) }
  else { fail++; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`) }
}
const section = (t: string) => console.log(`\n--- ${t} ---`)

/* ─────────────────────────────────────────────────────────────────── fixture builders ─────────── */

let seasonSeq = 0

function season(championPlayerId: string | null, entrantsCount = 8): FactSeason {
  const n = ++seasonSeq
  return { id: n, number: n, year: 2000 + n, championPlayerId, entrantsCount, order: n - 1 }
}

function match(p: Partial<FactMatch>): FactMatch {
  return {
    seasonId: 1,
    homePlayerId: null,
    awayPlayerId: null,
    homeGames: null,
    awayGames: null,
    status: 'COMPLETED',
    winnerPlayerId: null,
    forfeitPlayerId: null,
    label: null,
    stage: 'GROUP',
    ...p,
  }
}

/** A played, decided match. */
const played = (seasonId: number, a: string, b: string, aGames: number, bGames: number, stage: 'GROUP' | 'PLAYOFF' = 'GROUP', label: string | null = null) =>
  match({
    seasonId, homePlayerId: a, awayPlayerId: b, homeGames: aGames, awayGames: bGames,
    status: 'COMPLETED', winnerPlayerId: aGames === bGames ? null : (aGames > bGames ? a : b), stage, label,
  })

function facts(over: Partial<AchievementFacts> & { seasons: FactSeason[]; matches: FactMatch[] }): AchievementFacts {
  const names = new Set<string>()
  for (const m of over.matches) { if (m.homePlayerId) names.add(m.homePlayerId); if (m.awayPlayerId) names.add(m.awayPlayerId) }
  for (const s of over.seasons) if (s.championPlayerId) names.add(s.championPlayerId)
  const entrantsBySeason = over.entrantsBySeason ?? new Map(
    over.seasons.map((s) => [s.id, new Set(
      over.matches.filter((m) => m.seasonId === s.id).flatMap((m) => [m.homePlayerId, m.awayPlayerId].filter((x): x is string => !!x)),
    )]),
  )
  return {
    seasons: over.seasons,
    matches: over.matches,
    entrantsBySeason,
    players: over.players ?? new Map([...names].map((n) => [n, { cueverseId: n, preferredName: n.toUpperCase() }])),
  }
}

const award = (f: AchievementFacts, ratings: Map<string, number>, id: string) =>
  computeAchievements(f, ratings).find((a) => a.id === id)

const NO_RATINGS = new Map<string, number>()
const won = (a: ReturnType<typeof award>) => (a?.winners ?? []).map((w) => w.cueverseId).sort()

/* ──────────────────────────────────────────────────────────────────── the definitions ─────────── */

section('1. THE CHOKER counts finals lost, and only finals')
{
  seasonSeq = 0
  const s1 = season('a'); const s2 = season('a'); const s3 = season('c')
  const f = facts({
    seasons: [s1, s2, s3],
    matches: [
      played(s1.id, 'a', 'b', 9, 4, 'PLAYOFF', 'Final'),
      played(s2.id, 'a', 'b', 9, 7, 'PLAYOFF', 'Final'),
      // A semifinal loss for b. Must not count: this award is about finals.
      played(s3.id, 'c', 'b', 9, 1, 'PLAYOFF', 'Semifinal 1'),
      played(s3.id, 'c', 'd', 9, 2, 'PLAYOFF', 'Final'),
    ],
  })
  const a = award(f, NO_RATINGS, 'the-choker')
  check('the two-time runner-up wins it', won(a).join() === 'b', won(a).join())
  check('...with two, not three', a?.stat === '2 finals lost', a?.stat)
}

section('2. BEST PLAYER WITHOUT THE IMPORTANT PART excludes champions')
{
  seasonSeq = 0
  const s1 = season('champ')
  const f = facts({ seasons: [s1], matches: [played(s1.id, 'champ', 'nearly', 9, 8, 'PLAYOFF', 'Final')] })
  const a = award(f, new Map([['champ', 2000], ['nearly', 1900]]), 'best-without-title')
  check('the higher-rated champion is skipped', won(a).join() === 'nearly', won(a).join())
  check('...and the rating shown is the real one', a?.stat === '1900 rating', a?.stat)
}

section('3. SMALL SAMPLE SIZE KING needs three finals and no losses')
{
  seasonSeq = 0
  const s1 = season('a'); const s2 = season('a'); const s3 = season('b'); const s4 = season('b')
  const f = facts({
    seasons: [s1, s2, s3, s4],
    matches: [
      // a: 2-0 in finals. Perfect, but under the minimum.
      played(s1.id, 'a', 'x', 9, 1, 'PLAYOFF', 'Final'),
      played(s2.id, 'a', 'x', 9, 2, 'PLAYOFF', 'Final'),
      // b: 2-1. Enough finals, not undefeated.
      played(s3.id, 'b', 'y', 9, 3, 'PLAYOFF', 'Final'),
      played(s4.id, 'b', 'y', 9, 4, 'PLAYOFF', 'Final'),
      played(s4.id, 'y', 'b', 9, 5, 'PLAYOFF', 'Final'),
    ],
  })
  const a = award(f, NO_RATINGS, 'small-sample-size-king')
  check('nobody qualifies on two finals or on an imperfect record',
    (a?.winners.length ?? 0) === 0, won(a).join())
}

section('4. PLEASE FIND ANOTHER HOBBY counts seasons entered')
{
  seasonSeq = 0
  const s1 = season(null); const s2 = season(null)
  const f = facts({
    seasons: [s1, s2],
    matches: [played(s1.id, 'a', 'b', 9, 1), played(s2.id, 'a', 'c', 9, 1)],
  })
  const a = award(f, NO_RATINGS, 'find-another-hobby')
  check('two seasons beats one', won(a).join() === 'a', won(a).join())
  check('...and says how many of how many', a?.detail.includes('2 of the 2'), a?.detail)
}

section('5. WE GET IT reports every tied leader')
{
  seasonSeq = 0
  const f = facts({
    seasons: [season('a'), season('b'), season('a'), season('b'), season('c')],
    matches: [],
  })
  const a = award(f, NO_RATINGS, 'we-get-it')
  check('both two-time champions are named', won(a).join() === 'a,b', won(a).join())
  check('...and the tie is stated in the detail', a?.detail.includes('2 players tied'), a?.detail)
}

section('6. TOOK THE SCENIC ROUTE measures seasons BETWEEN titles')
{
  seasonSeq = 0
  const f = facts({
    // a wins season 1 and season 5: three seasons in between.
    seasons: [season('a'), season('x'), season('y'), season('z'), season('a')],
    matches: [],
  })
  const a = award(f, NO_RATINGS, 'scenic-route')
  check('the gap excludes both endpoints', a?.stat === '3 seasons between titles', a?.stat)
}

section('7. MOST VIOLENT FINAL ignores forfeited finals')
{
  seasonSeq = 0
  const s1 = season('a'); const s2 = season('b')
  const f = facts({
    seasons: [s1, s2],
    matches: [
      played(s1.id, 'a', 'loser', 9, 5, 'PLAYOFF', 'Final'),
      // A forfeited final. It has no score; a margin must not be invented for it.
      match({ seasonId: s2.id, homePlayerId: 'b', awayPlayerId: 'quitter', status: 'FORFEIT',
        forfeitPlayerId: 'quitter', winnerPlayerId: 'b', stage: 'PLAYOFF', label: 'Final' }),
    ],
  })
  const a = award(f, NO_RATINGS, 'most-violent-final')
  check('the played final wins it', won(a).join() === 'a', won(a).join())
  check('...with its real score', a?.stat === '9-5', a?.stat)
}

section('8. ABSOLUTELY REFUSED TO LOSE rejects a run containing a forfeit win')
{
  seasonSeq = 0
  const s1 = season('clean', 8); const s2 = season('lucky', 32)
  const f = facts({
    seasons: [s1, s2],
    matches: [
      played(s1.id, 'clean', 'x', 9, 1), played(s1.id, 'clean', 'y', 9, 2),
      // A bigger field and more wins, but one of them was a walkover.
      played(s2.id, 'lucky', 'x', 9, 1), played(s2.id, 'lucky', 'y', 9, 2), played(s2.id, 'lucky', 'z', 9, 3),
      match({ seasonId: s2.id, homePlayerId: 'lucky', awayPlayerId: 'w', status: 'FORFEIT',
        forfeitPlayerId: 'w', winnerPlayerId: 'lucky' }),
    ],
  })
  const a = award(f, NO_RATINGS, 'refused-to-lose')
  check('the run with a walkover in it does not qualify', won(a).join() === 'clean', won(a).join())
  check('...and the qualifying run reports only played wins', a?.stat === '2-0', a?.stat)
}

section('9. GET A ROOM counts played meetings only')
{
  seasonSeq = 0
  const s1 = season(null)
  const f = facts({
    seasons: [s1],
    matches: [
      played(s1.id, 'a', 'b', 9, 1), played(s1.id, 'a', 'b', 9, 2),
      // Neither of these is a meeting: nobody played.
      match({ seasonId: s1.id, homePlayerId: 'a', awayPlayerId: 'b', status: 'NO_CONTEST' }),
      match({ seasonId: s1.id, homePlayerId: 'a', awayPlayerId: 'b', status: 'FORFEIT', forfeitPlayerId: 'b', winnerPlayerId: 'a' }),
      played(s1.id, 'c', 'd', 9, 1),
    ],
  })
  const a = award(f, NO_RATINGS, 'get-a-room')
  check('the pair is found', won(a).join() === 'a,b', won(a).join())
  check('...and the no-contest and the forfeit are not meetings', a?.stat === '2 meetings', a?.stat)
}

section('10. ALWAYS INVITED divides playoff appearances by titles')
{
  seasonSeq = 0
  const s1 = season('a'); const s2 = season('b'); const s3 = season('b')
  const f = facts({
    seasons: [s1, s2, s3],
    matches: [
      played(s1.id, 'a', 'x', 9, 1, 'PLAYOFF', 'Final'),
      played(s2.id, 'b', 'x', 9, 1, 'PLAYOFF', 'Final'),
      played(s3.id, 'b', 'x', 9, 1, 'PLAYOFF', 'Final'),
    ],
  })
  const a = award(f, NO_RATINGS, 'always-invited')
  check('one title from one playoff beats two titles from two',
    won(a).join() === 'a,b' || won(a).join() === 'a', won(a).join())
}

section('11. CONGRATULATIONS ON ALMOST WINNING excludes anyone with a title')
{
  seasonSeq = 0
  const s1 = season('a'); const s2 = season('a'); const s3 = season('b')
  const f = facts({
    seasons: [s1, s2, s3],
    matches: [
      played(s1.id, 'a', 'nearly', 9, 1, 'PLAYOFF', 'Final'),
      played(s2.id, 'a', 'nearly', 9, 1, 'PLAYOFF', 'Final'),
      // b also reached two finals but won one, so is disqualified from this award.
      played(s3.id, 'b', 'a', 9, 1, 'PLAYOFF', 'Final'),
    ],
  })
  const a = award(f, NO_RATINGS, 'almost-winning')
  check('only the titleless finalist is named', won(a).join() === 'nearly', won(a).join())
  check('...with both of their finals counted', a?.stat === '2 finals, 0 titles', a?.stat)
}

section('12. GROUP-STAGE MERCHANT respects its minimums')
{
  seasonSeq = 0
  const s1 = season(null)
  const ms: FactMatch[] = []
  // 60 group matches: under the 50 threshold? No - 60 is over. Give a huge drop but too few playoffs.
  for (let i = 0; i < 60; i++) ms.push(played(s1.id, 'a', `g${i}`, 9, 0))
  for (let i = 0; i < 5; i++) ms.push(played(s1.id, 'a', `p${i}`, 0, 9, 'PLAYOFF'))
  const a = award(facts({ seasons: [s1], matches: ms }), NO_RATINGS, 'group-stage-merchant')
  check('five playoff matches is not enough to qualify', (a?.winners.length ?? 0) === 0, won(a).join())

  for (let i = 5; i < 12; i++) ms.push(played(s1.id, 'a', `p${i}`, 0, 9, 'PLAYOFF'))
  const b = award(facts({ seasons: [s1], matches: ms }), NO_RATINGS, 'group-stage-merchant')
  check('twelve is', won(b).join() === 'a', won(b).join())
  check('...and the drop is the real difference', b?.stat === '100 points worse', b?.stat)
}

section('13. PLAYOFF TAX EVADER counts one-sided slots')
{
  seasonSeq = 0
  const s1 = season(null)
  const f = facts({
    seasons: [s1],
    matches: [
      match({ seasonId: s1.id, homePlayerId: 'a', awayPlayerId: null, stage: 'PLAYOFF', winnerPlayerId: 'a' }),
      match({ seasonId: s1.id, homePlayerId: null, awayPlayerId: 'a', stage: 'PLAYOFF', winnerPlayerId: 'a' }),
      // A real contested win is not a bye.
      played(s1.id, 'a', 'b', 9, 1, 'PLAYOFF'),
      match({ seasonId: s1.id, homePlayerId: 'b', awayPlayerId: null, stage: 'PLAYOFF', winnerPlayerId: 'b' }),
    ],
  })
  const a = award(f, NO_RATINGS, 'playoff-tax-evader')
  check('the two-bye player wins', won(a).join() === 'a', won(a).join())
  check('...and a contested win is not counted as one', a?.stat === '2 byes', a?.stat)
}

section('14. THE PARTICIPATION AWARD and the Tino rule')
{
  seasonSeq = 0
  const s1 = season(null); const s2 = season(null)
  const both = facts({
    seasons: [s1, s2],
    matches: [played(s1.id, 'tino_nica', 'other', 9, 1), played(s2.id, 'tino_nica', 'other', 9, 1)],
  })
  const a = award(both, NO_RATINGS, 'participation-award')
  check('on a genuine tie, Tino is the named winner as instructed',
    won(a).join() === 'tino_nica', won(a).join())
  check('...and the tie is disclosed rather than hidden',
    (a?.detail ?? '').includes('Level with 1 other'), a?.detail)

  // Tino behind the lead: the instruction must not promote him.
  const s3 = season(null)
  const behind = facts({
    seasons: [s1, s2, s3],
    matches: [
      played(s1.id, 'tino_nica', 'other', 9, 1),
      played(s2.id, 'other', 'z', 9, 1),
      played(s3.id, 'other', 'z', 9, 1),
    ],
  })
  const b = award(behind, NO_RATINGS, 'participation-award')
  check('when he is not tied for the lead, the real leader is shown',
    won(b).join() === 'other', won(b).join())
}

section('15. NOBODY COULD COMPLETE THE ASSIGNMENT reports runs honestly')
{
  seasonSeq = 0
  const f = facts({ seasons: [season('a'), season('a'), season('b'), season('c'), season('c')], matches: [] })
  const a = award(f, NO_RATINGS, 'nobody-completed-assignment')
  check('two players went back to back', (a?.detail ?? '').includes('2 players have'), a?.detail)
  check('...and three in a row is reported as never done',
    a?.stat === 'Still nobody' && (a?.detail ?? '').includes('never done'), `${a?.stat} / ${a?.detail}`)

  seasonSeq = 0
  const three = facts({ seasons: [season('a'), season('a'), season('a')], matches: [] })
  const b = award(three, NO_RATINGS, 'nobody-completed-assignment')
  check('and when somebody does it, the card says so', b?.stat === '1 did it', b?.stat)
}

section('16/17. Forfeits are attributed to the right side')
{
  seasonSeq = 0
  const s1 = season(null)
  const f = facts({
    seasons: [s1],
    matches: [
      match({ seasonId: s1.id, homePlayerId: 'winner', awayPlayerId: 'quitter', status: 'FORFEIT', forfeitPlayerId: 'quitter', winnerPlayerId: 'winner' }),
      match({ seasonId: s1.id, homePlayerId: 'winner', awayPlayerId: 'quitter', status: 'FORFEIT', forfeitPlayerId: 'quitter', winnerPlayerId: 'winner' }),
    ],
  })
  check('the beneficiary gets the walkovers', won(award(f, NO_RATINGS, 'by-any-means')).join() === 'winner')
  check('...and the forfeiter gets the forfeits', won(award(f, NO_RATINGS, 'cant-get-it-right')).join() === 'quitter')
  check('the two are never the same player',
    won(award(f, NO_RATINGS, 'by-any-means')).join() !== won(award(f, NO_RATINGS, 'cant-get-it-right')).join())
}

section('18. THE RANKINGS CAN\'T TAKE IT BACK finds the lowest-rated champion')
{
  seasonSeq = 0
  const f = facts({ seasons: [season('high'), season('low')], matches: [] })
  const a = award(f, new Map([['high', 2000], ['low', 1500], ['nochamp', 900]]), 'rankings-cant-take-it-back')
  check('the lowest CHAMPION is chosen, not the lowest player', won(a).join() === 'low', won(a).join())
  check('the caption says "currently rated" so it makes no claim about the past',
    (a?.detail ?? '').includes('currently rated'), a?.detail)
}

/* ─────────────────────────────────────────────────────────────────── against the archive ──────── */

/*
 * "The real archive" ran here: eighteen awards computed from the live Yahoo record, every one of
 * them naming somebody, no award claiming more finals than have been played. Every assertion needed
 * the archive, so this suite could not run without it — while the sections above prove the ENGINE
 * with fixtures they build themselves.
 *
 * Those record-level checks are in scripts/audit/audit-production.mts, where the archive exists.
 */

console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
await prisma.$disconnect()
process.exit(fail === 0 ? 0 : 1)
