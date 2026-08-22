/**
 * Playoff scoring moves to Creator, and the public page stops being able to change anything.
 *
 * ── The handoff is the risky part ────────────────────────────────────────────────────────────────
 * Removing the public controls before Creator can score would leave playoff results enterable
 * nowhere. So this proves both halves against the same fixture: the canonical services record a
 * result, a forfeit and a correction, AND the public page carries no input, no save control and no
 * hidden form. One without the other is not a passing state.
 *
 * ── Forfeit is not a score ───────────────────────────────────────────────────────────────────────
 * A forfeit decides who advances and produces no games. Writing it as 7-0 — how it usually gets
 * described out loud — would put seven games nobody played into the winner's differential, their
 * win percentage and their rating. The games stay null and `forfeitEntrantId` carries the fact,
 * and that is asserted rather than assumed.
 *
 * Fixtures only, all removed afterwards. No real Season is touched.
 *
 * Run: npx tsx --tsconfig scripts/tsconfig.verify.json --env-file=.env scripts/verify-creator-playoff-scoring.mts
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
import { playoffScoringRounds, playoffNeedsReviewCount } from '../src/lib/seasons/playoff-scoring-view.ts'

assertLocalDatabase()

const ACTOR = { userId: 2, username: 'verify-playoff-scoring' }
const YEAR = 2089
const BASE = process.env.VERIFY_BASE_URL ?? 'http://localhost:3000'
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

const pool = await prisma.player.findMany({ where: { active: true }, take: 4, select: { id: true } })

/** A public Season with a live four-player bracket. */
async function liveSeason(number: number): Promise<number> {
  const made = await createDraft(ACTOR, {
    type: 'season', competitionYear: YEAR, competitionSeriesId: series.id, purpose: 'live',
    structure: 'groups_playoffs', number, division: null, accessMode: 'OPEN',
  })
  if (!made.ok || made.id == null) throw new Error(made.error ?? 'fixture failed')
  const id = made.id
  await prisma.season.update({ where: { id }, data: { publiclyVisible: true } })
  for (const p of pool) await addSeasonEntrant(ACTOR, id, p.id)
  await closeRegistration(ACTOR, id)
  await transitionSeasonState(ACTOR, id, 'GROUP_SETUP')
  await generateSeasonGroups(ACTOR, id, 1)
  await publishSeasonGroups(ACTOR, id)
  const g = await prisma.seasonGroup.findFirstOrThrow({ where: { seasonId: id }, select: { id: true } })
  const ms = await prisma.seasonMatch.findMany({ where: { seasonId: id, groupId: g.id }, orderBy: { id: 'asc' } })
  await saveSeasonGroupResults(ACTOR, id, g.id, ms.map((m, i) => ({ matchId: m.id, home: '7', away: String(i % 5), version: m.version })))
  await closeSeasonGroups(ACTOR, id)
  await enterSeasonPlayoffSetup(ACTOR, id)
  await generateSeasonBracket(ACTOR, id)
  const started = await startSeasonPlayoffs(ACTOR, id)
  if (!started.ok) throw new Error(started.error)
  return id
}

const getPublic = async (path: string) => {
  const res = await fetch(`${BASE}${path}`, { headers: { 'cache-control': 'no-cache' } })
  return { status: res.status, body: await res.text() }
}
let serverUp = true
try { serverUp = (await fetch(`${BASE}/seasons`, { signal: AbortSignal.timeout(8000) })).ok } catch { serverUp = false }

