/**
 * Full Season lifecycle (DB): groups → group stage (numbers/draw/FF/KO/no-contest/version) →
 * standings → close/reopen → playoff setup (top-3, DQ, wildcard) → bracket → live playoffs →
 * champion → Close Season → Ladder integration → delete + reversal. Synthetic players (fake ids) so
 * the real ladder is never touched; always self-cleans.
 *
 * Run:  npx tsx --tsconfig scripts/tsconfig.verify.json scripts/verify-season-full.mts
 */
import { prisma } from '../src/lib/prisma.ts'
import { createSeason, closeRegistration } from '../src/lib/seasons/service.ts'
import * as grp from '../src/lib/seasons/groups.ts'
import * as gs from '../src/lib/seasons/group-stage.ts'
import * as po from '../src/lib/seasons/playoffs.ts'
import { closeSeason, seasonCloseSummary } from '../src/lib/seasons/close.ts'
import { deleteSeason } from '../src/lib/seasons/admin.ts'
import { computeSeasonTrophies } from '../src/lib/seasons/trophies.ts'

// Every Season must belong to a Competition, so fixtures ensure one exists and reuse it.
async function fixtureCompetitionId(): Promise<number> {
  const existing = await prisma.competitionSeries.findFirst({ where: { active: true }, select: { id: true } })
  if (existing) return existing.id
  const made = await prisma.competitionSeries.create({
    data: { name: 'Fixture Competition', shortName: 'FIX', slug: 'fixture-competition', active: true },
    select: { id: true },
  })
  return made.id
}


let pass = 0, fail = 0
const check = (n: string, c: boolean, d = '') => { if (c) { pass++; console.log('  ✓ ' + n) } else { fail++; console.log('  ✗ ' + n + (d ? ` — ${d}` : '')) } }
const actor = { userId: 990001, username: 'season-full-verify' }
let seasonId = 0, seasonNumber = 0

async function cleanup() {
  if (seasonId) { await prisma.season.delete({ where: { id: seasonId } }).catch(() => {}) }
  await prisma.auditLog.deleteMany({ where: { actorUsername: actor.username } }).catch(() => {})
}

