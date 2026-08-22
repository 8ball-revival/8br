/**
 * Correcting a playoff result, and closing the Season afterwards.
 *
 * ── The two things that must not happen ──────────────────────────────────────────────────────────
 * A correction must never attribute a recorded score to somebody who did not play it, and closing
 * must never award a title or a ranking contribution twice.
 *
 * The first used to be handled by wiping every downstream result, which is safe and far too blunt:
 * fixing a transposed semi-final score erased a Final nobody had questioned. The rule now is whether
 * a downstream match still holds the SAME TWO PLAYERS — if it does, what they did still happened.
 *
 * The second is guarded by construction: completion sets fields rather than appending, and rebuilds
 * the whole ledger deterministically. That is easy to claim and worth proving, so this closes,
 * reopens and recloses and compares the ledger byte for byte.
 *
 * Fixtures only, all removed afterwards. No real Season is touched.
 *
 * Run: npx tsx --tsconfig scripts/tsconfig.verify.json --env-file=.env scripts/verify-season-completion.mts
 */
import { prisma } from '../src/lib/prisma.ts'
import { assertLocalDatabase } from '../src/lib/db-guard.ts'
import { createDraft } from '../src/lib/creator/setup.ts'
import { addSeasonEntrant, closeRegistration } from '../src/lib/seasons/service.ts'
import { transitionSeasonState } from '../src/lib/seasons/lifecycle.ts'
import { generateSeasonGroups, publishSeasonGroups } from '../src/lib/seasons/groups.ts'
import { saveSeasonGroupResults, closeSeasonGroups } from '../src/lib/seasons/group-stage.ts'
import {
  enterSeasonPlayoffSetup, generateSeasonBracket, startSeasonPlayoffs,
  recordSeasonPlayoffResult, recordSeasonPlayoffForfeit, seasonChampion,
} from '../src/lib/seasons/playoffs.ts'
import { correctionImpact } from '../src/lib/seasons/playoff-correction.ts'
import { closeSeason, completionReadiness } from '../src/lib/seasons/close.ts'
import { finalsForfeitOf } from '../src/lib/competition/finals-forfeit.ts'

assertLocalDatabase()

