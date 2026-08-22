/**
 * `countsTowardRankings` is a real switch, and withdrawal never uses subtraction.
 *
 * ── What was wrong ───────────────────────────────────────────────────────────────────────────────
 * The column existed and did nothing. The ledger rebuilt from every COMPLETED record, so switching
 * it off changed a checkbox and left the player's rating exactly where it was. A record Under
 * Correction kept contributing too, while its results were being changed.
 *
 * ── Why the rebuild matters more than the switch ─────────────────────────────────────────────────
 * The tempting implementation is to subtract a record's contribution when it is withdrawn and add it
 * back later. That drifts: Elo is path-dependent, so removing a 2019 result and re-adding it does
 * not restore the ratings of everyone who played after it. The ledger is rebuilt from whatever is
 * eligible right now, which makes withdrawal and restoration the same operation — and that is what
 * these repeated cycles prove.
 *
 * Fixtures only, all removed afterwards. Real records are read for comparison and never written.
 *
 * Run: npx tsx --tsconfig scripts/tsconfig.verify.json --env-file=.env scripts/verify-ranking-eligibility.mts
 */
import { prisma } from '../src/lib/prisma.ts'
import { assertLocalDatabase } from '../src/lib/db-guard.ts'
import { createDraft } from '../src/lib/creator/setup.ts'
import { addSeasonEntrant, closeRegistration } from '../src/lib/seasons/service.ts'
import { transitionSeasonState } from '../src/lib/seasons/lifecycle.ts'
import { generateSeasonGroups, publishSeasonGroups } from '../src/lib/seasons/groups.ts'
import { saveSeasonGroupResults, closeSeasonGroups } from '../src/lib/seasons/group-stage.ts'
import {
  enterSeasonPlayoffSetup, generateSeasonBracket, startSeasonPlayoffs, recordSeasonPlayoffResult,
} from '../src/lib/seasons/playoffs.ts'
import { closeSeason } from '../src/lib/seasons/close.ts'
import { reopenForCorrection, recomplete } from '../src/lib/competition/correction.ts'
import { rebuildRatingLedger } from '../src/lib/stats/ledger.ts'
import { rankingExclusionReason } from '../src/lib/stats/eligibility.ts'

assertLocalDatabase()

const ACTOR = { userId: 2, username: 'verify-eligibility' }
const YEAR = 2086
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
    await prisma.ratingLedger.deleteMany({ where: { seasonId: r.id } })
    await prisma.seasonPlayoffMatch.deleteMany({ where: { seasonId: r.id } })
    await prisma.seasonMatch.deleteMany({ where: { seasonId: r.id } })
    await prisma.seasonStanding.deleteMany({ where: { seasonId: r.id } })
    await prisma.seasonGroup.deleteMany({ where: { seasonId: r.id } })
    await prisma.seasonEntrant.deleteMany({ where: { seasonId: r.id } })
    await prisma.season.delete({ where: { id: r.id } }).catch(() => {})
  }
  await prisma.$transaction(async (tx) => { await rebuildRatingLedger(tx) })
}
await cleanup()

const pool = await prisma.player.findMany({ where: { active: true }, take: 4, select: { id: true } })
const rebuild = () => prisma.$transaction(async (tx) => { await rebuildRatingLedger(tx) })

/** Every ledger row that does NOT belong to the fixture — the rest of the site's history. */
const othersFingerprint = async (fixtureId: number) => {
  const rows = await prisma.ratingLedger.findMany({
    where: { seasonId: { not: fixtureId } },
    orderBy: [{ matchKey: 'asc' }, { playerId: 'asc' }],
    select: { matchKey: true, playerId: true, postRating: true, ratingChange: true },
  })
  return JSON.stringify(rows)
}

async function completedSeason(number: number): Promise<number> {
  const made = await createDraft(ACTOR, {
    type: 'season', competitionYear: YEAR, competitionSeriesId: series.id, purpose: 'live',
    structure: 'groups_playoffs', number, division: null, accessMode: 'OPEN',
  })
  if (!made.ok || made.id == null) throw new Error(made.error ?? 'fixture failed')
  const id = made.id
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
  await startSeasonPlayoffs(ACTOR, id)
  for (let guard = 0; guard < 6; guard++) {
    const rows = await prisma.seasonPlayoffMatch.findMany({ where: { seasonId: id }, orderBy: [{ round: 'asc' }, { slot: 'asc' }] })
    const playable = rows.filter((m) => m.winnerEntrantId == null && m.homeEntrantId != null && m.awayEntrantId != null)
    if (!playable.length) break
    for (const m of playable) await recordSeasonPlayoffResult(ACTOR, m.id, 9, 3)
  }
  const closed = await closeSeason(ACTOR, id)
  if (!closed.ok) throw new Error(closed.error)
  return id
}

