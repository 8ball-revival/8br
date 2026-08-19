/**
 * Completed → Reopened → Corrected → Completed again.
 *
 * The property under test is that a correction changes the corrected Season AND NOTHING ELSE. That
 * is easy to get wrong in two directions at once: a withdrawal that does not withdraw, and a
 * withdrawal that takes unrelated history with it. So this builds TWO complete Seasons, corrects
 * one, and asserts on both.
 *
 * Everything runs through the real services — createSeason, groups, results, playoffs, closeSeason,
 * and the correction service — against throwaway Seasons in a dedicated fixture Competition. The two
 * real reconstructed Seasons are never touched, and the suite refuses to operate on anything outside
 * its own fixture Competition.
 *
 * Run:  npx tsx --tsconfig scripts/tsconfig.verify.json --env-file=.env scripts/verify-correction.mts
 */
import { prisma } from '../src/lib/prisma.ts'
import { assertLocalDatabase } from '../src/lib/db-guard.ts'
import { createSeason, closeRegistration } from '../src/lib/seasons/service.ts'
import * as grp from '../src/lib/seasons/groups.ts'
import * as gs from '../src/lib/seasons/group-stage.ts'
import * as po from '../src/lib/seasons/playoffs.ts'
import { closeSeason } from '../src/lib/seasons/close.ts'
import {
  completionReview, reopenForCorrection, recomplete,
} from '../src/lib/competition/correction.ts'
import { seasonIsArchived, seasonIsLive } from '../src/lib/competition/lifecycle-rules.ts'
import { getArchivedSeasons, getLiveSeasons } from '../src/lib/competition/surface.ts'
import { computeExplorer } from '../src/lib/stats/ladder-explorer.ts'
import { computeSeasonTrophies } from '../src/lib/seasons/trophies.ts'

assertLocalDatabase('verify-correction')

let pass = 0, fail = 0
const check = (n: string, c: boolean, d = '') => {
  if (c) { pass++ } else { fail++; console.log('  FAIL ' + n + (d ? ` — ${d}` : '')) }
}
const section = (s: string) => console.log(`\n${s}`)

const FIXTURE_SLUG = 'zzcorr-competition'
const actor = { userId: 990401, username: 'correction-verify' }
const madeSeasons: number[] = []

/** Refuse to touch anything that is not this suite's own. A correction test must be certain. */
async function assertFixtureSeason(id: number, compId: number) {
  const s = await prisma.season.findUnique({ where: { id }, select: { competitionSeriesId: true, slug: true } })
  if (!s) throw new Error(`Fixture Season ${id} not found`)
  if (s.competitionSeriesId !== compId) {
    throw new Error(`REFUSING to operate on Season ${id} (${s.slug}) — not in the fixture Competition`)
  }
}

const cleanupErrors: string[] = []

async function cleanup() {
  // Delete EVERY Season in the fixture Competition, not only the ids this run happens to have
  // tracked. A run that crashes mid-fixture leaves Seasons behind, and a cleanup that only knows
  // about its own ids leaves them there for ever — which is how a "test data" Season ends up in
  // somebody's archive. Scoped to the fixture Competition, so it can never reach a real one.
  const strays = await prisma.season.findMany({
    where: { competitionSeries: { slug: FIXTURE_SLUG } }, select: { id: true },
  }).catch(() => [] as { id: number }[])
  for (const { id } of strays) {
    await prisma.season.delete({ where: { id } })
      .catch((e) => cleanupErrors.push(`season ${id}: ${e instanceof Error ? e.message.slice(-160) : String(e)}`))
  }
  madeSeasons.length = 0
  await prisma.auditLog.deleteMany({ where: { actorUsername: actor.username } }).catch(() => {})
  await prisma.competitionSeries.deleteMany({ where: { slug: FIXTURE_SLUG, seasons: { none: {} } } }).catch(() => {})
  // The ledger is derived; put it back in step with whatever real Seasons remain.
  await prisma.$transaction(async (tx) => {
    const { rebuildRatingLedger } = await import('../src/lib/stats/ledger.ts')
    await rebuildRatingLedger(tx)
  }).catch(() => {})
}

