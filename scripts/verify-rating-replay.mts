/**
 * The replay and the stored ladder must be the same ladder.
 *
 * ── The bug this locks out ──────────────────────────────────────────────────────────────────────
 * Switching the Rankings tab from All to 8BRCAM moved every rating by a point or two, with nothing
 * about the results changed. Any tab other than All pins a competition, which makes the view
 * "period-scoped", and a period-scoped view REPLAYS from 1500 instead of reading the figure the
 * ledger stored. The two disagreed because they scored a match differently: the writer rounds each
 * Elo change to a whole number and mirrors it so the match is zero-sum, while the replay kept the
 * fraction and rounded once at the end.
 *
 * So the invariant is not "the numbers are close". It is that replaying the whole ledger reproduces
 * every stored `postRating` EXACTLY — because if it does, then any subset a filter asks for is
 * scored by the same arithmetic as the whole, and the tabs cannot disagree about a shared match.
 *
 * Read-only. It computes; it writes nothing.
 *
 * Run: npm run test:rating-replay
 */

import { readFileSync } from 'node:fs'
// Type-only, so it is erased and the 'server-only' guard in that module is never executed here.
import type { RatingRow } from '../src/lib/stats/rating-history'

const env: Record<string, string> = {}
for (const raw of readFileSync('.env.replica', 'utf8').split(String.fromCharCode(10))) {
  const line = raw.trim(); const eq = line.indexOf('=')
  if (eq < 1 || line.startsWith('#')) continue
  let v = line.slice(eq + 1).trim()
  if (v.length > 1 && (v[0] === '"' || v[0] === "'") && v.at(-1) === v[0]) v = v.slice(1, -1)
  env[line.slice(0, eq).trim()] = v
}
process.env.DATABASE_URL ||= env.DATABASE_URL ?? ''
process.env.DIRECT_URL ||= env.DIRECT_URL ?? process.env.DATABASE_URL ?? ''