try {
  section('A completed Season contributes')
  check('four players are available', pool.length === 4, `${pool.length}`)
  const id = await completedSeason(1)
  const contributing = await prisma.ratingLedger.count({ where: { seasonId: id } })
  check('it has ledger rows', contributing > 0, `${contributing}`)
  const othersAtStart = await othersFingerprint(id)
  const row = await prisma.season.findUniqueOrThrow({ where: { id } })
  check('nothing excludes it', rankingExclusionReason(row) === null, rankingExclusionReason(row) ?? '')

  section('Switching Counts Toward Rankings off withdraws only this record')
  await prisma.season.update({ where: { id }, data: { countsTowardRankings: false } })
  await rebuild()
  check('its ledger rows are gone', (await prisma.ratingLedger.count({ where: { seasonId: id } })) === 0)
  check('every other record is byte-identical', (await othersFingerprint(id)) === othersAtStart)
  const off = await prisma.season.findUniqueOrThrow({ where: { id } })
  check('...and the reason says so',
    /Counts Toward Rankings/i.test(rankingExclusionReason(off) ?? ''), rankingExclusionReason(off) ?? '')

  section('Switching it back on restores it exactly once')
  await prisma.season.update({ where: { id }, data: { countsTowardRankings: true } })
  await rebuild()
  check('the same number of rows come back',
    (await prisma.ratingLedger.count({ where: { seasonId: id } })) === contributing,
    `${await prisma.ratingLedger.count({ where: { seasonId: id } })} vs ${contributing}`)
  check('every other record is still byte-identical', (await othersFingerprint(id)) === othersAtStart)

  section('Reopening withdraws it; recompleting restores it')
  const fixtureAtStart = JSON.stringify(await prisma.ratingLedger.findMany({
    where: { seasonId: id }, orderBy: [{ matchKey: 'asc' }, { playerId: 'asc' }],
    select: { matchKey: true, playerId: true, postRating: true },
  }))
  const reopened = await reopenForCorrection(ACTOR, 'season', id, 'eligibility check')
  check('it reopens', reopened.ok === true, JSON.stringify(reopened))
  await rebuild()
  check('its contribution is withdrawn', (await prisma.ratingLedger.count({ where: { seasonId: id } })) === 0)
  check('everything else is untouched', (await othersFingerprint(id)) === othersAtStart)
  const under = await prisma.season.findUniqueOrThrow({ where: { id } })
  check('...and the reason names the correction',
    /Under Correction/i.test(rankingExclusionReason(under) ?? ''), rankingExclusionReason(under) ?? '')

  const back = await recomplete(ACTOR, 'season', id, 'eligibility check')
  check('it recompletes', back.ok === true, JSON.stringify(back))
  check('its contribution is restored exactly', (await prisma.ratingLedger.count({ where: { seasonId: id } })) === contributing)
  check('...and identical to before the cycle',
    JSON.stringify(await prisma.ratingLedger.findMany({
      where: { seasonId: id }, orderBy: [{ matchKey: 'asc' }, { playerId: 'asc' }],
      select: { matchKey: true, playerId: true, postRating: true },
    })) === fixtureAtStart)
  check('everything else is STILL byte-identical', (await othersFingerprint(id)) === othersAtStart)

  section('Repeated cycles do not drift')
  for (let i = 0; i < 3; i++) {
    await prisma.season.update({ where: { id }, data: { countsTowardRankings: false } })
    await rebuild()
    await prisma.season.update({ where: { id }, data: { countsTowardRankings: true } })
    await rebuild()
  }
  check('three off/on cycles leave the fixture identical',
    JSON.stringify(await prisma.ratingLedger.findMany({
      where: { seasonId: id }, orderBy: [{ matchKey: 'asc' }, { playerId: 'asc' }],
      select: { matchKey: true, playerId: true, postRating: true },
    })) === fixtureAtStart)
  check('...and every other record identical', (await othersFingerprint(id)) === othersAtStart)

  section('The exclusion reason covers every condition')
  const base = { lifecycleState: 'COMPLETED', ladderAppliedAt: new Date(), reopenedAt: null, deletedAt: null, countsTowardRankings: true }
  check('an eligible record has no reason', rankingExclusionReason(base) === null)
  check('an unfinished one is named',
    /completed/i.test(rankingExclusionReason({ ...base, lifecycleState: 'PLAYOFFS_LIVE' }) ?? ''))
  check('a never-finalised one is named',
    /finalised/i.test(rankingExclusionReason({ ...base, ladderAppliedAt: null }) ?? ''))
  check('a reopened one is named',
    /Under Correction/i.test(rankingExclusionReason({ ...base, reopenedAt: new Date() }) ?? ''))
  check('a deleted one is named',
    /deleted/i.test(rankingExclusionReason({ ...base, deletedAt: new Date() }) ?? ''))
  check('a switched-off one is named',
    /Counts Toward Rankings/i.test(rankingExclusionReason({ ...base, countsTowardRankings: false }) ?? ''))
} finally {
  await cleanup()
  check('every fixture Season is removed',
    (await prisma.season.count({ where: { competitionYear: YEAR } })) === 0)
  check('no fixture ledger rows remain',
    (await prisma.ratingLedger.count({ where: { season: { competitionYear: YEAR } } })) === 0)
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
await prisma.$disconnect()
if (fail > 0) process.exitCode = 1
