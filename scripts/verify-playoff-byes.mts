/**
 * Bye propagation in a double-elimination bracket — the rule, tested directly.
 *
 * ── The bug this locks down ──────────────────────────────────────────────────────────────────────
 * "This position is empty for good" used to be decided by asking whether anything FED the position.
 * In a winners bracket that works: an empty position nothing feeds is a first-round bye. In a LOSERS
 * bracket every position is fed by some winners tie, so the answer was always "not a bye" — including
 * for a position fed by a tie that was ITSELF a bye and therefore had no loser to send.
 *
 * A live Season died of it: 20 players in a bracket of 32, twelve winners byes, every winners tie
 * played, and losers round one holding four ties waiting on an opponent that did not exist and four
 * holding nobody at all. Nothing could advance and nothing said why.
 *
 * ── What is tested here ──────────────────────────────────────────────────────────────────────────
 * `analyseByes` — the predicate itself — against brackets built by the REAL planner, with no database
 * involved. The end-to-end proof that the engine acts on it correctly is scripts/repro-season-de-byes,
 * which plays a disposable Season out through the Creator's own functions.
 *
 * Run:  npx tsx --tsconfig scripts/tsconfig.verify.json scripts/verify-playoff-byes.mts
 */
import { planDoubleElim } from '../src/lib/competition/bracket-de.ts'
import type { Qualifier } from '../src/lib/competition/bracket.ts'
import { analyseByes, type ByeMatch } from '../src/lib/seasons/playoffs.ts'