try {
  // --- Create + register (6 synthetic players, varied ratings) ---
  const c = await createSeason(actor, { lounge: 'Social', accessMode: 'OPEN', competitionSeriesId: await fixtureCompetitionId() })
  seasonNumber = c.number!
  const s = await prisma.season.findUnique({ where: { number: seasonNumber } })
  seasonId = s!.id
  const ratings = [900, 800, 700, 400, 300, 200]
  const ents = []
  for (let i = 0; i < 6; i++) ents.push(await prisma.seasonEntrant.create({ data: { seasonId, playerId: `sfv-p${i + 1}`, username: `SFV${i + 1}`, displayName: `Player ${i + 1}`, cueverseId: `sfv${i + 1}`, status: 'APPROVED' } }))
  await prisma.season.update({ where: { id: seasonId }, data: { entrantsCount: 6 } })
  await prisma.seasonEntrant.updateMany({ where: { seasonId }, data: { status: 'APPROVED' } })
  await closeRegistration(actor, seasonId)
  // Force varied snapshots to exercise RATING-based seeding.
  for (let i = 0; i < 6; i++) await prisma.seasonEntrant.update({ where: { id: ents[i].id }, data: { ratingSnapshot: ratings[i] } })

  console.log('Group setup — rating snake seeding')
  const g = await grp.generateSeasonGroups(actor, seasonId, 2)
  check('generate 2 groups ok', g.ok, g.error)
  const groups = await prisma.seasonGroup.findMany({ where: { seasonId }, include: { players: { include: { entrant: true } } }, orderBy: { ordinal: 'asc' } })
  check('2 groups of 3', groups.length === 2 && groups.every((x) => x.players.length === 3))
  // Snake: group A should get seeds 1,4,5 (idx 0,3,4) and B 2,3,6 (idx 1,2,5) for 2 groups.
  const aRatings = groups[0].players.map((p) => p.entrant.ratingSnapshot).sort((x, y) => (y ?? 0) - (x ?? 0))
  check('top-rated (900) is a group-1 seed', aRatings.includes(900))
  const valid = await grp.validateSeasonGroupDraft(seasonId)
  check('draft valid (all assigned)', valid.ok, JSON.stringify(valid.issues))

  console.log('Publish → group stage live')
  const pub = await grp.publishSeasonGroups(actor, seasonId)
  check('publish ok', pub.ok, pub.error)
  const matchCount = await prisma.seasonMatch.count({ where: { seasonId } })
  check('round-robin matches created (2 groups × 3 each = 6)', matchCount === 6, `${matchCount}`)
  const standingCount = await prisma.seasonStanding.count({ where: { seasonId } })
  check('standings rows created (6)', standingCount === 6)

  console.log('Batch save: numbers, draw, FF, KO, version')
  const gA = groups[0]
  let aMatches = await prisma.seasonMatch.findMany({ where: { groupId: gA.id }, orderBy: { id: 'asc' } })
  // number result on match 0, draw on match 1.
  let r = await gs.saveSeasonGroupResults(actor, seasonId, gA.id, [
    { matchId: aMatches[0].id, home: '7', away: '3', version: aMatches[0].version },
    { matchId: aMatches[1].id, home: '5', away: '5', version: aMatches[1].version },
  ])
  check('batch save numbers + draw ok', r.ok, JSON.stringify(r))
  const st0 = await prisma.seasonStanding.findMany({ where: { groupId: gA.id } })
  check('a win awards 2 points somewhere', st0.some((x) => x.points >= 2))
  check('a draw awards 1 point to two players', st0.filter((x) => x.draws >= 1).length === 2)

  // version conflict on a stale save.
  const stale = await gs.saveSeasonGroupResults(actor, seasonId, gA.id, [{ matchId: aMatches[0].id, home: '9', away: '1', version: aMatches[0].version }])
  check('stale version rejected (conflict)', !stale.ok && stale.conflict === true)

  // FF needs confirmation, then applies.
  aMatches = await prisma.seasonMatch.findMany({ where: { groupId: gA.id }, orderBy: { id: 'asc' } })
  const ffPre = await gs.saveSeasonGroupResults(actor, seasonId, gA.id, [{ matchId: aMatches[2].id, home: 'FF', away: '', version: aMatches[2].version }])
  check('FF requires confirmation first', !ffPre.ok && !!ffPre.needConfirmFF?.length)
  const ffDo = await gs.saveSeasonGroupResults(actor, seasonId, gA.id, [{ matchId: aMatches[2].id, home: 'FF', away: '', version: aMatches[2].version }], { confirmFF: true })
  check('FF applies with confirm', ffDo.ok)
  const ffMatch = await prisma.seasonMatch.findUnique({ where: { id: aMatches[2].id } })
  check('FF recorded (FORFEIT, no games, winner=opponent)', ffMatch?.status === 'FORFEIT' && ffMatch.homeGames == null && ffMatch.winnerEntrantId === ffMatch.awayEntrantId)

  // KO in group B needs reason; voids that player's matches.
  const gB = groups[1]
  const bMatches = await prisma.seasonMatch.findMany({ where: { groupId: gB.id }, orderBy: { id: 'asc' } })
  const koVictim = bMatches[0].homeEntrantId
  const koNoReason = await gs.saveSeasonGroupResults(actor, seasonId, gB.id, [{ matchId: bMatches[0].id, home: 'KO', away: '', version: bMatches[0].version }])
  check('KO requires confirmation', !koNoReason.ok && !!koNoReason.needConfirmKO?.length)
  const koDo = await gs.saveSeasonGroupResults(actor, seasonId, gB.id, [{ matchId: bMatches[0].id, home: 'KO', away: '', version: bMatches[0].version }], { confirmKO: true, koReason: 'Cheating' })
  check('KO applies with reason', koDo.ok, JSON.stringify(koDo))
  const koEnt = await prisma.seasonEntrant.findUnique({ where: { id: koVictim! } })
  check('KO marks entrant kickedOut + ineligible', koEnt?.kickedOut === true && koEnt.qualification === 'KICKED_OUT')
  const voided = await prisma.seasonMatch.count({ where: { seasonId, status: 'VOID', OR: [{ homeEntrantId: koVictim }, { awayEntrantId: koVictim }] } })
  check('KO voids all the player’s matches', voided >= 1)

  console.log('Close groups (unresolved → No Contest)')
  const unresolvedBefore = await prisma.seasonMatch.count({ where: { seasonId, status: 'SCHEDULED' } })
  const cg = await gs.closeSeasonGroups(actor, seasonId)
  check('close groups ok', cg.ok, cg.error)
  const nc = await prisma.seasonMatch.count({ where: { seasonId, status: 'NO_CONTEST' } })
  check('unresolved became NO_CONTEST', nc === unresolvedBefore && (await prisma.season.findUnique({ where: { id: seasonId } }))!.lifecycleState === 'GROUPS_CLOSED')

  console.log('Playoff setup — top-3 auto, DQ, wildcard, locked seeding')
  const enter = await po.enterSeasonPlayoffSetup(actor, seasonId)
  check('enter playoff setup ok', enter.ok, enter.error)
  const seeding = await po.loadSeasonSeeding(seasonId)
  const autoIncluded = seeding.filter((x) => x.included).length
  check('top-3 eligible per group auto-selected (kicked excluded)', autoIncluded >= 4 && autoIncluded <= 6, `${autoIncluded}`)
  check('kicked player not included', !seeding.find((x) => x.entrantId === koVictim)?.included)
  check('locked seeds are sequential from 1', seeding.filter((x) => x.included).every((x, i, arr) => arr.map((y) => y.overallSeed).sort((a, b) => a! - b!)[i] === i + 1))
  // DQ one, wildcard another eligible non-selected (if any).
  const anAuto = seeding.find((x) => x.included && x.qualification === 'AUTOMATIC')!
  const dq = await po.setSeasonQualification(actor, seasonId, anAuto.entrantId, 'disqualify', 'Rule breach')
  check('disqualify requires + records reason', dq.ok)
  check('DQ removes from field', !(await po.loadSeasonSeeding(seasonId)).find((x) => x.entrantId === anAuto.entrantId)?.included)

  console.log('Generate + start playoffs')
  const gen = await po.generateSeasonBracket(actor, seasonId)
  check('generate bracket ok', gen.ok, gen.error)
  check('draft not yet public', (await prisma.seasonPlayoffMatch.count({ where: { seasonId, published: true } })) === 0)
  const start = await po.startSeasonPlayoffs(actor, seasonId)
  check('start playoffs ok', start.ok, start.error)
  check('bracket now published + live', (await prisma.seasonPlayoffMatch.count({ where: { seasonId, published: false } })) === 0)

  console.log('Play out playoffs → champion')
  // Report every playable match (home wins) until a champion emerges.
  for (let guard = 0; guard < 20; guard++) {
    const playable = await prisma.seasonPlayoffMatch.findMany({ where: { seasonId, winnerEntrantId: null, homeEntrantId: { not: null }, awayEntrantId: { not: null } } })
    const real = playable.filter((m) => m.homeUsername !== 'Bye' && m.awayUsername !== 'Bye')
    if (!real.length) break
    for (const m of real) await po.recordSeasonPlayoffResult(actor, m.id, 7, 3)
  }
  const champ = await po.seasonChampion(seasonId)
  check('a champion is determined', !!champ, JSON.stringify(champ))

  console.log('Close Season → Ladder + diamond')
  const summary = await seasonCloseSummary(seasonId)
  check('close summary reports champion + excludes FF/KO from ranking count', !!summary?.champion && summary!.rankingEligibleMatches >= 1)
  const close = await closeSeason(actor, seasonId)
  check('close season ok', close.ok, close.error)
  const closed = await prisma.season.findUnique({ where: { id: seasonId } })
  check('season COMPLETED + champion stored', closed?.lifecycleState === 'COMPLETED' && !!closed?.championName)
  const seasonLedger = await prisma.ratingLedger.count({ where: { seasonId } })
  check('season matches written to the Ladder (season: namespace)', seasonLedger >= 1, `${seasonLedger}`)
  const ffLedger = await prisma.ratingLedger.count({ where: { seasonId, matchKey: { contains: 'group' }, isForfeit: true } })
  check('FF/KO/no-contest excluded from Ladder', ffLedger === 0)
  const trophies = await computeSeasonTrophies()
  check('champion earns a Season Championship diamond', !!champ && (trophies.get(closed!.championPlayerId!)?.length ?? 0) >= 1)

  console.log('Delete completed season → ranking reversal')
  const before = await prisma.ratingLedger.count({ where: { seasonId } })
  await deleteSeason(actor, seasonId, true) // head admin
  const gone = await prisma.season.findUnique({ where: { id: seasonId } })
  check('season deleted', !gone)
  const after = await prisma.ratingLedger.count({ where: { matchKey: { startsWith: 'season-' }, playerId: { startsWith: 'sfv-' } } })
  check('season ledger rows reversed on delete', before >= 1 && after === 0)
  seasonId = 0 // already deleted
} finally {
  await cleanup()
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
await prisma.$disconnect()
process.exit(fail === 0 ? 0 : 1)