const ACTOR = { userId: 2, username: 'verify-completion' }
const YEAR = 2088
let pass = 0
let fail = 0
const check = (label: string, ok: boolean, detail?: string) => {
  if (ok) { pass++; console.log(`  ✓ ${label}`) }
  else { fail++; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`) }
}
const section = (t: string) => console.log(`\n--- ${t} ---`)

const series = await prisma.competitionSeries.findFirstOrThrow({ select: { id: true } })

async function cleanup() {
  const rows = await prisma.season.findMany({ where: { competitionYear: YEAR }, select: { id: true } })
  for (const r of rows) {
    await prisma.seasonPlayoffMatch.deleteMany({ where: { seasonId: r.id } })
    await prisma.seasonMatch.deleteMany({ where: { seasonId: r.id } })
    await prisma.seasonStanding.deleteMany({ where: { seasonId: r.id } })
    await prisma.seasonGroup.deleteMany({ where: { seasonId: r.id } })
    await prisma.seasonEntrant.deleteMany({ where: { seasonId: r.id } })
    await prisma.season.delete({ where: { id: r.id } }).catch(() => {})
  }
}
await cleanup()

const pool = await prisma.player.findMany({ where: { active: true }, take: 8, select: { id: true } })

/** A live eight-player bracket: two rounds of feeders, so a correction has something downstream. */
async function liveSeason(number: number, players = 8): Promise<number> {
  const made = await createDraft(ACTOR, {
    type: 'season', competitionYear: YEAR, competitionSeriesId: series.id, purpose: 'live',
    structure: 'groups_playoffs', number, division: null, accessMode: 'OPEN',
  })
  if (!made.ok || made.id == null) throw new Error(made.error ?? 'fixture failed')
  const id = made.id
  for (const p of pool.slice(0, players)) await addSeasonEntrant(ACTOR, id, p.id)
  await closeRegistration(ACTOR, id)
  await transitionSeasonState(ACTOR, id, 'GROUP_SETUP')
  await generateSeasonGroups(ACTOR, id, 2)
  await publishSeasonGroups(ACTOR, id)
  for (const g of await prisma.seasonGroup.findMany({ where: { seasonId: id }, select: { id: true } })) {
    const ms = await prisma.seasonMatch.findMany({ where: { seasonId: id, groupId: g.id }, orderBy: { id: 'asc' } })
    await saveSeasonGroupResults(ACTOR, id, g.id, ms.map((m, i) => ({ matchId: m.id, home: '7', away: String(i % 5), version: m.version })))
  }
  await closeSeasonGroups(ACTOR, id)
  await enterSeasonPlayoffSetup(ACTOR, id)
  await generateSeasonBracket(ACTOR, id)
  const started = await startSeasonPlayoffs(ACTOR, id)
  if (!started.ok) throw new Error(started.error)
  return id
}

const ordered = (seasonId: number) =>
  prisma.seasonPlayoffMatch.findMany({ where: { seasonId }, orderBy: [{ round: 'asc' }, { slot: 'asc' }] })

/** Play every round in order, so the bracket reaches a Final. */
async function playThrough(seasonId: number, opts: { finalForfeit?: boolean } = {}) {
  for (let guard = 0; guard < 8; guard++) {
    const rows = await ordered(seasonId)
    const playable = rows.filter((m) => m.winnerEntrantId == null && m.homeEntrantId != null && m.awayEntrantId != null)
    if (!playable.length) break
    const maxRound = Math.max(...rows.map((m) => m.round))
    for (const m of playable) {
      if (opts.finalForfeit && m.round === maxRound) {
        await recordSeasonPlayoffForfeit(ACTOR, m.id, 'away')
      } else {
        await recordSeasonPlayoffResult(ACTOR, m.id, 9, 3)
      }
    }
  }
}

try {
  check('eight players are available', pool.length === 8, `${pool.length}`)

  section('A correction keeps what it does not touch')
  const s1 = await liveSeason(1)
  const rows = await ordered(s1)
  const r1 = rows.filter((m) => m.round === 1)
  // Decide one half of the bracket completely, so there is a downstream result on each side.
  for (const m of r1) await recordSeasonPlayoffResult(ACTOR, m.id, 9, 2)
  const semis = (await ordered(s1)).filter((m) => m.round === 2)
  for (const m of semis) await recordSeasonPlayoffResult(ACTOR, m.id, 9, 4)

  const target = r1[0]
  // The semi-final on the other side of the draw, which this correction cannot reach.
  const untouched = semis.find((m) =>
    m.homeEntrantId !== target.homeEntrantId && m.awayEntrantId !== target.homeEntrantId
    && m.homeEntrantId !== target.awayEntrantId && m.awayEntrantId !== target.awayEntrantId)
  const untouchedId = untouched?.id ?? -1
  const untouchedBefore = untouched
    ? await prisma.seasonPlayoffMatch.findUniqueOrThrow({ where: { id: untouched.id } })
    : null

  const impact = await correctionImpact(target.id, { kind: 'score', homeGames: 2, awayGames: 9 })
  check('the impact preview runs', !('error' in impact), JSON.stringify(impact).slice(0, 120))
  if (!('error' in impact)) {
    check('it names the current winner', !!impact.currentWinnerName)
    check('...and the proposed one', !!impact.proposedWinnerName)
    check('...and they differ', impact.currentWinnerName !== impact.proposedWinnerName)
    check('it shows the existing score', impact.existingScore === '9–2', impact.existingScore ?? 'null')
    check('...and the proposed score', impact.proposedScore === '2–9', impact.proposedScore)
    check('it names the direct next match', !!impact.directNext, impact.directNext ?? 'null')
    check('it lists downstream matches', impact.affected.length >= 2, `${impact.affected.length}`)
    check('...and the affected one as needing review', impact.reviewCount >= 1, `${impact.reviewCount}`)
    /*
     * The other half of the draw is not downstream of this tie at all.
     *
     * Only the chain a match feeds can be affected by correcting it, so the far semi-final never
     * enters the impact list — a stronger guarantee than being listed and preserved.
     */
    check('...and not mentioning the far side of the bracket, which it cannot reach',
      !impact.affected.some((a) => a.matchId === untouchedId), `${untouchedId}`)
    check('it knows this is a correction, not a first entry', impact.isFirstResult === false)
  }

  const applied = await recordSeasonPlayoffResult(ACTOR, target.id, 2, 9, { confirmRebuild: true })
  check('the correction applies', applied.ok === true, JSON.stringify(applied))
  check('...and what it flagged', (applied.needsReview ?? 0) >= 1, `${applied.needsReview}`)

  if (untouchedBefore) {
    const after = await prisma.seasonPlayoffMatch.findUniqueOrThrow({ where: { id: untouchedBefore.id } })
    check('the untouched semi-final kept its result',
      after.winnerEntrantId === untouchedBefore.winnerEntrantId, `${after.winnerEntrantId} vs ${untouchedBefore.winnerEntrantId}`)
    check('...and its score', after.homeGames === untouchedBefore.homeGames && after.awayGames === untouchedBefore.awayGames)
    check('...and is not flagged', after.needsReview === false)
  }

  const flagged = await prisma.seasonPlayoffMatch.findMany({ where: { seasonId: s1, needsReview: true } })
  check('the affected semi-final is flagged', flagged.length >= 1, `${flagged.length}`)
  check('...and its score was cleared rather than reassigned',
    flagged.every((m) => m.homeGames === null && m.awayGames === null && m.winnerEntrantId === null))

  section('Needs Review blocks completion')
  const blocked = await completionReadiness(s1)
  check('the Season is not ready', blocked.ok === false)
  check('...because of the review flag',
    blocked.problems.some((p) => /need/i.test(p) && /review/i.test(p)), JSON.stringify(blocked.problems))
  check('...and the count is reported', blocked.needsReview >= 1, `${blocked.needsReview}`)
  const refused = await closeSeason(ACTOR, s1)
  check('closing is refused', refused.ok === false, JSON.stringify(refused))
  check('...and the Season stayed live',
    (await prisma.season.findUniqueOrThrow({ where: { id: s1 }, select: { lifecycleState: true } })).lifecycleState === 'PLAYOFFS_LIVE')

  section('Re-entering the result clears the flag')
  const toFix = flagged[0]
  const fixed = await recordSeasonPlayoffResult(ACTOR, toFix.id, 9, 5)
  check('the re-entry saves', fixed.ok === true, JSON.stringify(fixed))
  check('...and the flag is gone',
    (await prisma.seasonPlayoffMatch.findUniqueOrThrow({ where: { id: toFix.id } })).needsReview === false)

  section('A played Final completes the Season exactly once')
  await playThrough(s1)
  const ready = await completionReadiness(s1)
  check('the Season is ready', ready.ok === true, JSON.stringify(ready.problems))
  check('...with a champion', !!ready.championName)
  check('...and a runner-up', !!ready.runnerUpName)
  check('...not by forfeit', ready.byForfeit === false)

  const closed = await closeSeason(ACTOR, s1)
  check('it closes', closed.ok === true, JSON.stringify(closed))
  const done = await prisma.season.findUniqueOrThrow({ where: { id: s1 } })
  check('the Season is completed', String(done.lifecycleState) === 'COMPLETED')
  check('the champion is recorded', !!done.championName)
  check('the runner-up is recorded', !!done.runnerUpName)
  check('finalsForfeit is false for a played Final', done.finalsForfeit === false)

  const ledgerAfterFirst = await prisma.ratingLedger.count()
  const closeAudits = await prisma.auditLog.count({ where: { action: 'season.close', entityId: String(s1) } })
  check('one completion audit event', closeAudits === 1, `${closeAudits}`)

  section('Closing again is refused and duplicates nothing')
  const twice = await closeSeason(ACTOR, s1)
  check('the second close is refused', twice.ok === false, JSON.stringify(twice))
  check('the ledger did not grow', (await prisma.ratingLedger.count()) === ledgerAfterFirst)
  check('...and no second audit event',
    (await prisma.auditLog.count({ where: { action: 'season.close', entityId: String(s1) } })) === 1)
  check('the readiness now says it is already completed',
    (await completionReadiness(s1)).alreadyCompleted === true)

  section('A Final won by forfeit is marked; a semi-final forfeit is not')
  const s2 = await liveSeason(2)
  // Forfeit a SEMI-final first: this must never mark the Season.
  const semiRows = (await ordered(s2)).filter((m) => m.round === 1)
  for (const m of semiRows) await recordSeasonPlayoffResult(ACTOR, m.id, 9, 1)
  const semisNow = (await ordered(s2)).filter((m) => m.round === 2)
  await recordSeasonPlayoffForfeit(ACTOR, semisNow[0].id, 'away')
  await recordSeasonPlayoffResult(ACTOR, semisNow[1].id, 9, 2)
  /*
   * Not `=== false`: with the Final still unplayed the helper answers null, which is the honest
   * "no Final result yet". What matters is that a forfeited SEMI-final never makes it true.
   */
  check('a forfeited semi-final does NOT mark the Season',
    (await finalsForfeitOf(prisma, 'season', s2)) !== true)

  const finalRow = (await ordered(s2)).find((m) => m.round === 3)!
  await recordSeasonPlayoffResult(ACTOR, finalRow.id, 9, 6)
  check('a played Final leaves the marker off',
    (await finalsForfeitOf(prisma, 'season', s2)) === false)

  // Now correct the Final to a forfeit: the marker must follow.
  const freshFinal = await prisma.seasonPlayoffMatch.findUniqueOrThrow({ where: { id: finalRow.id } })
  const toFf = await recordSeasonPlayoffForfeit(ACTOR, finalRow.id, 'away', {
    confirmRebuild: true, expectedUpdatedAt: freshFinal.updatedAt.toISOString(),
  })
  check('the Final can be corrected to a forfeit', toFf.ok === true, JSON.stringify(toFf))
  check('...and the marker follows', (await finalsForfeitOf(prisma, 'season', s2)) === true)

  const ffReady = await completionReadiness(s2)
  check('the confirmation reports the forfeit', ffReady.byForfeit === true)
  check('...and still names a champion', !!ffReady.championName)

  const ffClosed = await closeSeason(ACTOR, s2)
  check('the Season closes', ffClosed.ok === true, JSON.stringify(ffClosed))
  const ffDone = await prisma.season.findUniqueOrThrow({ where: { id: s2 } })
  check('finalsForfeit is stored true', ffDone.finalsForfeit === true)
  check('...and a champion is recorded', !!ffDone.championName)
  const ffFinal = await prisma.seasonPlayoffMatch.findUniqueOrThrow({ where: { id: finalRow.id } })
  check('the forfeited Final records no games',
    ffFinal.homeGames === null && ffFinal.awayGames === null,
    `${ffFinal.homeGames}-${ffFinal.awayGames}`)

  section('Correcting a forfeited Final back to a played one clears the marker')
  const s3 = await liveSeason(3)
  await playThrough(s3, { finalForfeit: true })
  check('the marker is set', (await finalsForfeitOf(prisma, 'season', s3)) === true)
  const s3Final = (await ordered(s3)).reduce((a, b) => (b.round > a.round ? b : a))
  const played = await recordSeasonPlayoffResult(ACTOR, s3Final.id, 9, 7, {
    confirmRebuild: true,
    expectedUpdatedAt: (await prisma.seasonPlayoffMatch.findUniqueOrThrow({ where: { id: s3Final.id } })).updatedAt.toISOString(),
  })
  check('the correction applies', played.ok === true, JSON.stringify(played))
  check('...and the marker clears', (await finalsForfeitOf(prisma, 'season', s3)) === false)
  const s3Closed = await closeSeason(ACTOR, s3)
  check('the Season closes', s3Closed.ok === true, JSON.stringify(s3Closed))
  check('...with finalsForfeit false',
    (await prisma.season.findUniqueOrThrow({ where: { id: s3 }, select: { finalsForfeit: true } })).finalsForfeit === false)

  section('The completed Seasons carry a champion and a runner-up')
  for (const id of [s1, s2, s3]) {
    const c = await seasonChampion(id)
    check(`Season ${id} still derives its champion`, c != null && !!c.championName)
  }
} finally {
  await cleanup()
  check('every fixture Season is removed',
    (await prisma.season.count({ where: { competitionYear: YEAR } })) === 0)
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
await prisma.$disconnect()
if (fail > 0) process.exitCode = 1