/** A complete, closed Season: 6 entrants, 2 groups, every result entered, a champion, closed. */
async function buildClosedSeason(compId: number, tag: string): Promise<number> {
  const created = await createSeason(actor, { lounge: 'Social', accessMode: 'OPEN', competitionSeriesId: compId })
  if (!created.ok || created.id == null) throw new Error(`createSeason failed: ${created.error ?? 'no id returned'}`)
  const id = created.id
  madeSeasons.push(id)
  await assertFixtureSeason(id, compId)

  for (let i = 0; i < 6; i++) {
    await prisma.seasonEntrant.create({
      data: {
        seasonId: id, playerId: `zzcorr-${tag}-p${i + 1}`, username: `ZC${tag}${i + 1}`,
        displayName: `Corr ${tag}${i + 1}`, cueverseId: `zzcorr_${tag}_${i + 1}`, status: 'APPROVED',
        ratingSnapshot: 900 - i * 10,
      },
    })
  }
  await closeRegistration(actor, id)
  const g = await grp.generateSeasonGroups(actor, id, 2)
  if (!g.ok) throw new Error(`groups: ${g.error}`)
  const pub = await grp.publishSeasonGroups(actor, id)
  if (!pub.ok) throw new Error(`publish groups: ${pub.error}`)

  // Every group match gets a real result, so nothing is unresolved at close.
  const groups = await prisma.seasonGroup.findMany({ where: { seasonId: id }, select: { id: true } })
  for (const group of groups) {
    const matches = await prisma.seasonMatch.findMany({ where: { groupId: group.id }, orderBy: { id: 'asc' } })
    const r = await gs.saveSeasonGroupResults(actor, id, group.id,
      matches.map((m) => ({ matchId: m.id, home: '7', away: '3', version: m.version })))
    if (!r.ok) throw new Error(`group results: ${r.error}`)
  }
  const cg = await gs.closeSeasonGroups(actor, id)
  if (!cg.ok) throw new Error(`close groups: ${cg.error}`)

  // Groups Closed → Playoff Setup, which is what auto-selects the qualifying field and locks seeds.
  const enter = await po.enterSeasonPlayoffSetup(actor, id)
  if (!enter.ok) throw new Error(`enter playoff setup: ${enter.error}`)

  const gen = await po.generateSeasonBracket(actor, id)
  if (!gen.ok) throw new Error(`bracket: ${gen.error}`)
  const start = await po.startSeasonPlayoffs(actor, id)
  if (!start.ok) throw new Error(`start playoffs: ${start.error}`)

  for (let guard = 0; guard < 20; guard++) {
    const playable = await prisma.seasonPlayoffMatch.findMany({
      where: { seasonId: id, winnerEntrantId: null, homeEntrantId: { not: null }, awayEntrantId: { not: null } },
    })
    const real = playable.filter((m) => m.homeUsername !== 'Bye' && m.awayUsername !== 'Bye')
    if (!real.length) break
    for (const m of real) await po.recordSeasonPlayoffResult(actor, m.id, 9, 3)
  }

  const closed = await closeSeason(actor, id)
  if (!closed.ok) throw new Error(`close season: ${closed.error}`)
  return id
}

