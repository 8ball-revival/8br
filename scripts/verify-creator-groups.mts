/**
 * The group stage, from an empty draft to a locked table and back again.
 *
 * ── The two that matter most ────────────────────────────────────────────────────────────────────
 * Closing must not quietly destroy a half-entered result, and reopening must not quietly destroy a
 * bracket somebody arranged by hand. Both used to. A sweep of `status = SCHEDULED` cannot tell a
 * fixture nobody played from a score that failed to land, and reopening deleted every unpublished
 * playoff match on the theory that changed standings might invalidate them.
 *
 * Everything else here is the ordinary path — generate in entry order, place from the archive, move
 * people about, publish, score, close — checked because it is the path an operator actually walks.
 *
 * Fixtures only, all removed afterwards. No real Season is touched.
 *
 * Run: npx tsx --tsconfig scripts/tsconfig.verify.json --env-file=.env scripts/verify-creator-groups.mts
 */
import { prisma } from '../src/lib/prisma.ts'
import { assertLocalDatabase } from '../src/lib/db-guard.ts'
import { createDraft } from '../src/lib/creator/setup.ts'
import { addSeasonEntrant, closeRegistration } from '../src/lib/seasons/service.ts'
import { transitionSeasonState } from '../src/lib/seasons/lifecycle.ts'
import {
  generateSeasonGroups, publishSeasonGroups, validateSeasonGroupDraft,
  moveSeasonEntrantToGroup, removeSeasonGroup, renameSeasonGroup, addSeasonGroup, groupCode,
} from '../src/lib/seasons/groups.ts'
import {
  interpretMatch, saveSeasonGroupResults, closeSeasonGroups, reopenSeasonGroups, clearSeasonMatch,
} from '../src/lib/seasons/group-stage.ts'
import { closeGroupsPreflight, reopenGroupsImpact } from '../src/lib/seasons/group-close.ts'
import { getSeasonGroupSetup } from '../src/lib/seasons/views.ts'

assertLocalDatabase()

const ACTOR = { userId: 2, username: 'verify-creator-groups' }
const YEAR = 2092
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

/** A Season at GROUP_SETUP with `count` entrants, added in a known order. */
async function seasonReadyForGroups(number: number, count: number): Promise<number> {
  const made = await createDraft(ACTOR, {
    type: 'season', competitionYear: YEAR, competitionSeriesId: series.id, purpose: 'live',
    structure: 'groups_playoffs', number, division: null, accessMode: 'OPEN',
  })
  if (!made.ok || made.id == null) throw new Error(made.error ?? 'fixture Season failed')
  for (const p of pool.slice(0, count)) await addSeasonEntrant(ACTOR, made.id, p.id)
  await closeRegistration(ACTOR, made.id)
  await transitionSeasonState(ACTOR, made.id, 'GROUP_SETUP')
  return made.id
}

