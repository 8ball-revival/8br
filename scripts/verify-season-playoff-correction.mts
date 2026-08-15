/**
 * Regression: Season playoff bye handling + winner-correction downstream rebuild.
 * Guards the fix for the bug where correcting a first-round result that changed the winner evicted the
 * bye-advanced player already seated in the next match, and where byes rendered/settled as "TBD".
 *
 * Run:  npx tsx --tsconfig scripts/tsconfig.verify.json scripts/verify-season-playoff-correction.mts
 */
import { prisma } from '../src/lib/prisma.ts'
import { createSeason, closeRegistration } from '../src/lib/seasons/service.ts'
import * as grp from '../src/lib/seasons/groups.ts'
import * as gs from '../src/lib/seasons/group-stage.ts'
import * as po from '../src/lib/seasons/playoffs.ts'

let pass = 0, fail = 0
const check = (n: string, c: boolean, d = '') => { if (c) { pass++; console.log('  ✓ ' + n) } else { fail++; console.log('  ✗ ' + n + (d ? ` — ${d}` : '')) } }
const actor = { userId: 990010, username: 'season-correct-verify' }
let seasonId = 0

async function cleanup() {
  if (seasonId) await prisma.season.delete({ where: { id: seasonId } }).catch(() => {})
  await prisma.auditLog.deleteMany({ where: { actorUsername: actor.username } }).catch(() => {})
}

try {
  // 6 synthetic players → 2 groups of 3 → all top-3 qualify → 6-player bracket = 8 slots, 2 byes (seeds 1 & 2).
  const c = await createSeason(actor, { lounge: 'Social', accessMode: 'OPEN' })
  const s = await prisma.season.findUnique({ where: { number: c.number! } })
  seasonId = s!.id
  const ratings = [900, 800, 700, 400, 300, 200]
  const ents = []
  for (let i = 0; i < 6; i++) ents.push(await prisma.seasonEntrant.create({ data: { seasonId, playerId: `scv-p${i + 1}`, username: `SCV${i + 1}`, displayName: `Player ${i + 1}`, cueverseId: `scv${i + 1}`, status: 'APPROVED' } }))
  await prisma.season.update({ where: { id: seasonId }, data: { entrantsCount: 6 } })
  await closeRegistration(actor, seasonId)
  for (let i = 0; i < 6; i++) await prisma.seasonEntrant.update({ where: { id: ents[i].id }, data: { ratingSnapshot: ratings[i] } })
  await grp.generateSeasonGroups(actor, seasonId, 2)
  await grp.publishSeasonGroups(actor, seasonId)
  for (const g of await prisma.seasonGroup.findMany({ where: { seasonId }, orderBy: { ordinal: 'asc' } })) {
    const rByEnt = new Map((await prisma.seasonEntrant.findMany({ where: { seasonId }, select: { id: true, ratingSnapshot: true } })).map((e) => [e.id, e.ratingSnapshot ?? 0]))
    const matches = await prisma.seasonMatch.findMany({ where: { groupId: g.id }, orderBy: { id: 'asc' } })
    await gs.saveSeasonGroupResults(actor, seasonId, g.id, matches.map((m) => {
      const hi = (rByEnt.get(m.homeEntrantId!) ?? 0) >= (rByEnt.get(m.awayEntrantId!) ?? 0)
      return { matchId: m.id, home: hi ? '7' : '3', away: hi ? '3' : '7', version: m.version }
    }))
  }
  await gs.closeSeasonGroups(actor, seasonId)
  await po.enterSeasonPlayoffSetup(actor, seasonId)
  await po.generateSeasonBracket(actor, seasonId)
  await po.startSeasonPlayoffs(actor, seasonId)

  const rows = () => prisma.seasonPlayoffMatch.findMany({ where: { seasonId }, orderBy: [{ round: 'asc' }, { slot: 'asc' }] })
  const r1 = await rows()

  // BYES: first-round byes are labeled 'Bye' (never null/TBD) and are COMPLETED with the seeded player advancing.
  const byeMatches = r1.filter((m) => m.round === 1 && (m.homeUsername === 'Bye' || m.awayUsername === 'Bye'))
  check('two first-round byes exist and are labeled "Bye"', byeMatches.length === 2, `${byeMatches.length}`)
  check('bye matches are auto-completed with a winner', byeMatches.every((m) => m.winnerEntrantId != null && m.status === 'COMPLETED'))
  check('no first-round slot is a null "phantom" opponent', !r1.some((m) => m.round === 1 && ((m.homeEntrantId == null && m.homeUsername == null) || (m.awayEntrantId == null && m.awayUsername == null))))

  // Pick a real (non-bye) first-round match, record it, note the downstream match + the sibling slot
  // that a bye winner already occupies.
  const realR1 = r1.find((m) => m.round === 1 && m.homeUsername !== 'Bye' && m.awayUsername !== 'Bye' && m.homeEntrantId && m.awayEntrantId)!
  const feedId = realR1.feedsMatchId!, feedSlot = realR1.feedsSlot ?? 0
  const before = await prisma.seasonPlayoffMatch.findUnique({ where: { id: feedId } })
  const siblingSlot = feedSlot === 0 ? 'away' : 'home'
  const siblingEntrantId = siblingSlot === 'home' ? before!.homeEntrantId : before!.awayEntrantId
  check('a bye winner is already seated in the downstream match sibling slot', siblingEntrantId != null, JSON.stringify({ feedId, siblingSlot }))

  // Record: home wins.
  const rec1 = await po.recordSeasonPlayoffResult(actor, realR1.id, 7, 3)
  check('first-round result records ok', rec1.ok, JSON.stringify(rec1))
  const afterFirst = await prisma.seasonPlayoffMatch.findUnique({ where: { id: feedId } })
  const seatedByFeed = feedSlot === 0 ? afterFirst!.homeEntrantId : afterFirst!.awayEntrantId
  check('winner advanced into the downstream feed slot', seatedByFeed === realR1.homeEntrantId)

  // CORRECT the result so the winner CHANGES (away wins). This must rebuild only the affected path and
  // MUST NOT evict the bye-advanced sibling.
  const rec2 = await po.recordSeasonPlayoffResult(actor, realR1.id, 3, 7, { confirmRebuild: true })
  check('winner-changing correction records ok', rec2.ok, JSON.stringify(rec2))
  const afterCorrect = await prisma.seasonPlayoffMatch.findUnique({ where: { id: feedId } })
  const siblingAfter = siblingSlot === 'home' ? afterCorrect!.homeEntrantId : afterCorrect!.awayEntrantId
  const feedAfter = feedSlot === 0 ? afterCorrect!.homeEntrantId : afterCorrect!.awayEntrantId
  check('bye-advanced sibling is PRESERVED after the correction', siblingAfter === siblingEntrantId, `${siblingAfter} vs ${siblingEntrantId}`)
  check('new winner is re-seated into the changed feed slot', feedAfter === realR1.awayEntrantId)
  check('the corrected match itself now reflects the new winner', (await prisma.seasonPlayoffMatch.findUnique({ where: { id: realR1.id } }))!.winnerEntrantId === realR1.awayEntrantId)
} finally {
  await cleanup()
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
await prisma.$disconnect()
process.exit(fail === 0 ? 0 : 1)