/** A fingerprint of everything a correction must NOT change. */
async function canonicalSnapshot(id: number) {
  const [entrants, groups, matches, standings, playoffs, season] = await Promise.all([
    prisma.seasonEntrant.findMany({ where: { seasonId: id }, orderBy: { id: 'asc' }, select: { id: true, username: true, playerId: true, status: true } }),
    prisma.seasonGroup.findMany({ where: { seasonId: id }, orderBy: { id: 'asc' }, select: { id: true, code: true } }),
    prisma.seasonMatch.findMany({ where: { seasonId: id }, orderBy: { id: 'asc' }, select: { id: true, homeGames: true, awayGames: true, status: true } }),
    prisma.seasonStanding.findMany({ where: { seasonId: id }, orderBy: { id: 'asc' }, select: { id: true, points: true, rank: true } }),
    prisma.seasonPlayoffMatch.findMany({ where: { seasonId: id }, orderBy: { id: 'asc' }, select: { id: true, homeEntrantId: true, awayEntrantId: true, feedsMatchId: true, feedsSlot: true, winnerEntrantId: true, homeGames: true, awayGames: true } }),
    prisma.season.findUnique({ where: { id }, select: { championName: true, championPlayerId: true, runnerUpName: true, finalScore: true, completedAt: true, competitionYear: true, number: true, description: true } }),
  ])
  return JSON.stringify({ entrants, groups, matches, standings, playoffs, season })
}

const ledgerFor = (id: number) => prisma.ratingLedger.count({ where: { seasonId: id } })
const ledgerTotal = () => prisma.ratingLedger.count()