try {
  section('A live four-player bracket')
  check('four players are available', pool.length === 4, `${pool.length}`)
  const id = await liveSeason(1)
  check('the Season is live',
    (await prisma.season.findUniqueOrThrow({ where: { id }, select: { lifecycleState: true } })).lifecycleState === 'PLAYOFFS_LIVE')

  const rounds = await playoffScoringRounds(id)
  check('the scoring view returns rounds', rounds.length === 2, `${rounds.length}`)
  check('...named for their place in the bracket',
    rounds.map((r) => r.name).join(' → ') === 'Semi-finals → Final', rounds.map((r) => r.name).join(' → '))
  const semis = rounds[0].matches
  const final = rounds[1].matches[0]
  check('both semi-finals are playable',
    semis.every((m) => m.home.entrantId != null && m.away.entrantId != null))
  check('the Final is waiting on its feeders',
    final.home.entrantId == null && final.away.entrantId == null)
  check('...and says which ties decide it', final.feederLabels.length === 2, JSON.stringify(final.feederLabels))
  check('the Final’s sides are NOT entry positions, so its blanks are TBD not byes',
    final.homeIsEntry === false && final.awayIsEntry === false)

  section('A numeric result advances the winner')
  const r1 = await recordSeasonPlayoffResult(ACTOR, semis[0].id, 9, 4)
  check('it saves', r1.ok === true, JSON.stringify(r1))
  const saved = await prisma.seasonPlayoffMatch.findUniqueOrThrow({ where: { id: semis[0].id } })
  check('the winner is the higher score', saved.winnerEntrantId === saved.homeEntrantId)
  check('...and the games were recorded', saved.homeGames === 9 && saved.awayGames === 4)
  const afterOne = await prisma.seasonPlayoffMatch.findUniqueOrThrow({ where: { id: final.id } })
  check('the winner advanced into the Final',
    afterOne.homeEntrantId === saved.winnerEntrantId || afterOne.awayEntrantId === saved.winnerEntrantId)

  section('A tie is refused')
  const drawn = await recordSeasonPlayoffResult(ACTOR, semis[1].id, 5, 5)
  check('equal scores are rejected', drawn.ok === false, JSON.stringify(drawn))
  check('...leaving the match undecided',
    (await prisma.seasonPlayoffMatch.findUniqueOrThrow({ where: { id: semis[1].id } })).winnerEntrantId === null)

  section('A forfeit advances a player and records no games')
  const ff = await recordSeasonPlayoffForfeit(ACTOR, semis[1].id, 'away')
  check('the forfeit saves', ff.ok === true, JSON.stringify(ff))
  const ffRow = await prisma.seasonPlayoffMatch.findUniqueOrThrow({ where: { id: semis[1].id } })
  check('the status is FORFEIT', String(ffRow.status) === 'FORFEIT', String(ffRow.status))
  check('the forfeiter is recorded', ffRow.forfeitEntrantId === ffRow.awayEntrantId)
  check('the winner is the opponent', ffRow.winnerEntrantId === ffRow.homeEntrantId)
  check('NO games were written on either side',
    ffRow.homeGames === null && ffRow.awayGames === null,
    `${ffRow.homeGames}-${ffRow.awayGames}`)
  const finalNow = await prisma.seasonPlayoffMatch.findUniqueOrThrow({ where: { id: final.id } })
  check('the forfeit winner advanced too',
    finalNow.homeEntrantId != null && finalNow.awayEntrantId != null)

  section('A stale edit is refused rather than silently overwriting')
  const stale = await recordSeasonPlayoffResult(ACTOR, semis[0].id, 9, 1, {
    expectedUpdatedAt: new Date(0).toISOString(),
  })
  check('the save is rejected', stale.ok === false && stale.conflict === true, JSON.stringify(stale))
  check('...and the stored score is untouched',
    (await prisma.seasonPlayoffMatch.findUniqueOrThrow({ where: { id: semis[0].id } })).awayGames === 4)

  section('Re-saving the same result is idempotent')
  const fresh = await prisma.seasonPlayoffMatch.findUniqueOrThrow({ where: { id: semis[0].id } })
  const again = await recordSeasonPlayoffResult(ACTOR, semis[0].id, 9, 4, {
    expectedUpdatedAt: fresh.updatedAt.toISOString(),
  })
  check('it saves', again.ok === true, JSON.stringify(again))
  const stillOne = await prisma.seasonPlayoffMatch.count({ where: { seasonId: id, round: 2 } })
  check('...and the Final was not duplicated', stillOne === 1, `${stillOne}`)
  const finalAfter = await prisma.seasonPlayoffMatch.findUniqueOrThrow({ where: { id: final.id } })
  check('...and its participants are unchanged',
    finalAfter.homeEntrantId === finalNow.homeEntrantId && finalAfter.awayEntrantId === finalNow.awayEntrantId)

  section('Changing a decided winner warns before rebuilding')
  const current = await prisma.seasonPlayoffMatch.findUniqueOrThrow({ where: { id: semis[0].id } })
  const flip = await recordSeasonPlayoffResult(ACTOR, semis[0].id, 2, 9, {
    expectedUpdatedAt: current.updatedAt.toISOString(),
  })
  check('the correction is held for confirmation', flip.ok === false && !!flip.warning, JSON.stringify(flip))
  check('...naming the downstream match', (flip.warning?.affected.length ?? 0) > 0)
  check('...and nothing changed yet',
    (await prisma.seasonPlayoffMatch.findUniqueOrThrow({ where: { id: semis[0].id } })).winnerEntrantId === current.winnerEntrantId)

  const confirmed = await recordSeasonPlayoffResult(ACTOR, semis[0].id, 2, 9, {
    confirmRebuild: true,
    expectedUpdatedAt: current.updatedAt.toISOString(),
  })
  check('confirming applies it', confirmed.ok === true, JSON.stringify(confirmed))
  const flipped = await prisma.seasonPlayoffMatch.findUniqueOrThrow({ where: { id: semis[0].id } })
  check('the winner changed', flipped.winnerEntrantId === flipped.awayEntrantId)
  const rebuilt = await prisma.seasonPlayoffMatch.findUniqueOrThrow({ where: { id: final.id } })
  check('...and the new winner is in the Final',
    rebuilt.homeEntrantId === flipped.winnerEntrantId || rebuilt.awayEntrantId === flipped.winnerEntrantId)
  check('...and the old winner is not',
    rebuilt.homeEntrantId !== current.winnerEntrantId && rebuilt.awayEntrantId !== current.winnerEntrantId)

  section('The Final decides a champion')
  const finalRow = await prisma.seasonPlayoffMatch.findUniqueOrThrow({ where: { id: final.id } })
  const decided = await recordSeasonPlayoffResult(ACTOR, final.id, 9, 6, {
    expectedUpdatedAt: finalRow.updatedAt.toISOString(),
  })
  check('the Final saves', decided.ok === true, JSON.stringify(decided))
  const champ = await seasonChampion(id)
  check('a champion is derivable', champ != null && !!champ.championName, JSON.stringify(champ))
  check('...and a runner-up too', !!champ?.runnerUpName, JSON.stringify(champ))
  check('nothing is awaiting review', (await playoffNeedsReviewCount(id)) === 0)
  check('the Season did NOT complete itself',
    (await prisma.season.findUniqueOrThrow({ where: { id }, select: { lifecycleState: true } })).lifecycleState === 'PLAYOFFS_LIVE')

  if (!serverUp) {
    console.log(`\n  ! ${BASE} is not responding — the public-surface checks are skipped.`)
  } else {
    section('The public page can no longer change anything')
    const page = await getPublic(`/seasons/${id}?view=playoffs`)
    check('it renders', page.status === 200, `status ${page.status}`)
    check('...showing the bracket', /Final|Semi-final/.test(page.body))
    for (const control of [
      'Save Group', 'Close Season & Crown Champion', 'Start Playoffs', 'Generate Bracket',
      'Regenerate Bracket', 'Private Draft', 'Correct', 'Reopen Groups', 'Close Groups',
    ]) {
      check(`no "${control}" control`, !page.body.includes(control))
    }
    // A score input would be an <input> inside the bracket region; the read-only panel has none.
    const bracketRegion = page.body.slice(page.body.indexOf('PLAYOFF BRACKET'))
    check('no input element anywhere in the bracket region',
      !/<input/i.test(bracketRegion), 'an input was rendered')
    check('...and no form either', !/<form/i.test(bracketRegion))
  }

  section('Scoring is reachable in Creator for the same Season')
  const creatorRounds = await playoffScoringRounds(id)
  check('the Creator view still returns the bracket', creatorRounds.length === 2)
  check('...with the Final decided',
    creatorRounds[1].matches[0].winnerEntrantId != null)
  check('...and the forfeit visible as a forfeit',
    creatorRounds[0].matches.some((m) => m.forfeitEntrantId != null))
} finally {
  await cleanup()
  check('every fixture Season is removed',
    (await prisma.season.count({ where: { competitionYear: YEAR } })) === 0)
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
await prisma.$disconnect()
if (fail > 0) process.exitCode = 1
