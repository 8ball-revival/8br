/**
 * One definition of "what is this player's rating", and the boundaries it has to get right.
 *
 * ── The bug this closes ──────────────────────────────────────────────────────────────────────────
 * Two readers computed the Current ladder from the same ledger and disagreed by one point for three
 * players. There were two causes stacked on top of each other, and neither was visible from the
 * symptom:
 *
 *   1. The ledger writer carries a FRACTIONAL running rating and rounds only when it stores a row.
 *      `getLadder` replayed the window with an INTEGER running rating, rounding each delta before
 *      adding it. Over a few hundred matches those diverge.
 *   2. Worse, they were answering different questions. The Rankings table read the STORED running
 *      rating — the all-time figure — and labelled it Current, while `getLadder` replayed the last
 *      365 days from 1500. Most matches fall inside the window, so the answers stayed close enough
 *      that the difference surfaced as an occasional single point.
 *
 * The fix is not a reconciliation. There is now one replay, in `rating-history`, and both readers
 * call it — so they cannot disagree, because there is only one of them.
 *
 * ── Why these fixtures ───────────────────────────────────────────────────────────────────────────
 * Every case here is one the symptom could have hidden: the window boundary, identical timestamps,
 * a rounding-sensitive sequence, and the results that must move nothing at all.
 *
 * Pure functions over synthetic rows — no database writes, nothing to clean up.
 *
 * Run: npx tsx --tsconfig scripts/tsconfig.verify.json --env-file=.env scripts/verify-rating-history.mts
 */
import {
  replayRatings, storedRatings, ratingsForScope, windowCutoff, inWindow,
  WINDOW_DAYS, TEAM_DELTA, type RatingRow,
} from '../src/lib/stats/rating-history.ts'
import { ELO_START } from '../src/lib/stats/elo.ts'