let pass = 0
let fail = 0
const check = (label: string, ok: boolean, detail?: string) => {
  if (ok) { pass++; console.log(`  ✓ ${label}`) }
  else { fail++; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`) }
}
const section = (t: string) => console.log(`\n--- ${t} ---`)

interface Row extends ByeMatch {
  section: string
  round: number
  slot: number
}

/**
 * A bracket exactly as `generateSeasonBracket` persists one: the real planner's topology, with ONLY
 * winners round one seated. Everything downstream starts empty, which is what makes a draft editable
 * and what the settlement rule then has to reason about.
 */
function build(realPlayers: number, size: number): Row[] {
  const qualifiers: Qualifier[] = []
  for (let i = 1; i <= realPlayers; i++) qualifiers.push({ registrationId: i, username: `P${i}`, seed: i })
  for (let i = realPlayers; i < size; i++) {
    qualifiers.push({ registrationId: null as unknown as number, username: null as unknown as string, seed: i + 1 })
  }
  return planDoubleElim(qualifiers).matches.map((m) => {
    const wbFirst = m.section === 'WB' && m.round === 1
    return {
      id: m.index + 1,
      section: m.section, round: m.round, slot: m.slot,
      homeEntrantId: wbFirst ? m.home.registrationId : null,
      awayEntrantId: wbFirst ? m.away.registrationId : null,
      winnerEntrantId: null,
      feedsMatchId: m.feedsIndex != null ? m.feedsIndex + 1 : null,
      feedsSlot: m.feedsSlot,
      loserFeedsMatchId: m.loserFeedsIndex != null ? m.loserFeedsIndex + 1 : null,
      loserFeedsSlot: m.loserFeedsSlot,
    }
  })
}

const byId = (rows: Row[]) => new Map(rows.map((r) => [r.id, r]))
const put = (rows: Row[], matchId: number | null, slot: number | null, who: number) => {
  if (matchId == null) return
  const t = byId(rows).get(matchId)!
  if ((slot ?? 0) === 0) t.homeEntrantId = who
  else t.awayEntrantId = who
}

/**
 * Award every walkover the predicate allows, repeatedly — the same loop the engine runs, in ten
 * lines, so a state can be reached without a database. The ASSERTIONS below are about `analyseByes`;
 * this only carries the bracket from one state to the next.
 */
function settle(rows: Row[]): number {
  let awarded = 0
  for (let guard = 0; guard < rows.length + 2; guard++) {
    const view = analyseByes(rows)
    let changed = false
    for (const m of rows) {
      if (m.winnerEntrantId != null || m.feedsMatchId == null) continue
      const homeReal = m.homeEntrantId != null
      const awayReal = m.awayEntrantId != null
      const homeBye = !homeReal && view.permanentlyEmpty(m.id, 0)
      const awayBye = !awayReal && view.permanentlyEmpty(m.id, 1)
      if (!((homeReal && awayBye) || (awayReal && homeBye))) continue
      m.winnerEntrantId = (m.homeEntrantId ?? m.awayEntrantId)!
      put(rows, m.feedsMatchId, m.feedsSlot, m.winnerEntrantId)
      changed = true
      awarded++
    }
    if (!changed) break
  }
  return awarded
}

/** Decide a tie the ordinary way: home wins, and the loser drops if there is somewhere to drop to. */
function play(rows: Row[], m: Row) {
  m.winnerEntrantId = m.homeEntrantId!
  put(rows, m.feedsMatchId, m.feedsSlot, m.homeEntrantId!)
  put(rows, m.loserFeedsMatchId, m.loserFeedsSlot, m.awayEntrantId!)
}

/** How the rule USED to read: a position is a bye only if nothing feeds it at all. */
function oldRuleByeCount(rows: Row[], sectionName: string): number {
  const fed = new Set<string>()
  for (const m of rows) {
    if (m.feedsMatchId != null) fed.add(`${m.feedsMatchId}:${m.feedsSlot ?? 0}`)
    if (m.loserFeedsMatchId != null) fed.add(`${m.loserFeedsMatchId}:${m.loserFeedsSlot ?? 0}`)
  }
  let n = 0
  for (const m of rows.filter((r) => r.section === sectionName)) {
    if (m.homeEntrantId == null && !fed.has(`${m.id}:0`)) n++
    if (m.awayEntrantId == null && !fed.has(`${m.id}:1`)) n++
  }
  return n
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────

section('The live shape: 20 players in a bracket of 32')
const rows = build(20, 32)
{
  const wb1 = rows.filter((r) => r.section === 'WB' && r.round === 1)
  check('winners round one holds 16 ties', wb1.length === 16, `${wb1.length}`)
  check('...12 of them byes', wb1.filter((m) => m.homeEntrantId == null || m.awayEntrantId == null).length === 12)
  check('losers round one holds 8 ties', rows.filter((r) => r.section === 'LB' && r.round === 1).length === 8)
}

section('Why it stalled: the old rule could not see a losers bye')
{
  check('the old rule finds no bye anywhere in the losers bracket', oldRuleByeCount(rows, 'LB') === 0,
    `${oldRuleByeCount(rows, 'LB')}`)
  check('...while finding them correctly in the winners bracket', oldRuleByeCount(rows, 'WB') === 12,
    `${oldRuleByeCount(rows, 'WB')}`)
}

section('At the start: byes settle, unplayed feeders do not')
{
  const awarded = settle(rows)
  check('the 12 winners byes are awarded', awarded === 12, `${awarded}`)

  const view = analyseByes(rows)
  const lb1 = rows.filter((r) => r.section === 'LB' && r.round === 1)
  const empty = lb1.flatMap((m) => [
    view.permanentlyEmpty(m.id, 0) ? 1 : 0,
    view.permanentlyEmpty(m.id, 1) ? 1 : 0,
  ]).reduce((a: number, b: number) => a + b, 0)
  check('12 of the 16 losers round-one positions are recognised as permanently empty', empty === 12, `${empty}`)

  /*
   * The load-bearing half of the rule. The other four are fed by winners ties that have not been
   * played, and settling them would eliminate a player who has not lost anything yet.
   */
  const undecidedFeeders = rows.filter((m) => m.section === 'WB' && m.round === 1 && m.winnerEntrantId == null)
  check('the four unplayed winners ties are still unplayed', undecidedFeeders.length === 4, `${undecidedFeeders.length}`)
  check('...and the positions they feed are NOT treated as byes',
    undecidedFeeders.every((m) => !analyseByes(rows).permanentlyEmpty(m.loserFeedsMatchId!, (m.loserFeedsSlot ?? 0) as 0 | 1)))
  check('...so no walkover was awarded in losers round one yet',
    lb1.every((m) => m.winnerEntrantId == null))
}

section('The winners ties are played: their losers drop, and the walkovers follow')
{
  for (const m of rows.filter((r) => r.section === 'WB' && r.round === 1 && r.winnerEntrantId == null)) play(rows, m)
  const awarded = settle(rows)
  const lb1 = rows.filter((r) => r.section === 'LB' && r.round === 1)
  const decided = lb1.filter((m) => m.winnerEntrantId != null)
  check('the four half-filled losers ties become walkovers', decided.length === 4, `${decided.length}`)
  check('...awarded to the player already sitting in them',
    decided.every((m) => m.winnerEntrantId === (m.homeEntrantId ?? m.awayEntrantId)))
  /*
   * Four, and no more. Each losers round-two position pairs a walkover winner with a loser from
   * winners round two, which has not been played — so the cascade correctly stops here rather than
   * running ahead of the bracket. Propagation past a dead tie is asserted separately below.
   */
  check('...and nothing beyond them was awarded, because the next round is genuinely waiting',
    awarded === 4, `${awarded} awarded`)

  const lb2 = rows.filter((r) => r.section === 'LB' && r.round === 2)
  const seated = new Set(lb2.flatMap((m) => [m.homeEntrantId, m.awayEntrantId]).filter((x) => x != null))
  check('every walkover winner advanced into losers round two',
    decided.every((m) => seated.has(m.winnerEntrantId)))
  check('...and nobody who did not win one is there',
    [...seated].every((id) => decided.some((m) => m.winnerEntrantId === id)))
}

section('A dead tie carries forward: nothing downstream waits on it either')
{
  const view = analyseByes(rows)
  const dead = rows.filter((m) => m.winnerEntrantId == null && m.homeEntrantId == null && m.awayEntrantId == null
    && view.permanentlyEmpty(m.id, 0) && view.permanentlyEmpty(m.id, 1))
  check('the ties the field never reached are identified', dead.length > 0, `${dead.length}`)
  check('...and the position each of them FEEDS is permanently empty too',
    dead.every((m) => m.feedsMatchId == null
      || view.permanentlyEmpty(m.feedsMatchId, (m.feedsSlot ?? 0) as 0 | 1)),
    'a dead tie whose downstream position still reads as pending would stall the next round')
}

section('A forfeit is a loss, not a bye')
{
  /*
   * The report that surfaced this said two players forfeited and the bracket "auto-forfeits" their
   * losers-bracket opponent. It must not: both sides of a forfeited tie were real people, so there is
   * a real loser to drop, and the position they drop into is not empty for good.
   */
  const fresh = build(20, 32)
  settle(fresh)
  const real = fresh.find((m) => m.section === 'WB' && m.round === 1 && m.winnerEntrantId == null)!
  const target = real.loserFeedsMatchId!
  const slot = (real.loserFeedsSlot ?? 0) as 0 | 1

  check('before the tie is decided, the position it feeds is waiting, not a bye',
    !analyseByes(fresh).permanentlyEmpty(target, slot))

  // A forfeit: both entrants real, a winner recorded, no games. The loser is the forfeiter.
  real.winnerEntrantId = real.homeEntrantId
  put(fresh, real.loserFeedsMatchId, real.loserFeedsSlot, real.awayEntrantId!)
  check('after a forfeit, the position holds the forfeiting player',
    (slot === 0 ? byId(fresh).get(target)!.homeEntrantId : byId(fresh).get(target)!.awayEntrantId) === real.awayEntrantId)
  check('...and is not permanently empty, because a real player is in it',
    !analyseByes(fresh).permanentlyEmpty(target, slot))
  check('...so the forfeiter is not eliminated by settlement',
    byId(fresh).get(target)!.winnerEntrantId == null
    || byId(fresh).get(target)!.winnerEntrantId === real.awayEntrantId)
}

section('A full field has no byes at all')
{
  const full = build(32, 32)
  const view = analyseByes(full)
  const anywhere = full.flatMap((m) => [
    view.permanentlyEmpty(m.id, 0) && m.homeEntrantId == null ? `${m.id}:0` : null,
    view.permanentlyEmpty(m.id, 1) && m.awayEntrantId == null ? `${m.id}:1` : null,
  ]).filter(Boolean)
  check('no position in a full bracket of 32 is permanently empty', anywhere.length === 0, anywhere.join(', '))
  check('...and settlement awards nothing', settle(full) === 0)
}

section('Idempotent, and safe on a malformed bracket')
{
  const a = build(20, 32)
  settle(a)
  const first = analyseByes(a)
  const firstVerdicts = a.flatMap((m) => [first.permanentlyEmpty(m.id, 0), first.permanentlyEmpty(m.id, 1)])
  const second = analyseByes(a)
  const secondVerdicts = a.flatMap((m) => [second.permanentlyEmpty(m.id, 0), second.permanentlyEmpty(m.id, 1)])
  check('the same bracket gives the same answers every time',
    firstVerdicts.every((v, i) => v === secondVerdicts[i]))
  check('...and settling an already-settled bracket awards nothing', settle(a) === 0)

  /*
   * A bracket is a DAG, so a cycle means the data is wrong. The safe answer to a question that cannot
   * be answered is "not a bye": the bracket waits for a person rather than awarding a walkover past a
   * tie whose status could not be established.
   */
  const cyclic: Row[] = [
    { id: 1, section: 'LB', round: 1, slot: 0, homeEntrantId: null, awayEntrantId: null, winnerEntrantId: null, feedsMatchId: 2, feedsSlot: 0, loserFeedsMatchId: null, loserFeedsSlot: null },
    { id: 2, section: 'LB', round: 2, slot: 0, homeEntrantId: null, awayEntrantId: null, winnerEntrantId: null, feedsMatchId: 1, feedsSlot: 0, loserFeedsMatchId: null, loserFeedsSlot: null },
  ]
  let threw: string | null = null
  let verdict: boolean | null = null
  try { verdict = analyseByes(cyclic).permanentlyEmpty(1, 0) } catch (e) { threw = String(e) }
  check('a cyclic bracket does not hang or throw', threw === null, threw ?? '')
  check('...and is answered "not a bye", so nothing is awarded past it', verdict === false, String(verdict))
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
