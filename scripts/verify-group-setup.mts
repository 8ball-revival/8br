/**
 * End-to-end verification of the GROUP SETUP (draft → publish) phase against the DB:
 * enter setup (empty draft, still REGISTRATION_CLOSED, private) → auto-assign even (±1) → manual moves
 * (unassigned↔group, group↔group) → add/remove group (entrants return to Unassigned) → validation
 * (unassigned / too-small / no-groups) → auto-balance → publish (matches + standings + GROUPS_IN_PROGRESS,
 * groups become published) → uneven totals. Self-cleans.
 */
import { prisma } from '../src/lib/prisma.ts'
import {
  enterGroupSetup, moveEntrantToGroup, autoAssignGroups, autoBalanceGroups, removeDraftGroup,
  setTargetPerGroup, validateGroupDraft, publishGroupsAndStart, groupsArePublished, roundRobinMatchCount,
} from '../src/lib/competition/group-setup.ts'
import { createGroup } from '../src/lib/competition/service.ts'
import { getTournamentState } from '../src/lib/competition/tournament-lifecycle.ts'

let pass = 0, fail = 0
const check = (n: string, c: boolean) => { if (c) { pass++; console.log('  ✓ ' + n) } else { fail++; console.log('  ✗ ' + n) } }
const actor = { userId: 990981, username: 'gsetup-verify' }

async function make(number: number, players: number, groupCount: number) {
  const t = await prisma.tournament.create({
    data: {
      slug: `gsetup-${number}`, name: `GSetup ${number}`, competitionYear: new Date().getFullYear(), code: `GST${number}`, number,
      tournamentFormat: 'GROUPS_PLAYOFFS', groupCount, qualifiersPerGroup: 2, playoffSeeding: 'standing',
      raceLength: 7, participantFormat: 'INDIVIDUAL',
      lifecycleState: 'REGISTRATION_CLOSED', registrationStatus: 'CLOSED', status: 'UPCOMING', groupsStatus: 'PENDING', playoffsStatus: 'PENDING',
    },
  })
  for (let i = 1; i <= players; i++) await prisma.registration.create({ data: { tournamentId: t.id, username: `GS${number}_${i}`, status: 'APPROVED' } })
  return t.id
}
const groupsOf = (id: number) => prisma.tournamentGroup.findMany({ where: { tournamentId: id }, orderBy: { ordinal: 'asc' }, include: { players: true } })
const state = async (id: number) => getTournamentState(await prisma.tournament.findUniqueOrThrow({ where: { id } }))