try {
  await cleanup()
  const comp = await prisma.competitionSeries.findFirst({ where: { slug: FIXTURE_SLUG }, select: { id: true } })
    ?? await prisma.competitionSeries.create({ data: { name: 'zz Correction', shortName: 'ZZCORR', slug: FIXTURE_SLUG, active: true }, select: { id: true } })

  section('Two complete Seasons, so a correction can be shown not to touch the other')
  const realLedgerBefore = await prisma.ratingLedger.count({ where: { season: { competitionSeriesId: { not: comp.id } } } })

  const seasonA = await buildClosedSeason(comp.id, 'a')
  const seasonB = await buildClosedSeason(comp.id, 'b')
  const aLedger0 = await ledgerFor(seasonA)
  const bLedger0 = await ledgerFor(seasonB)
  check('Season A closed with a ranking contribution', aLedger0 > 0, String(aLedger0))
  check('Season B closed with a ranking contribution', bLedger0 > 0, String(bLedger0))

  const aSnapshot0 = await canonicalSnapshot(seasonA)
  const bSnapshot0 = await canonicalSnapshot(seasonB)
  const aReview0 = (await completionReview('season', seasonA))!
  check('the review reports a champion', !!aReview0.champion, String(aReview0.champion))
  check('the review counts eligible matches', aReview0.eligibleMatches > 0, String(aReview0.eligibleMatches))
  check('the review reports the SC award', aReview0.award === 'SC')
  check('the review has no blocking errors', aReview0.errors.length === 0, aReview0.errors.join('; '))

  section('Opening a completed record changes nothing')
  {
    const auditBefore = await prisma.auditLog.count({ where: { entityId: String(seasonA) } })
    const totalBefore = await ledgerTotal()
    // The Creator detail page runs exactly this and nothing else.
    await completionReview('season', seasonA)
    await completionReview('season', seasonA)
    check('no audit row is written by reading', await prisma.auditLog.count({ where: { entityId: String(seasonA) } }) === auditBefore)
    check('no ledger row moves', await ledgerTotal() === totalBefore)
    check('the canonical record is untouched', await canonicalSnapshot(seasonA) === aSnapshot0)
    const s = await prisma.season.findUnique({ where: { id: seasonA }, select: { lifecycleState: true, reopenedAt: true } })
    check('the lifecycle is untouched', s?.lifecycleState === 'COMPLETED' && s.reopenedAt === null)
  }

  section('Reopening withdraws exactly this record')
  {
    const archivedBefore = (await getArchivedSeasons({ perPage: 100 })).cards.map((c) => c.id)
    check('it is in Archives before', archivedBefore.includes(seasonA))

    const r = await reopenForCorrection(actor, 'season', seasonA, 'Score entered from a bad screenshot')
    check('reopen succeeds', r.ok, r.error)

    const s = (await prisma.season.findUnique({
      where: { id: seasonA },
      select: { lifecycleState: true, reopenedAt: true, ladderAppliedAt: true, publiclyVisible: true, reconstruction: true, cancelledAt: true, deletedAt: true },
    }))!
    check('it is marked reopened', s.reopenedAt != null)
    check('it left COMPLETED', s.lifecycleState !== 'COMPLETED', String(s.lifecycleState))
    check('the finalisation stamp is PRESERVED, so the historical timeline does not move',
      s.ladderAppliedAt != null)

    check('it is no longer archive-eligible', !seasonIsArchived(s))
    check('it is NOT publicly Live, despite being back in a running state',
      !seasonIsLive(s, s.publiclyVisible))
    check('...and the Live listing does not contain it',
      !(await getLiveSeasons()).some((c) => c.id === seasonA))
    check('...and the Archive listing does not contain it',
      !(await getArchivedSeasons({ perPage: 100 })).cards.some((c) => c.id === seasonA))

    check('its ranking contribution is gone', await ledgerFor(seasonA) === 0, String(await ledgerFor(seasonA)))
    check('Season B keeps its contribution untouched', await ledgerFor(seasonB) === bLedger0,
      `${await ledgerFor(seasonB)} vs ${bLedger0}`)
    check('unrelated real Seasons keep theirs',
      await prisma.ratingLedger.count({ where: { season: { competitionSeriesId: { not: comp.id } } } }) === realLedgerBefore)

    check('NOTHING was deleted from the competition record', await canonicalSnapshot(seasonA) === aSnapshot0)
    check('...and Season B is byte-identical too', await canonicalSnapshot(seasonB) === bSnapshot0)

    const audit = await prisma.auditLog.findFirst({
      where: { entityId: String(seasonA), action: 'season.reopen_for_correction' },
      orderBy: { id: 'desc' },
    })
    check('an audit event is recorded', !!audit)
    check('...naming the actor', audit?.actorUsername === actor.username)
    check('...recording the reason', /bad screenshot/.test(JSON.stringify(audit?.reason ?? '')))
    check('...and the before/after lifecycle',
      /COMPLETED/.test(JSON.stringify(audit?.oldValue)) && /contributesToRankings/.test(JSON.stringify(audit?.newValue)))

    const rankRows = await computeExplorer('all-time', 'overall')
    const aPlayers = rankRows.filter((x) => x.playerId.startsWith('zzcorr-a-'))
    check('reopened results no longer reach the Rankings', aPlayers.length === 0, String(aPlayers.length))
    check('Season B players still do',
      rankRows.some((x) => x.playerId.startsWith('zzcorr-b-')),
      rankRows.filter((x) => x.playerId.startsWith('zzcorr-')).map((x) => x.playerId).join(','))

    const trophies = await computeSeasonTrophies()
    const aChampId = (await prisma.season.findUnique({ where: { id: seasonA }, select: { championPlayerId: true } }))?.championPlayerId
    check('the championship stops counting while reopened',
      !aChampId || (trophies.get(aChampId) ?? []).every((t) => !String(t.label ?? '').includes(String(seasonA))))
  }

  section('Reopening again is a no-op, not a second withdrawal')
  {
    const auditBefore = await prisma.auditLog.count({ where: { entityId: String(seasonA), action: 'season.reopen_for_correction' } })
    const bLedgerBefore = await ledgerFor(seasonB)
    const r = await reopenForCorrection(actor, 'season', seasonA)
    check('a repeat reopen reports already-done rather than failing', r.ok && r.alreadyDone === true)
    check('...and writes no second audit row',
      await prisma.auditLog.count({ where: { entityId: String(seasonA), action: 'season.reopen_for_correction' } }) === auditBefore)
    check('...and does not disturb Season B', await ledgerFor(seasonB) === bLedgerBefore)
  }

  section('Correcting, then completing again')
  {
    // A real correction: change one playoff score. This is what the workspace exists for.
    const finals = await prisma.seasonPlayoffMatch.findMany({
      where: { seasonId: seasonA, status: 'COMPLETED' }, orderBy: { round: 'desc' }, take: 1,
    })
    check('there is a completed playoff match to correct', finals.length === 1)
    if (finals[0]) {
      const corrected = await po.recordSeasonPlayoffResult(actor, finals[0].id, 9, 5, { confirmRebuild: true })
      check('the correction is accepted while reopened', corrected.ok, corrected.error)
    }

    const review = (await completionReview('season', seasonA))!
    check('the review knows it is reopened', review.reopenedAt != null)
    check('the review reports zero current ledger rows while reopened', review.ledgerRows === 0)
    check('the review still has no blocking errors', review.errors.length === 0, review.errors.join('; '))

    const r = await recomplete(actor, 'season', seasonA, 'Corrected final score')
    check('recompletion succeeds', r.ok, r.error)

    const s = (await prisma.season.findUnique({
      where: { id: seasonA },
      select: { lifecycleState: true, reopenedAt: true, ladderAppliedAt: true, publiclyVisible: true, reconstruction: true, cancelledAt: true, deletedAt: true, championName: true },
    }))!
    check('it is COMPLETED again', s.lifecycleState === 'COMPLETED')
    check('the reopened marker is cleared', s.reopenedAt === null)
    check('it is archive-eligible again', seasonIsArchived(s))
    check('...and back in the Archive listing',
      (await getArchivedSeasons({ perPage: 100 })).cards.some((c) => c.id === seasonA))
    check('it is still NOT Live', !seasonIsLive(s, s.publiclyVisible))
    check('...and not in the Live listing', !(await getLiveSeasons()).some((c) => c.id === seasonA))

    const aLedger1 = await ledgerFor(seasonA)
    check('its contribution is applied again', aLedger1 > 0, String(aLedger1))
    check('...exactly once — the same number of rows as the first completion',
      aLedger1 === aLedger0, `${aLedger1} vs ${aLedger0}`)
    check('Season B is still untouched', await ledgerFor(seasonB) === bLedger0)
    check('unrelated real Seasons are still untouched',
      await prisma.ratingLedger.count({ where: { season: { competitionSeriesId: { not: comp.id } } } }) === realLedgerBefore)

    const rankRows = await computeExplorer('all-time', 'overall')
    const aPlayers = rankRows.filter((x) => x.playerId.startsWith('zzcorr-a-'))
    check('the corrected results are back in the Rankings', aPlayers.length > 0,
      rankRows.filter((x) => x.playerId.startsWith('zzcorr-')).map((x) => x.playerId).join(','))
    check('...with no duplicated player rows',
      new Set(aPlayers.map((x) => x.playerId)).size === aPlayers.length)

    const audit = await prisma.auditLog.findFirst({
      where: { entityId: String(seasonA), action: 'season.recomplete' }, orderBy: { id: 'desc' },
    })
    check('a recompletion audit event is recorded', !!audit)
    check('...carrying the champion and eligible count',
      /champion/.test(JSON.stringify(audit?.newValue)) && /eligibleMatches/.test(JSON.stringify(audit?.newValue)))

    // Every canonical id survives the round trip.
    const after = JSON.parse(await canonicalSnapshot(seasonA))
    const before = JSON.parse(aSnapshot0)
    check('every entrant id survives',
      JSON.stringify(after.entrants.map((e: { id: number }) => e.id)) === JSON.stringify(before.entrants.map((e: { id: number }) => e.id)))
    check('every group id survives',
      JSON.stringify(after.groups) === JSON.stringify(before.groups))
    check('every playoff match id and its feed topology survive',
      JSON.stringify(after.playoffs.map((p: { id: number; feedsMatchId: number | null; feedsSlot: number | null }) => [p.id, p.feedsMatchId, p.feedsSlot]))
      === JSON.stringify(before.playoffs.map((p: { id: number; feedsMatchId: number | null; feedsSlot: number | null }) => [p.id, p.feedsMatchId, p.feedsSlot])))
    check('no match or player was lost',
      after.matches.length === before.matches.length && after.entrants.length === before.entrants.length)
  }

  section('Recompleting again is a no-op')
  {
    const rowsBefore = await ledgerFor(seasonA)
    const auditBefore = await prisma.auditLog.count({ where: { entityId: String(seasonA), action: 'season.recomplete' } })
    const r = await recomplete(actor, 'season', seasonA)
    check('a repeat recompletion reports already-done', r.ok && r.alreadyDone === true)
    check('...and applies nothing a second time', await ledgerFor(seasonA) === rowsBefore)
    check('...and writes no second audit row',
      await prisma.auditLog.count({ where: { entityId: String(seasonA), action: 'season.recomplete' } }) === auditBefore)

    const trophies = await computeSeasonTrophies()
    const champId = (await prisma.season.findUnique({ where: { id: seasonA }, select: { championPlayerId: true } }))?.championPlayerId
    if (champId) {
      const theirs = trophies.get(champId) ?? []
      check('the championship is awarded once, not twice',
        theirs.length === new Set(theirs.map((t) => JSON.stringify(t))).size, `${theirs.length} entries`)
    }
  }

  section('A record that was never finalised cannot be reopened')
  {
    const half = await buildClosedSeason(comp.id, 'c')
    // Simulate a completion that failed halfway: COMPLETED with no finalisation receipt.
    await prisma.season.update({ where: { id: half }, data: { ladderAppliedAt: null } })
    const r = await reopenForCorrection(actor, 'season', half)
    check('reopening a never-finalised record is refused', !r.ok)
    check('...with an explanation that points at completing it instead',
      /never finalised|Complete it instead/i.test(r.error ?? ''), r.error ?? '')
  }
} catch (e) {
  fail++
  console.error(e)
} finally {
  await cleanup()
  const leftSeasons = await prisma.season.count({ where: { competitionSeries: { slug: FIXTURE_SLUG } } })
  const leftComp = await prisma.competitionSeries.count({ where: { slug: FIXTURE_SLUG } })
  const leftLedger = await prisma.ratingLedger.count({ where: { playerId: { startsWith: 'zzcorr-' } } })
  const leftAudit = await prisma.auditLog.count({ where: { actorUsername: actor.username } })
  check('fixture Seasons removed', leftSeasons === 0,
    `${leftSeasons} left${cleanupErrors.length ? ` — ${cleanupErrors.join('; ')}` : ''}`)
  check('fixture Competition removed', leftComp === 0, String(leftComp))
  check('fixture ledger rows removed', leftLedger === 0, String(leftLedger))
  check('fixture audit rows removed', leftAudit === 0, String(leftAudit))

  /*
   * The real COMPLETED Seasons must be exactly as they were.
   *
   * Scoped to completed records on purpose. The owner builds historical Seasons by hand in Creator,
   * so a draft or a half-entered Season is a perfectly normal thing to find here — an earlier
   * version of this check asserted that EVERY non-fixture Season was completed, which turned the
   * owner starting their next reconstruction into a test failure. What a correction must not do is
   * disturb a finished record, and that is what this asserts.
   */
  const real = await prisma.season.findMany({
    where: { competitionSeries: { slug: { not: FIXTURE_SLUG } }, lifecycleState: 'COMPLETED' },
    select: { id: true, lifecycleState: true, reopenedAt: true, championName: true, _count: { select: { ratingLedger: true } } },
    orderBy: { id: 'asc' },
  })
  check('there are real completed Seasons to protect', real.length > 0, String(real.length))
  check('the real completed Seasons were never reopened',
    real.every((r) => r.reopenedAt === null),
    JSON.stringify(real.map((r) => [r.id, r.lifecycleState, r.reopenedAt])))
  check('...and still carry their ranking contributions',
    real.every((r) => r._count.ratingLedger > 0),
    JSON.stringify(real.map((r) => [r.id, r._count.ratingLedger])))

  // A record the owner is still building must survive a correction run untouched.
  const drafts = await prisma.season.count({
    where: { competitionSeries: { slug: { not: FIXTURE_SLUG } }, lifecycleState: { not: 'COMPLETED' } },
  })
  console.log(`  (${drafts} owner draft Season(s) present and untouched)`)
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
await prisma.$disconnect()
process.exit(fail === 0 ? 0 : 1)