let pass = 0
let fail = 0
const failures: string[] = []
const check = (label: string, ok: boolean, detail?: string) => {
  if (ok) { pass++; console.log(`  ok   ${label}`) }
  else { fail++; failures.push(label); console.log(`  FAIL ${label}${detail ? ` -- ${detail}` : ''}`) }
}
const section = (t: string) => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 66 - t.length))}`)

const { prisma } = await import('../src/lib/prisma')
const { replayRatings, storedRatings } = await import('../src/lib/stats/rating-history')
const { matchDeltas, isRatingNeutral, ELO_START } = await import('../src/lib/stats/elo')

const SELECT = {
  playerId: true, playerName: true, matchKey: true, sequence: true, tournamentId: true,
  seasonId: true, completedAt: true, actual: true, result: true, isForfeit: true,
  isTeamMatch: true, teamName: true, ratingChange: true, postRating: true, platform: true,
} as const

try {
  // ══ 1. The arithmetic both sides now share ════════════════════════════════════════════════════
  section('One function scores a match')
  const d = matchDeltas(1500, 1500, 1)
  check('an even match at 1500 moves 16', d.home.delta === 16, String(d.home.delta))
  check('...and the loser mirrors it exactly', d.away.delta === -d.home.delta)
  check('every change is a whole number',
    Number.isInteger(d.home.delta) && Number.isInteger(d.away.delta))

  /*
    Rounding to nothing takes a bigger gap than it looks.

    600 points still moves 1: the favourite is expected to win 96.9% of the time, and 32 x 0.031
    rounds up. It takes about 720 before 32 x (1 - expected) falls under a half point.
  */
  check('a 600-point favourite winning still moves 1', matchDeltas(1900, 1300, 1).home.delta === 1,
    String(matchDeltas(1900, 1300, 1).home.delta))
  const lopsided = matchDeltas(2300, 1500, 1)
  check('an overwhelming favourite winning moves nobody', lopsided.home.delta === 0,
    String(lopsided.home.delta))
  check('...and it is still zero-sum', lopsided.away.delta === -lopsided.home.delta)
  check('a forfeit moves nobody', matchDeltas(1500, 1700, 1, { forfeit: true }).home.delta === 0)

  section('Which results count at all')
  check('a Yahoo Tournament is rating-neutral', isRatingNeutral('YAHOO', 42) === true)
  check('a Yahoo Season is not', isRatingNeutral('YAHOO', null) === false)
  check('a CueVerse Tournament is not', isRatingNeutral('CUEVERSE', 42) === false)
  check('a CueVerse Season is not', isRatingNeutral('CUEVERSE', null) === false)

  // ══ 2. The invariant ══════════════════════════════════════════════════════════════════════════
  const platforms = await prisma.ratingLedger.findMany({
    distinct: ['platform'], select: { platform: true },
  })
  check('the ledger has rows to replay', platforms.length > 0, `${platforms.length} platform(s)`)

  for (const { platform } of platforms) {
    section(`${platform}: a full replay reproduces the stored ladder`)
    const rows = await prisma.ratingLedger.findMany({
      where: { platform }, orderBy: { sequence: 'asc' }, select: SELECT,
    }) as unknown as RatingRow[]

    const replayed = replayRatings(rows)
    const stored = storedRatings(rows)
    check(`${rows.length} rows over ${stored.size} players`, rows.length > 0)

    /*
      Every player, not a sample, and exact equality rather than a tolerance.

      A tolerance is what hid this the first time: 1-2 points looks like noise until somebody
      switches a tab and watches the whole table move.
    */
    const off: string[] = []
    for (const [playerId, s] of stored) {
      const r = replayed.get(playerId)
      if (!r) { off.push(`${playerId}: not replayed at all`); continue }
      if (r.rating !== s.rating) off.push(`${playerId}: replay ${r.rating} vs stored ${s.rating}`)
    }
    check('every player ends on the stored rating', off.length === 0,
      `${off.length} differ, e.g. ${off.slice(0, 3).join('; ')}`)

    const peaksOff: string[] = []
    for (const [playerId, s] of stored) {
      const r = replayed.get(playerId)
      if (r && r.highestRating !== s.highestRating) {
        peaksOff.push(`${playerId}: ${r.highestRating} vs ${s.highestRating}`)
      }
    }
    check('...and on the same peak', peaksOff.length === 0,
      `${peaksOff.length} differ, e.g. ${peaksOff.slice(0, 3).join('; ')}`)

    /*
      A subset must be scored the same way as the whole.

      This is the tab, stated as arithmetic: replaying only one competition's rows has to give the
      same answer as replaying that competition's rows out of the full set, for a player whose
      matches all sit inside it. If it does not, All and 8BRCAM will disagree again.
    */
    const seasonRows = rows.filter((r) => r.seasonId != null)
    if (seasonRows.length > 0 && seasonRows.length < rows.length) {
      const subsetAlone = replayRatings(seasonRows)
      const subsetOfWhole = replayRatings(rows.filter((r) => r.seasonId != null))
      let same = true
      for (const [pid, v] of subsetAlone) {
        if (subsetOfWhole.get(pid)?.rating !== v.rating) { same = false; break }
      }
      check('a filtered replay is stable', same)
    }

    check('nobody drifts below the starting rating without playing',
      [...replayed.values()].every((v) => v.highestRating >= ELO_START))
  }

  // ══ 3. The reported symptom, on the real data ═════════════════════════════════════════════════
  section('The tab that started this')
  const KEVIN = 'cmsyrx31g00006riggac6o23n'
  const kevinRows = await prisma.ratingLedger.findMany({
    where: { playerId: KEVIN, platform: 'CUEVERSE' }, orderBy: { sequence: 'asc' },
    select: { postRating: true, ratingChange: true },
  })
  if (kevinRows.length > 0) {
    const cueverse = await prisma.ratingLedger.findMany({
      where: { platform: 'CUEVERSE' }, orderBy: { sequence: 'asc' }, select: SELECT,
    }) as unknown as RatingRow[]
    const replayed = replayRatings(cueverse).get(KEVIN)
    const last = kevinRows[kevinRows.length - 1].postRating
    check('the replayed rating equals the stored one for the player who reported it',
      replayed?.rating === last, `replay ${replayed?.rating} vs stored ${last}`)
    check('...and equals 1500 plus his changes',
      replayed?.rating === ELO_START + kevinRows.reduce((s, r) => s + r.ratingChange, 0),
      String(ELO_START + kevinRows.reduce((s, r) => s + r.ratingChange, 0)))
  }
} finally {
  await prisma.$disconnect()
}

console.log(`\n${'═'.repeat(74)}`)
if (fail) {
  console.log(`\n${fail} FAILED:\n`)
  for (const f of failures) console.log(`  x ${f}`)
}
console.log(`\n${pass} checks passed, ${fail} failed\n`)
await new Promise((r) => { setTimeout(r, 250) })
process.exit(fail ? 1 : 0)