let pass = 0
let fail = 0
const check = (label: string, ok: boolean, detail?: string) => {
  if (ok) { pass++; console.log(`  ✓ ${label}`) }
  else { fail++; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`) }
}
const section = (t: string) => console.log(`\n--- ${t} ---`)

let seq = 0
/** One side of one match. Two of these with the same matchKey make a result. */
const row = (o: Partial<RatingRow> & { playerId: string; matchKey: string; actual: number }): RatingRow => ({
  playerName: o.playerId,
  sequence: o.sequence ?? ++seq,
  tournamentId: o.tournamentId ?? 1,
  completedAt: o.completedAt ?? new Date('2026-06-01T00:00:00Z'),
  result: o.actual === 1 ? 'WIN' : 'LOSS',
  isForfeit: o.isForfeit ?? false,
  isTeamMatch: o.isTeamMatch ?? false,
  teamName: o.teamName ?? null,
  ratingChange: o.ratingChange ?? 0,
  postRating: o.postRating ?? ELO_START,
  ...o,
})

/** A played match between two individuals, both rows sharing one sequence-ordered key. */
const match = (key: string, winner: string, loser: string, extra: Partial<RatingRow> = {}): RatingRow[] => {
  const s = ++seq
  return [
    row({ playerId: winner, matchKey: key, actual: 1, sequence: s, ...extra }),
    row({ playerId: loser, matchKey: key, actual: 0, sequence: s, ...extra }),
  ]
}

const NOW = new Date('2026-08-21T12:00:00Z')

try {
  section('The window boundary is inclusive, and compared as an instant')
  const cutoff = windowCutoff(NOW)
  check('the cutoff is exactly 365 days back',
    NOW.getTime() - cutoff.getTime() === WINDOW_DAYS * 86_400_000)
  check('a match exactly on the boundary is INSIDE the window', inWindow(cutoff, cutoff))
  check('one millisecond earlier is outside', !inWindow(new Date(cutoff.getTime() - 1), cutoff))
  check('one millisecond later is inside', inWindow(new Date(cutoff.getTime() + 1), cutoff))
  check('a future match is inside', inWindow(NOW, cutoff))

  const onBoundary = [...match('m-boundary', 'A', 'B', { completedAt: cutoff })]
  const justBefore = [...match('m-before', 'C', 'D', { completedAt: new Date(cutoff.getTime() - 1) })]
  const scoped = ratingsForScope([...onBoundary, ...justBefore], 'current', cutoff)
  check('the boundary match counts towards the Current rating', (scoped.get('A')?.rating ?? 0) > ELO_START)
  check('...and the one a millisecond earlier does not', scoped.get('C') === undefined)

  section('Identical timestamps do not make the replay ambiguous')
  const sameInstant = new Date('2026-06-01T00:00:00Z')
  seq = 100
  const a = match('same-1', 'P', 'Q', { completedAt: sameInstant })
  const b = match('same-2', 'P', 'R', { completedAt: sameInstant })
  const c = match('same-3', 'P', 'S', { completedAt: sameInstant })
  const once = replayRatings([...a, ...b, ...c])
  // Shuffled input, identical sequences: the replay sorts by sequence, so the answer cannot move.
  const shuffled = replayRatings([...c, ...a, ...b])
  check('three wins at the same instant produce a rating', (once.get('P')?.rating ?? 0) > ELO_START)
  check('...and input order does not change it',
    once.get('P')?.rating === shuffled.get('P')?.rating,
    `${once.get('P')?.rating} vs ${shuffled.get('P')?.rating}`)
  check('...for every player involved',
    ['P', 'Q', 'R', 'S'].every((id) => once.get(id)?.rating === shuffled.get(id)?.rating))

  section('The running rating is carried unrounded — the actual cause')
  /*
   * A long chain of wins against a fixed opponent. Each Elo delta has a fraction; rounding it every
   * step accumulates a different total from carrying it and rounding once. This is exactly what put
   * the ladder a point away from the table.
   */
  seq = 200
  const chain: RatingRow[] = []
  for (let i = 0; i < 40; i++) chain.push(...match(`chain-${i}`, 'X', `Y${i}`))
  const carried = replayRatings(chain).get('X')!.rating

  // The old behaviour, reproduced: round each delta before applying it.
  let naive = ELO_START
  for (let i = 0; i < 40; i++) {
    const expected = 1 / (1 + Math.pow(10, (ELO_START - naive) / 400))
    naive += Math.round(32 * (1 - expected))
  }
  check('forty wins produce a rating', carried > ELO_START, String(carried))
  check('...and rounding every step gives a DIFFERENT answer',
    Math.round(naive) !== carried, `naive ${Math.round(naive)} vs canonical ${carried}`)
  check('...the canonical one rounds exactly once, at the end', Number.isInteger(carried))

  section('Results that must move nothing')
  seq = 300
  const ff = match('ff-1', 'F1', 'F2', { isForfeit: true })
  const ffRatings = replayRatings(ff)
  check('a forfeit moves neither player',
    ffRatings.get('F1')?.rating === ELO_START && ffRatings.get('F2')?.rating === ELO_START,
    `${ffRatings.get('F1')?.rating} / ${ffRatings.get('F2')?.rating}`)

  // A bye and a no-contest never reach the ledger at all: there is no row to replay.
  const noRows = replayRatings([])
  check('an empty ledger produces no ratings', noRows.size === 0)
  const oneSided = replayRatings([row({ playerId: 'Lonely', matchKey: 'half', actual: 1 })])
  check('a match with only one side is skipped rather than half-applied', oneSided.size === 0)

  section('A team result is a flat step for everybody on the roster')
  seq = 400
  const s = ++seq
  const teamMatch: RatingRow[] = [
    row({ playerId: 'T1', matchKey: 'team-1', actual: 1, sequence: s, isTeamMatch: true, teamName: 'Alpha' }),
    row({ playerId: 'T2', matchKey: 'team-1', actual: 1, sequence: s, isTeamMatch: true, teamName: 'Alpha' }),
    row({ playerId: 'T3', matchKey: 'team-1', actual: 0, sequence: s, isTeamMatch: true, teamName: 'Beta' }),
    row({ playerId: 'T4', matchKey: 'team-1', actual: 0, sequence: s, isTeamMatch: true, teamName: 'Beta' }),
  ]
  const teamRatings = replayRatings(teamMatch)
  check(`every winner gains exactly ${TEAM_DELTA}`,
    teamRatings.get('T1')?.rating === ELO_START + TEAM_DELTA
    && teamRatings.get('T2')?.rating === ELO_START + TEAM_DELTA,
    `${teamRatings.get('T1')?.rating} / ${teamRatings.get('T2')?.rating}`)
  check(`every loser loses exactly ${TEAM_DELTA}`,
    teamRatings.get('T3')?.rating === ELO_START - TEAM_DELTA
    && teamRatings.get('T4')?.rating === ELO_START - TEAM_DELTA)
  check('...the same amount regardless of roster size',
    teamRatings.get('T1')?.rating === teamRatings.get('T2')?.rating)

  seq = 500
  const sf = ++seq
  const teamFf: RatingRow[] = [
    row({ playerId: 'U1', matchKey: 'team-ff', actual: 1, sequence: sf, isTeamMatch: true, teamName: 'A', isForfeit: true }),
    row({ playerId: 'U2', matchKey: 'team-ff', actual: 0, sequence: sf, isTeamMatch: true, teamName: 'B', isForfeit: true }),
  ]
  const teamFfRatings = replayRatings(teamFf)
  check('a forfeited team match moves nobody',
    teamFfRatings.get('U1')?.rating === ELO_START && teamFfRatings.get('U2')?.rating === ELO_START)

  section('All-Time reads what the ledger stored')
  seq = 600
  const stored: RatingRow[] = [
    row({ playerId: 'Z', matchKey: 'z1', actual: 1, postRating: 1516, sequence: 601 }),
    row({ playerId: 'Z', matchKey: 'z2', actual: 0, postRating: 1502, sequence: 602 }),
    row({ playerId: 'Z', matchKey: 'z3', actual: 1, postRating: 1519, sequence: 603 }),
  ]
  const all = storedRatings(stored)
  check('the rating is the last row, in sequence order', all.get('Z')?.rating === 1519)
  check('the peak is the highest row ever reached', all.get('Z')?.highestRating === 1519)
  const dipped = storedRatings([
    row({ playerId: 'W', matchKey: 'w1', actual: 1, postRating: 1560, sequence: 701 }),
    row({ playerId: 'W', matchKey: 'w2', actual: 0, postRating: 1540, sequence: 702 }),
  ])
  check('...even when the player has since fallen back', dipped.get('W')?.highestRating === 1560)
  check('...and the current rating reflects the fall', dipped.get('W')?.rating === 1540)
  const floored = storedRatings([row({ playerId: 'V', matchKey: 'v1', actual: 0, postRating: 1484, sequence: 801 })])
  check('the peak never reads below the starting rating', floored.get('V')?.highestRating === ELO_START)

  section('The two scopes are told apart by one function')
  seq = 900
  const inside = match('scope-in', 'S1', 'S2', { completedAt: new Date(NOW.getTime() - 10 * 86_400_000) })
  const outside = match('scope-out', 'S3', 'S4', {
    completedAt: new Date(NOW.getTime() - 400 * 86_400_000), postRating: 1600,
  })
  const rows = [...outside, ...inside]
  const cur = ratingsForScope(rows, 'current', windowCutoff(NOW))
  const allTime = ratingsForScope(rows, 'all-time', windowCutoff(NOW))
  check('Current sees only the recent match', cur.has('S1') && !cur.has('S3'))
  check('All-Time sees both', allTime.has('S1') && allTime.has('S3'))
  check('...and All-Time reads the stored figure for the old one', allTime.get('S3')?.rating === 1600)

  section('The replay is deterministic')
  seq = 1000
  const det: RatingRow[] = []
  for (let i = 0; i < 25; i++) det.push(...match(`det-${i}`, i % 2 === 0 ? 'D1' : 'D2', i % 2 === 0 ? 'D2' : 'D1'))
  const first = replayRatings(det)
  const second = replayRatings(det)
  check('two runs over the same rows agree exactly',
    first.get('D1')?.rating === second.get('D1')?.rating
    && first.get('D2')?.rating === second.get('D2')?.rating)
  check('...and the pair’s ratings still sum to twice the start',
    (first.get('D1')!.rating + first.get('D2')!.rating) === ELO_START * 2,
    `${first.get('D1')!.rating} + ${first.get('D2')!.rating}`)
} finally {
  console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
}

if (fail > 0) process.exitCode = 1