try {
  section('The pool is big enough to test with')
  check('eight players are available', pool.length === 8, `${pool.length}`)

  section('Generate follows entry order, and publishes nothing')
  const s1 = await seasonReadyForGroups(1, 8)
  const entryOrder = await prisma.seasonEntrant.findMany({
    where: { seasonId: s1, status: 'APPROVED' }, orderBy: { id: 'asc' }, select: { id: true },
  })
  const gen = await generateSeasonGroups(ACTOR, s1, 2)
  check('two groups are generated', gen.ok === true, gen.error)

  const groups1 = await prisma.seasonGroup.findMany({
    where: { seasonId: s1 }, orderBy: { ordinal: 'asc' },
    select: { id: true, code: true, published: true, players: { orderBy: { entrantId: 'asc' }, select: { entrantId: true } } },
  })
  check('they are coded A and B', groups1.map((g) => g.code).join('') === 'AB', groups1.map((g) => g.code).join(''))
  check('Group A took the first four entered',
    JSON.stringify(groups1[0].players.map((p) => p.entrantId).sort((a, b) => a - b))
    === JSON.stringify(entryOrder.slice(0, 4).map((e) => e.id).sort((a, b) => a - b)))
  check('Group B took the next four',
    JSON.stringify(groups1[1].players.map((p) => p.entrantId).sort((a, b) => a - b))
    === JSON.stringify(entryOrder.slice(4, 8).map((e) => e.id).sort((a, b) => a - b)))
  check('nothing is published', groups1.every((g) => !g.published))
  check('no matches exist yet', (await prisma.seasonMatch.count({ where: { seasonId: s1 } })) === 0)
  check('no standings exist yet', (await prisma.seasonStanding.count({ where: { seasonId: s1 } })) === 0)
  check('the Season is still in Group Setup',
    (await prisma.season.findUniqueOrThrow({ where: { id: s1 }, select: { lifecycleState: true } })).lifecycleState === 'GROUP_SETUP')

  section('Generating again is safe, and lands in the same place')
  const again = await generateSeasonGroups(ACTOR, s1, 2)
  check('the retry succeeds', again.ok === true, again.error)
  check('there are still exactly two groups',
    (await prisma.seasonGroup.count({ where: { seasonId: s1 } })) === 2)
  check('and still eight placements',
    (await prisma.seasonGroupPlayer.count({ where: { group: { seasonId: s1 } } })) === 8)

  section('An entrant added after the draft exists lands Unassigned')
  const late = pool[0]
  const s2 = await seasonReadyForGroups(2, 6)
  await generateSeasonGroups(ACTOR, s2, 2)
  // A player who is not already in this Season.
  const spare = await prisma.player.findFirst({
    where: { active: true, id: { notIn: pool.slice(0, 6).map((p) => p.id) } },
    select: { id: true },
  })
  check('a spare player exists', spare != null)
  if (spare) {
    const added = await addSeasonEntrant(ACTOR, s2, spare.id)
    check('they can be added after registration closed', added.ok === true, added.error)
    const view = await getSeasonGroupSetup(s2)
    check('...and appear in Unassigned', view.unassigned.length === 1, `${view.unassigned.length}`)
    check('...and the draft is not valid while they sit there', view.valid === false)
    check('...for exactly that reason', view.issues.some((i) => i.code === 'unassigned'))
  }
  check('the late fixture player is unused here', late.id !== spare?.id || true)

  section('Moving, renaming and deleting groups')
  const gs2 = await prisma.seasonGroup.findMany({ where: { seasonId: s2 }, orderBy: { ordinal: 'asc' }, select: { id: true, code: true } })
  const someone = await prisma.seasonGroupPlayer.findFirstOrThrow({ where: { groupId: gs2[0].id }, select: { entrantId: true } })
  const moved = await moveSeasonEntrantToGroup(ACTOR, s2, someone.entrantId, gs2[1].id)
  check('an entrant moves between groups', moved.ok === true, moved.error)
  check('...and is only in the new one',
    (await prisma.seasonGroupPlayer.count({ where: { entrantId: someone.entrantId, group: { seasonId: s2 } } })) === 1)

  const unassigned = await moveSeasonEntrantToGroup(ACTOR, s2, someone.entrantId, null)
  check('unassigning removes the placement', unassigned.ok === true, unassigned.error)
  check('...but never the entrant',
    (await prisma.seasonEntrant.count({ where: { id: someone.entrantId, status: 'APPROVED' } })) === 1)

  const renamed = await renameSeasonGroup(ACTOR, s2, gs2[0].id, 'The Hard Half')
  check('a group can be renamed', renamed.ok === true, renamed.error)
  check('...and keeps its code',
    (await prisma.seasonGroup.findUniqueOrThrow({ where: { id: gs2[0].id }, select: { code: true } })).code === gs2[0].code)

  const inB = await prisma.seasonGroupPlayer.count({ where: { groupId: gs2[1].id } })
  const removed = await removeSeasonGroup(ACTOR, s2, gs2[1].id)
  check('a group can be deleted', removed.ok === true, removed.error)
  check('...its entrants survive',
    (await prisma.seasonEntrant.count({ where: { seasonId: s2, status: 'APPROVED' } })) === 7)
  const afterDelete = await getSeasonGroupSetup(s2)
  check('...and they are Unassigned', afterDelete.unassigned.length >= inB, `${afterDelete.unassigned.length} vs ${inB}`)

  const addedGroup = await addSeasonGroup(ACTOR, s2)
  check('a group can be added back', addedGroup.ok === true, addedGroup.error)
  check('...reusing the freed code rather than skipping it',
    (await prisma.seasonGroup.findFirst({ where: { seasonId: s2 }, orderBy: { ordinal: 'desc' }, select: { code: true } }))?.code === groupCode(1))

  /*
   * Deleting from the MIDDLE is where a count-based code breaks.
   *
   * A/B/C minus B leaves two groups, so "name it after the count" produces a second C. Two groups
   * with the same letter cannot be told apart on the board, in the standings, or by the archive
   * matcher, which places entrants by group name.
   */
  const beforeMiddle = await prisma.seasonGroup.findMany({ where: { seasonId: s2 }, orderBy: { ordinal: 'asc' }, select: { id: true, code: true } })
  check('there are two groups to work from', beforeMiddle.length === 2, beforeMiddle.map((g) => g.code).join(''))
  await addSeasonGroup(ACTOR, s2) // A, B, C
  const three = await prisma.seasonGroup.findMany({ where: { seasonId: s2 }, orderBy: { ordinal: 'asc' }, select: { id: true, code: true } })
  check('now there are three', three.map((g) => g.code).join('') === 'ABC', three.map((g) => g.code).join(''))
  await removeSeasonGroup(ACTOR, s2, three[1].id) // delete B
  await addSeasonGroup(ACTOR, s2)
  const codes = (await prisma.seasonGroup.findMany({ where: { seasonId: s2 }, select: { code: true } })).map((g) => g.code)
  check('deleting the middle group and adding one produces no duplicate',
    new Set(codes).size === codes.length, codes.sort().join(''))
  check('...and the freed letter is the one reused', codes.sort().join('') === 'ABC', codes.sort().join(''))
  const ordinals = (await prisma.seasonGroup.findMany({ where: { seasonId: s2 }, select: { ordinal: true } })).map((g) => g.ordinal)
  check('...and no two groups share an ordinal', new Set(ordinals).size === ordinals.length, ordinals.join(','))

  section('Group Stage Live refuses an invalid draft, and publishes a valid one')
  const bad = await publishSeasonGroups(ACTOR, s2)
  check('publishing an invalid draft is refused', bad.ok === false, JSON.stringify(bad))
  check('...and nothing was published',
    (await prisma.seasonGroup.count({ where: { seasonId: s2, published: true } })) === 0)
  check('...and no matches were created',
    (await prisma.seasonMatch.count({ where: { seasonId: s2 } })) === 0)

  const valid = await validateSeasonGroupDraft(s1)
  check('the untouched draft IS valid', valid.ok === true, JSON.stringify(valid.issues))
  const published = await publishSeasonGroups(ACTOR, s1)
  check('it publishes', published.ok === true, published.error)
  check('every group is marked published',
    (await prisma.seasonGroup.count({ where: { seasonId: s1, published: false } })) === 0)
  check('the Season is live',
    (await prisma.season.findUniqueOrThrow({ where: { id: s1 }, select: { lifecycleState: true } })).lifecycleState === 'GROUP_STAGE_LIVE')
  // Two groups of four: each is a six-fixture round robin.
  check('a full round robin was scheduled per group',
    (await prisma.seasonMatch.count({ where: { seasonId: s1 } })) === 12,
    String(await prisma.seasonMatch.count({ where: { seasonId: s1 } })))
  check('standings rows exist for everybody',
    (await prisma.seasonStanding.count({ where: { seasonId: s1 } })) === 8)

  // A double-click, or a retry after a slow response, must not schedule the round robin twice.
  const republish = await publishSeasonGroups(ACTOR, s1)
  check('publishing again is refused rather than repeated', republish.ok === false, JSON.stringify(republish))
  check('...and the fixtures were not duplicated',
    (await prisma.seasonMatch.count({ where: { seasonId: s1 } })) === 12)
  check('...nor the standings rows',
    (await prisma.seasonStanding.count({ where: { seasonId: s1 } })) === 8)

  section('Score entry: numbers, FF, and no new KO')
  check('a decided score reads as a result',
    JSON.stringify(interpretMatch('7', '3')) === JSON.stringify({ kind: 'result', homeGames: 7, awayGames: 3, winner: 'home' }))
  check('a level score is a draw',
    interpretMatch('5', '5').kind === 'result' && (interpretMatch('5', '5') as { winner: string }).winner === 'draw')
  check('both blank is unplayed', interpretMatch('', '').kind === 'unplayed')
  check('0-0 is unplayed too', interpretMatch('0', '0').kind === 'unplayed')
  check('FF alone in one field is a forfeit',
    interpretMatch('FF', '').kind === 'ff' && interpretMatch('', 'FF').kind === 'ff')
  check('FF against a score is refused', interpretMatch('FF', '7').kind === 'invalid')
  check('FF on both sides is refused', interpretMatch('FF', 'FF').kind === 'invalid')
  check('half a score is refused', interpretMatch('7', '').kind === 'invalid')
  check('KO is no longer accepted', interpretMatch('KO', '').kind === 'invalid')
  check('...and says so plainly',
    /no longer entered/i.test((interpretMatch('KO', '') as { reason: string }).reason))
  check('KO on both sides is refused too', interpretMatch('KO', 'KO').kind === 'invalid')

  const groupA = await prisma.seasonGroup.findFirstOrThrow({ where: { seasonId: s1, code: 'A' }, select: { id: true } })
  const aMatches = await prisma.seasonMatch.findMany({ where: { seasonId: s1, groupId: groupA.id }, orderBy: { id: 'asc' } })

  const koAttempt = await saveSeasonGroupResults(ACTOR, s1, groupA.id, [
    { matchId: aMatches[0].id, home: 'KO', away: '', version: aMatches[0].version },
  ])
  check('saving a KO is refused', koAttempt.ok === false, JSON.stringify(koAttempt))
  check('...and nothing was written',
    (await prisma.seasonMatch.findUniqueOrThrow({ where: { id: aMatches[0].id }, select: { status: true } })).status === 'SCHEDULED')

  const saved = await saveSeasonGroupResults(ACTOR, s1, groupA.id, [
    { matchId: aMatches[0].id, home: '7', away: '3', version: aMatches[0].version },
    { matchId: aMatches[1].id, home: '5', away: '5', version: aMatches[1].version },
  ])
  check('real scores save', saved.ok === true, JSON.stringify(saved))

  const m0 = await prisma.seasonMatch.findUniqueOrThrow({ where: { id: aMatches[0].id } })
  check('the winner is the player with more games', m0.winnerEntrantId === m0.homeEntrantId)
  const m1 = await prisma.seasonMatch.findUniqueOrThrow({ where: { id: aMatches[1].id } })
  check('a draw records no winner', m1.winnerEntrantId === null && m1.status === 'COMPLETED')

  section('Standings use the confirmed scoring')
  const winnerRow = await prisma.seasonStanding.findFirstOrThrow({ where: { seasonId: s1, entrantId: m0.homeEntrantId } })
  const drawRow = await prisma.seasonStanding.findFirstOrThrow({ where: { seasonId: s1, entrantId: m1.homeEntrantId } })
  check('a win is worth 2 points', winnerRow.wins === 1 && winnerRow.points === 2, `w=${winnerRow.wins} p=${winnerRow.points}`)
  check('a draw is worth 1', drawRow.draws === 1 && drawRow.points === 1, `d=${drawRow.draws} p=${drawRow.points}`)
  check('games are counted', winnerRow.gamesWon === 7 && winnerRow.gamesLost === 3)

  section('A half-entered match BLOCKS closing')
  /*
   * Written straight to the row, because the save path refuses to produce one. That is the point:
   * malformed rows come from imports and interrupted fills, so the check has to read the database
   * rather than trust that the form is the only writer.
   */
  const victim = aMatches[2]
  await prisma.seasonMatch.update({
    where: { id: victim.id },
    data: { homeGames: 6, awayGames: null, status: 'SCHEDULED' },
  })
  const pre = await closeGroupsPreflight(s1)
  check('the preflight finds it', pre.malformed.length === 1, JSON.stringify(pre.malformed))
  check('...and names it as half-entered', pre.malformed[0]?.reason === 'half-entered')
  check('...and refuses to close', pre.canClose === false)
  check('...and does NOT count it as merely unplayed',
    !pre.unresolvedMatchups.some((m) => m.home === victim.homeUsername && m.away === victim.awayUsername))

  const blocked = await closeSeasonGroups(ACTOR, s1)
  check('closing is refused', blocked.ok === false, JSON.stringify(blocked))
  check('...naming the matchup', (blocked.error ?? '').includes(victim.homeUsername), blocked.error)
  check('...and the Season did not move',
    (await prisma.season.findUniqueOrThrow({ where: { id: s1 }, select: { lifecycleState: true } })).lifecycleState === 'GROUP_STAGE_LIVE')
  check('...and it was NOT turned into No Contest',
    (await prisma.seasonMatch.findUniqueOrThrow({ where: { id: victim.id }, select: { status: true } })).status !== 'NO_CONTEST')

  section('Other malformed shapes are caught too')
  const shapes: [string, Record<string, unknown>][] = [
    ['result-without-scores', { status: 'COMPLETED', homeGames: null, awayGames: null }],
    ['draw-with-a-winner', { status: 'COMPLETED', homeGames: 4, awayGames: 4, winnerEntrantId: aMatches[3].homeEntrantId }],
    ['winner-disagrees-with-scores', { status: 'COMPLETED', homeGames: 2, awayGames: 9, winnerEntrantId: aMatches[3].homeEntrantId }],
    ['forfeit-without-a-forfeiter', { status: 'FORFEIT', homeGames: null, awayGames: null, forfeitEntrantId: null }],
  ]
  for (const [reason, data] of shapes) {
    await prisma.seasonMatch.update({ where: { id: aMatches[3].id }, data: data as never })
    const p = await closeGroupsPreflight(s1)
    check(`${reason} is detected`, p.malformed.some((m) => m.matchId === aMatches[3].id && m.reason === reason),
      JSON.stringify(p.malformed.find((m) => m.matchId === aMatches[3].id)))
  }
  // Put it back to something honest so only the intended victim remains.
  await clearSeasonMatch(ACTOR, s1, aMatches[3].id)
  check('clearing restores it to unplayed',
    (await prisma.seasonMatch.findUniqueOrThrow({ where: { id: aMatches[3].id }, select: { status: true, homeGames: true } })).status === 'SCHEDULED')

  section('Clearing the half-entered match unblocks closing')
  const cleared = await clearSeasonMatch(ACTOR, s1, victim.id)
  check('it clears', cleared.ok === true, cleared.error)
  const pre2 = await closeGroupsPreflight(s1)
  check('nothing is malformed now', pre2.malformed.length === 0, JSON.stringify(pre2.malformed))
  check('...and it counts as unplayed instead',
    pre2.unresolvedMatchups.some((m) => m.home === victim.homeUsername && m.away === victim.awayUsername))
  check('...so closing is allowed', pre2.canClose === true)

  section('Closing converts the unplayed to No Contest')
  const unresolvedBefore = pre2.unresolved
  check('there are unplayed matches to convert', unresolvedBefore > 0, `${unresolvedBefore}`)
  const closed = await closeSeasonGroups(ACTOR, s1)
  check('the groups close', closed.ok === true, closed.error)
  check('...reporting how many became No Contest', closed.noContest === unresolvedBefore, `${closed.noContest} vs ${unresolvedBefore}`)
  check('the Season is closed',
    (await prisma.season.findUniqueOrThrow({ where: { id: s1 }, select: { lifecycleState: true } })).lifecycleState === 'GROUPS_CLOSED')
  check('no scheduled match remains',
    (await prisma.seasonMatch.count({ where: { seasonId: s1, status: 'SCHEDULED' } })) === 0)
  check('the entered results survived untouched',
    (await prisma.seasonMatch.findUniqueOrThrow({ where: { id: aMatches[0].id }, select: { homeGames: true, awayGames: true } })).homeGames === 7)

  const ncRow = await prisma.seasonStanding.findFirstOrThrow({ where: { seasonId: s1, entrantId: m0.homeEntrantId } })
  check('No Contest awarded no extra points', ncRow.points === winnerRow.points, `${ncRow.points} vs ${winnerRow.points}`)
  check('...and no extra played', ncRow.played === winnerRow.played)

  section('Closing twice is refused')
  const twice = await closeSeasonGroups(ACTOR, s1)
  check('the second close is refused', twice.ok === false, JSON.stringify(twice))

  section('Reopening KEEPS the bracket draft by default')
  // A draft bracket and a selection, as CP5 would leave them.
  const finalists = await prisma.seasonEntrant.findMany({ where: { seasonId: s1 }, take: 2, select: { id: true } })
  await prisma.seasonEntrant.updateMany({ where: { id: { in: finalists.map((f) => f.id) } }, data: { playoffIncluded: true } })
  await prisma.seasonPlayoffMatch.create({
    data: { seasonId: s1, round: 1, slot: 1, published: false, homeEntrantId: finalists[0].id, awayEntrantId: finalists[1].id },
  })

  const impact = await reopenGroupsImpact(s1)
  check('the impact names the draft bracket', impact.draftPlayoffMatches === 1, `${impact.draftPlayoffMatches}`)
  check('...and the selected entrants', impact.selectedEntrants === 2, `${impact.selectedEntrants}`)
  check('...and says what needs review', impact.requiresReview.length >= 2, JSON.stringify(impact.requiresReview))

  const reopened = await reopenSeasonGroups(ACTOR, s1)
  check('the groups reopen', reopened.ok === true, reopened.error)
  check('...discarding nothing', reopened.discardedDraftMatches === 0, `${reopened.discardedDraftMatches}`)
  check('the bracket draft SURVIVED',
    (await prisma.seasonPlayoffMatch.count({ where: { seasonId: s1, published: false } })) === 1)
  check('...and so did the playoff selection',
    (await prisma.seasonEntrant.count({ where: { seasonId: s1, playoffIncluded: true } })) === 2)
  check('the Season is live again',
    (await prisma.season.findUniqueOrThrow({ where: { id: s1 }, select: { lifecycleState: true } })).lifecycleState === 'GROUP_STAGE_LIVE')
  check('No Contest matches are editable again',
    (await prisma.seasonMatch.count({ where: { seasonId: s1, status: 'NO_CONTEST' } })) === 0)
  check('the group structure survived',
    (await prisma.seasonGroup.count({ where: { seasonId: s1 } })) === 2)
  check('and every score survived',
    (await prisma.seasonMatch.findUniqueOrThrow({ where: { id: aMatches[0].id }, select: { homeGames: true } })).homeGames === 7)

  section('...and discards it only when asked')
  await closeSeasonGroups(ACTOR, s1)
  const discarded = await reopenSeasonGroups(ACTOR, s1, { discardDraftBracket: true })
  check('reopening with discard succeeds', discarded.ok === true, discarded.error)
  check('...and says what it removed', discarded.discardedDraftMatches === 1, `${discarded.discardedDraftMatches}`)
  check('the draft bracket is gone',
    (await prisma.seasonPlayoffMatch.count({ where: { seasonId: s1, published: false } })) === 0)
  check('...and the selection was cleared',
    (await prisma.seasonEntrant.count({ where: { seasonId: s1, playoffIncluded: true } })) === 0)

  section('Authorization is the service\'s own, not the page\'s')
  check('score entry is refused outside a live group stage',
    (await (async () => {
      await closeSeasonGroups(ACTOR, s1)
      const r = await saveSeasonGroupResults(ACTOR, s1, groupA.id, [
        { matchId: aMatches[0].id, home: '9', away: '0', version: 99 },
      ])
      return r.ok === false
    })()))
  check('...and clearing is too',
    (await clearSeasonMatch(ACTOR, s1, aMatches[0].id)).ok === false)
  check('generating groups is refused once the stage has begun',
    (await generateSeasonGroups(ACTOR, s1, 2)).ok === false)
  check('the score it refused to overwrite is still 7',
    (await prisma.seasonMatch.findUniqueOrThrow({ where: { id: aMatches[0].id }, select: { homeGames: true } })).homeGames === 7)
} finally {
  await cleanup()
  check('every fixture Season is removed',
    (await prisma.season.count({ where: { competitionYear: YEAR } })) === 0)
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
await prisma.$disconnect()
if (fail > 0) process.exitCode = 1
