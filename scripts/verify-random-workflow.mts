/**
 * RANDOM-team workflow guards (DB): close-registration validation, reopen lock, manual-team-op
 * rejection, generation idempotency, and confirmation that non-RANDOM modes are unchanged. Self-cleans.
 *
 * Run:  npx tsx --tsconfig scripts/tsconfig.verify.json scripts/verify-random-workflow.mts
 */
import { prisma } from '../src/lib/prisma.ts'
import { transitionTournamentState } from '../src/lib/competition/tournament-lifecycle.ts'
import { assembleRandomTeams, createTeam, renameTeam, deleteTeam } from '../src/lib/competition/teams.ts'

let pass = 0, fail = 0
const check = (n: string, c: boolean, d = '') => { if (c) { pass++; console.log('  ✓ ' + n) } else { fail++; console.log('  ✗ ' + n + (d ? ` — ${d}` : '')) } }
const actor = { userId: 970001, username: 'rand-wf-verify' }

async function makeTournament(number: number, opts: { formation: 'RANDOM' | 'PICK'; size: number; players: number; state: string }) {
  const t = await prisma.tournament.create({
    data: {
      slug: `rand-wf-${number}`, name: `Rand WF ${number}`, competitionYear: new Date().getFullYear(), code: `RWF${number}`, number,
      tournamentFormat: 'SINGLE_ELIM', participantFormat: 'TEAM', teamSize: opts.size, teamFormation: opts.formation,
      lifecycleState: opts.state as never, registrationStatus: opts.state === 'REGISTRATION_OPEN' ? 'OPEN' : 'CLOSED', status: 'UPCOMING', playoffsStatus: 'PENDING',
    },
  })
  for (let i = 1; i <= opts.players; i++) {
    await prisma.registration.create({ data: { tournamentId: t.id, userId: number * 1000 + i, username: `WF${number}_${i}`, displayName: `WF ${i}`, cueverseId: `wf${number}_${i}`, playerId: `wf-${number}-${i}`, status: 'APPROVED' } })
  }
  return t.id
}
const cleanup = async (id: number) => {
  await prisma.tournament.delete({ where: { id } }).catch(() => {})
  await prisma.auditLog.deleteMany({ where: { actorUsername: actor.username } }).catch(() => {})
}

// 1) Close-registration validation for RANDOM.
async function testCloseGate() {
  console.log('\n--- RANDOM close-registration validation ---')
  const id = await makeTournament(9701, { formation: 'RANDOM', size: 2, players: 5, state: 'REGISTRATION_OPEN' })
  try {
    const blocked = await transitionTournamentState(actor, id, 'REGISTRATION_CLOSED')
    check('closing with an incomplete count is blocked', !blocked.ok)
    check('block message explains add/remove', /Add .* or remove|need the player count/.test(blocked.error || ''))
    await prisma.registration.create({ data: { tournamentId: id, userId: 9701999, username: 'WF9701_6', displayName: 'WF 6', cueverseId: 'wf9701_6', playerId: 'wf-9701-6', status: 'APPROVED' } })
    const ok = await transitionTournamentState(actor, id, 'REGISTRATION_CLOSED')
    check('closing with a complete count (6 → 3 teams) succeeds', ok.ok)
  } finally { await cleanup(id) }
}

// 2) Reopen lock for RANDOM once closed.
async function testReopenLock() {
  console.log('\n--- RANDOM reopen lock ---')
  const id = await makeTournament(9702, { formation: 'RANDOM', size: 2, players: 6, state: 'REGISTRATION_CLOSED' })
  try {
    const reopen = await transitionTournamentState(actor, id, 'REGISTRATION_OPEN')
    check('a closed RANDOM tournament cannot reopen registration', !reopen.ok)
  } finally { await cleanup(id) }
}

// 3) Manual team-management rejected on RANDOM (create / rename / delete).
async function testManualOpsRejected() {
  console.log('\n--- RANDOM manual team-op rejection ---')
  const id = await makeTournament(9703, { formation: 'RANDOM', size: 2, players: 4, state: 'REGISTRATION_CLOSED' })
  try {
    const create = await createTeam(actor, id, 'Illegal Manual Team')
    check('manual createTeam is rejected on RANDOM', !create.ok)

    const drawn = await assembleRandomTeams(actor, id)
    check('random draw succeeds (4 → 2 teams)', drawn.ok && drawn.teams === 2)
    const team = await prisma.tournamentTeam.findFirst({ where: { tournamentId: id } })
    const rn = await renameTeam(actor, team!.id, 'Renamed')
    check('manual renameTeam is rejected on RANDOM', !rn.ok)
    const del = await deleteTeam(actor, team!.id)
    check('manual deleteTeam is rejected on RANDOM', !del.ok)

    const again = await assembleRandomTeams(actor, id)
    check('re-generating is a no-op (never a second assignment)', again.ok && again.teams === 2)
  } finally { await cleanup(id) }
}

// 4) Non-RANDOM (PICK) modes are unchanged — manual team creation still works.
async function testPickUnchanged() {
  console.log('\n--- PICK mode unchanged ---')
  const id = await makeTournament(9704, { formation: 'PICK', size: 2, players: 0, state: 'REGISTRATION_OPEN' })
  try {
    const create = await createTeam(actor, id, 'Legit Pick Team')
    check('manual createTeam still works on a PICK tournament', create.ok)
    const rn = await renameTeam(actor, create.teamId!, 'Pick Renamed')
    check('manual renameTeam still works on a PICK tournament', rn.ok)
  } finally { await cleanup(id) }
}

await testCloseGate()
await testReopenLock()
await testManualOpsRejected()
await testPickUnchanged()
console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
// Deleting a Tournament directly leaves the derived snapshot cache listing one that no longer
// exists. The app's own delete action rebuilds it; a test that bypasses that action must too, or it
// leaves a phantom tournament behind for whatever runs next.
{
  const { regenerateTournamentSnapshot } = await import('../src/lib/tournaments/migrate.ts')
  await regenerateTournamentSnapshot().catch(() => {})
}
await prisma.$disconnect()
process.exit(fail === 0 ? 0 : 1)