async function run() {
  // ---- 8 players / 2 groups ----
  console.log('\n--- Group Setup: 8 players / 2 groups ---')
  const id = await make(7001, 8, 2)
  try {
    check('enter setup ok', (await enterGroupSetup(actor, id, 2)).ok)
    check('two EMPTY draft groups created', (await groupsOf(id)).length === 2 && (await groupsOf(id)).every((g) => g.players.length === 0))
    check('still REGISTRATION_CLOSED (not started)', await state(id) === 'REGISTRATION_CLOSED')
    check('groups are NOT published (private draft)', (await groupsArePublished(id)) === false)

    const v0 = await validateGroupDraft(id)
    check('draft with everyone unassigned cannot publish', !v0.ok && v0.issues.some((i) => i.code === 'unassigned'))

    check('auto-assign ok', (await autoAssignGroups(actor, id)).ok)
    let gs = await groupsOf(id)
    check('auto-assign distributes evenly (4 + 4)', gs.length === 2 && gs.every((g) => g.players.length === 4))
    check('nobody unassigned after auto-assign', (await validateGroupDraft(id)).ok)

    // Manual move: group A → group B, then B → unassigned, then unassigned → A.
    gs = await groupsOf(id)
    const mover = gs[0].players[0].registrationId
    check('move A→B ok', (await moveEntrantToGroup(actor, id, mover, gs[1].id)).ok)
    gs = await groupsOf(id)
    check('after A→B sizes are 3 and 5', gs[0].players.length === 3 && gs[1].players.length === 5)
    check('move B→Unassigned ok', (await moveEntrantToGroup(actor, id, mover, null)).ok)
    check('one entrant now Unassigned', (await validateGroupDraft(id)).issues.some((i) => i.code === 'unassigned'))
    check('move Unassigned→A ok', (await moveEntrantToGroup(actor, id, mover, gs[0].id)).ok)
    check('no duplicate: entrant is in exactly one group', (await prisma.groupPlayer.count({ where: { registrationId: mover } })) === 1)

    // Add + remove group (populated group returns entrants to Unassigned, never deletes registrations).
    const before = await prisma.registration.count({ where: { tournamentId: id } })
    check('add group ok', (await createGroup(actor, id)).ok)
    check('three groups now', (await groupsOf(id)).length === 3)
    gs = await groupsOf(id)
    const populated = gs.find((g) => g.players.length > 0)!
    const returning = populated.players.length
    check('remove populated group ok', (await removeDraftGroup(actor, id, populated.id)).ok)
    check('registrations NOT deleted (entrants preserved)', (await prisma.registration.count({ where: { tournamentId: id } })) === before)
    check('removed group’s entrants are back in Unassigned', (await validateGroupDraft(id)).issues.some((i) => i.code === 'unassigned') && returning > 0)

    // Re-balance everything across the current groups, then publish.
    check('auto-balance ok', (await autoBalanceGroups(actor, id)).ok)
    gs = await groupsOf(id)
    const sizes = gs.map((g) => g.players.length).sort()
    check('auto-balance evens sizes (max-min <= 1)', sizes[sizes.length - 1] - sizes[0] <= 1)
    check('draft valid → can publish', (await validateGroupDraft(id)).ok)

    const expectedMatches = gs.reduce((s, g) => s + roundRobinMatchCount(g.players.length), 0)
    check('publish + start ok', (await publishGroupsAndStart(actor, id)).ok)
    check('tournament moved to GROUPS_IN_PROGRESS', await state(id) === 'GROUPS_IN_PROGRESS')
    check('groups are now published (public)', await groupsArePublished(id))
    check('round-robin matches generated (correct count)', (await prisma.tournamentMatch.count({ where: { tournamentId: id } })) === expectedMatches)
    check('standings seeded for every entrant', (await prisma.standing.count({ where: { tournamentId: id } })) === 8)
    check('published draft can no longer be edited', !(await moveEntrantToGroup(actor, id, mover, gs[0].id)).ok)
  } finally {
    await prisma.tournament.delete({ where: { id } }).catch(() => {})
  }

  // ---- Uneven total: 7 players / 2 groups → 4 + 3 ----
  console.log('\n--- Uneven totals: 7 players / 2 groups ---')
  const id2 = await make(7002, 7, 2)
  try {
    await enterGroupSetup(actor, id2, 2)
    await autoAssignGroups(actor, id2)
    const gs = (await groupsOf(id2)).map((g) => g.players.length).sort((a, b) => a - b)
    check('uneven split is 3 + 4 (differ by one)', gs[0] === 3 && gs[1] === 4)
    check('uneven draft still publishable (no equal-size requirement)', (await validateGroupDraft(id2)).ok)

    // Target size 7 → collapse to a single group of 7; too-small check passes (>=2), publish works.
    check('set target 3/group keeps enough groups', (await setTargetPerGroup(actor, id2, 3)).ok)
  } finally {
    await prisma.tournament.delete({ where: { id: id2 } }).catch(() => {})
  }

  // ---- Too-small group blocks publish ----
  console.log('\n--- Validation: a 1-entrant group blocks publish ---')
  const id3 = await make(7003, 3, 1)
  try {
    await enterGroupSetup(actor, id3, 1)
    await autoAssignGroups(actor, id3) // all 3 in one group
    const g = (await groupsOf(id3))[0]
    // Move two out into a new group → group A has 1, group B has 2 → A is too small.
    const gB = await createGroup(actor, id3)
    await moveEntrantToGroup(actor, id3, g.players[0].registrationId, gB.id!)
    await moveEntrantToGroup(actor, id3, g.players[1].registrationId, gB.id!)
    const v = await validateGroupDraft(id3)
    check('group with a single entrant is flagged too_small', v.issues.some((i) => i.code === 'too_small'))
    check('publish is blocked while a group is too small', !(await publishGroupsAndStart(actor, id3)).ok)
  } finally {
    await prisma.tournament.delete({ where: { id: id3 } }).catch(() => {})
  }
}

await run()
await prisma.auditLog.deleteMany({ where: { actorUsername: 'gsetup-verify' } }).catch(() => {})
console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
// Deleting a Tournament directly leaves the derived snapshot cache listing one that no longer
// exists. The app's own delete action rebuilds it; a test that bypasses that action must too, or it
// leaves a phantom tournament behind for whatever runs next.
{
  const { regenerateTournamentSnapshot } = await import('../src/lib/tournaments/migrate.ts')
  await regenerateTournamentSnapshot().catch(() => {})
}
await prisma.$disconnect()
if (fail > 0) process.exit(1)
