/**
 * The Tournament step: the Season mechanism, worth less.
 *
 * ── What this is guarding ───────────────────────────────────────────────────────────────────────
 * A Tournament win now lifts a rating the same way a Season title does — after the replay, once
 * rather than per win, on top of pure Elo. Three things have to stay true, and none of them is
 * obvious from reading the constant:
 *
 *   · a Tournament never counts like a Season (25 against 200), so no number of them approaches a
 *     single title;
 *   · a rating-neutral Tournament earns no step, because its matches move no rating and awarding a
 *     trophy bonus would say the opposite through the back door;
 *   · the ladder and the Rankings table award it identically, which is the failure that put those
 *     two readers a point apart before.
 *
 * Read-only.
 *
 * Run: npm run test:tournament-step
 */

import { readFileSync } from 'node:fs'

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
const { CHAMPION_STEP, TOURNAMENT_STEP, withChampionStep, isRatingNeutral } = await import('../src/lib/stats/elo')
const { getLadder, tournamentWinsByPlayer } = await import('../src/lib/stats/ladder')

try {
  section('The arithmetic')
  check('a Tournament win is worth the documented step',
    withChampionStep(1500, 0, 1) - 1500 === TOURNAMENT_STEP, String(TOURNAMENT_STEP))
  check('winning five is worth the same as winning one',
    withChampionStep(1500, 0, 5) === withChampionStep(1500, 0, 1))
  check('winning none is worth nothing', withChampionStep(1500, 0, 0) === 1500)
  check('a Season title is worth more', CHAMPION_STEP > TOURNAMENT_STEP, `${CHAMPION_STEP} vs ${TOURNAMENT_STEP}`)
  /*
    The ordering the two numbers exist to produce. No number of Tournament wins may add up to a
    title, which is what "a Tournament is not as important as a Season" means as arithmetic.
  */
  check('no number of Tournament wins reaches one title',
    withChampionStep(1500, 0, 99) < withChampionStep(1500, 1, 0))
  check('both are held together where both are won',
    withChampionStep(1500, 1, 1) === 1500 + CHAMPION_STEP + TOURNAMENT_STEP)

  section('A rating-neutral Tournament earns nothing')
  check('a Yahoo Tournament is neutral', isRatingNeutral('YAHOO', 1))
  check('a CueVerse Tournament is not', !isRatingNeutral('CUEVERSE', 1))

  const wins = await tournamentWinsByPlayer()
  const all = [...wins.values()].flat()
  check('the ladder can resolve Tournament winners', wins.size > 0, `${wins.size} player(s)`)
  const neutral = all.filter((w) => isRatingNeutral(w.platform, w.tournamentId))
  const counting = all.filter((w) => !isRatingNeutral(w.platform, w.tournamentId))
  console.log(`  --   ${counting.length} counting win(s), ${neutral.length} neutral`)

  section('Both readers award it the same way')
  /*
    Compared on the live ladder rather than on a fixture: the two readers agreeing about a made-up
    player proves nothing about the archive they actually serve.
  */
  for (const platform of ['CUEVERSE', 'YAHOO'] as const) {
    const rows = await getLadder('all-time', new Date(), platform)
    if (rows.length === 0) { console.log(`  --   ${platform}: no rated players`); continue }

    const winners = new Set(
      [...wins.entries()]
        .filter(([, ws]) => ws.some((w) => w.platform === platform && !isRatingNeutral(w.platform, w.tournamentId)))
        .map(([playerId]) => playerId),
    )
    const stepped = rows.filter((r) => winners.has(r.playerId))
    console.log(`  --   ${platform}: ${stepped.length} of ${rows.length} carry a counting Tournament win`)

    /*
      Every stepped player's rating must exceed their pure Elo by exactly the step (plus a title's
      where they hold one). Checked against the ledger's own last post-rating, so this is comparing
      the ladder against storage rather than against itself.
    */
    let wrong = 0
    for (const r of stepped.slice(0, 25)) {
      const last = await prisma.ratingLedger.findFirst({
        where: { playerId: r.playerId, platform },
        orderBy: { sequence: 'desc' },
        select: { postRating: true },
      })
      if (!last) continue
      const titles = r.seasonTitles.length
      const expected = withChampionStep(last.postRating, titles, 1)
      if (r.rating !== expected) wrong++
    }
    /*
      Said out loud when there is nothing to check.

      Every completed Tournament in the archive is a Yahoo one, and those are rating-neutral, so
      this assertion currently has an empty set to be true about. A green tick over no rows is the
      shape of a test that has quietly stopped testing anything, so it reports which it is.
    */
    if (stepped.length === 0) {
      console.log(`  --   ${platform}: nothing to check — no counting Tournament win exists yet`)
    } else {
      check(`${platform}: every Tournament winner carries exactly the step`, wrong === 0, `${wrong} differ`)
    }

    if (platform === 'YAHOO') {
      const yahooNeutralWinners = [...wins.entries()]
        .filter(([, ws]) => ws.some((w) => w.platform === 'YAHOO'))
        .map(([playerId]) => playerId)
      const anyStepped = rows.filter((r) => yahooNeutralWinners.includes(r.playerId) && r.seasonTitles.length === 0)
      let lifted = 0
      for (const r of anyStepped.slice(0, 25)) {
        const last = await prisma.ratingLedger.findFirst({
          where: { playerId: r.playerId, platform }, orderBy: { sequence: 'desc' }, select: { postRating: true },
        })
        if (last && r.rating !== last.postRating) lifted++
      }
      check('a Yahoo Tournament win lifts nobody', lifted === 0, `${lifted} lifted`)
    }
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
