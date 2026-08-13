/**
 * Verifies Free Agents + the registration-close allocator for player-selected team tournaments:
 * one-state enforcement, free-agent register/withdraw/convert, admin roster ops (create/add/remove/
 * replace), the DETERMINISTIC closing plan across 2v2–6v6 (exact divisions, leftovers, incomplete
 * fills, still-incomplete, tie-breaks), pure-preview (cancel changes nothing), one-transaction apply
 * with NOT_PLACED retention, idempotent re-apply, and simultaneous-registration safety. Self-cleans.
 *
 * Run:  npx tsx --tsconfig scripts/tsconfig.verify.json scripts/verify-free-agents.mts
 */
import { prisma } from '../src/lib/prisma.ts'
import { startTeam, joinTeam, getMyTeamMembership } from '../src/lib/competition/teams.ts'
import { registerFreeAgent, withdrawFreeAgent, getMyFreeAgent, listFreeAgents, listEligibleAccounts, adminCreateTeamWithPlayers, adminAddMember, adminRemoveMember, adminReplaceMember, computeClosingPlan, applyClosingPlan, accountIdentity } from '../src/lib/competition/free-agents.ts'

let pass = 0, fail = 0
const check = (n: string, c: boolean) => { if (c) { pass++; console.log('  ✓ ' + n) } else { fail++; console.log('  ✗ ' + n) } }
const admin = { userId: 990001, username: 'fa-admin' }
const U = (u: number) => ({ userId: u, username: `fa${u}` })

// Test accounts (real Player rows so accountIdentity/eligibility work).
const BASE = 900000
const ids: number[] = []
for (let i = 1; i <= 60; i++) {
  const uid = BASE + i
  ids.push(uid)
  await prisma.player.upsert({ where: { linkedUserId: String(uid) }, update: {}, create: { primaryName: `FA${i}`, cueverseId: `fa${i}`, active: true, linkedUserId: String(uid) } })
}
const idn = (uid: number) => accountIdentity(uid)

let seq = 0
async function freshTournament(teamSize: number) {
  seq++
  return prisma.tournament.create({
    data: { slug: `fa-verify-${seq}`, name: `FA Verify ${seq}`, code: `FAV${seq}`, number: 92000 + seq, tournamentFormat: 'SINGLE_ELIM', participantFormat: 'TEAM', teamSize, teamFormation: 'PICK', lifecycleState: 'REGISTRATION_OPEN', registrationStatus: 'OPEN', status: 'UPCOMING', playoffsStatus: 'PENDING' } })
}
const cleanup: number[] = []
async function fresh(teamSize: number) { const t = await freshTournament(teamSize); cleanup.push(t.id); return t.id }

try {
  // ---- One-state enforcement + free-agent transitions ----
  {
    const tid = await fresh(3)
    check('register as free agent', (await registerFreeAgent(U(ids[0]), tid, (await idn(ids[0]))!)).ok)
    check('cannot register as free agent twice', !(await registerFreeAgent(U(ids[0]), tid, (await idn(ids[0]))!)).ok)
    await startTeam(U(ids[1]), tid, 'Alpha', { userId: ids[1], playerId: `fa2p`, name: 'FA2', handle: 'fa2' }, null)
    check('team captain cannot also be a free agent', !(await registerFreeAgent(U(ids[1]), tid, (await idn(ids[1]))!)).ok)
    const alpha = (await prisma.tournamentTeam.findFirstOrThrow({ where: { tournamentId: tid, name: 'Alpha' } })).id
    check('free agent converts by joining a team', (await joinTeam(U(ids[0]), tid, alpha, (await idn(ids[0]))!, null)).ok)
    check('free-agent row is gone after joining', (await getMyFreeAgent(ids[0], tid)) === null)
    check('joined player is now on the team', (await getMyTeamMembership(ids[0], tid))?.name === 'Alpha')
    check('cannot withdraw as free agent once converted', !(await withdrawFreeAgent(U(ids[0]), tid)).ok)
    await registerFreeAgent(U(ids[2]), tid, (await idn(ids[2]))!)
    check('free agent can withdraw while open', (await withdrawFreeAgent(U(ids[2]), tid)).ok && (await getMyFreeAgent(ids[2], tid)) === null)
  }

  // ---- Admin roster management ----
  {
    const tid = await fresh(3)
    const [a, b, c, d, e] = ids
    const elig0 = await listEligibleAccounts(tid)
    check('eligible list includes unregistered accounts', elig0.some((x) => x.userId === a) && elig0.some((x) => x.userId === b))
    check('admin creates a team with selected players', (await adminCreateTeamWithPlayers(admin, tid, 'Squad', [a, b])).ok)
    const squad = (await prisma.tournamentTeam.findFirstOrThrow({ where: { tournamentId: tid, name: 'Squad' } })).id
    const elig1 = await listEligibleAccounts(tid)
    check('registered players drop out of the eligible list', !elig1.some((x) => x.userId === a) && !elig1.some((x) => x.userId === b))
    check('admin adds a player to an open slot', (await adminAddMember(admin, tid, squad, c)).ok)
    check('adding to a full team is rejected', !(await adminAddMember(admin, tid, squad, d)).ok)
    check('adding an already-registered player is rejected', !(await adminAddMember(admin, tid, squad, a)).ok)
    check('admin removes one player without deleting the team', (await adminRemoveMember(admin, tid, squad, b)).ok)
    check('team still exists after removal', (await prisma.tournamentTeam.count({ where: { id: squad, withdrawn: false } })) === 1)
    check('removing the captain promotes another member', (await adminRemoveMember(admin, tid, squad, a)).ok && (await getMyTeamMembership(c, tid))?.isCaptain === true)
    check('admin replaces a member with an eligible account', (await adminReplaceMember(admin, tid, squad, c, e)).ok && (await getMyTeamMembership(e, tid))?.isCaptain === true)
  }

  // ---- Closing plan across 2v2 .. 6v6 ----
  async function planWith(teamSize: number, incompleteRosters: number[], nFreeAgents: number) {
    const tid = await fresh(teamSize)
    let cursor = 0
    // Build incomplete existing teams with the given current roster sizes.
    for (let i = 0; i < incompleteRosters.length; i++) {
      const members = ids.slice(cursor, cursor + incompleteRosters[i]); cursor += incompleteRosters[i]
      await adminCreateTeamWithPlayers(admin, tid, `T${i + 1}`, members)
    }
    // Register free agents.
    for (let i = 0; i < nFreeAgents; i++) { const uid = ids[cursor++]; await registerFreeAgent(U(uid), tid, (await idn(uid))!) }
    const res = await computeClosingPlan(tid)
    return { tid, plan: res.plan! }
  }

  {
    // 3v3 exact division: 6 free agents, no teams → 2 new teams, 0 unplaced.
    const { plan } = await planWith(3, [], 6)
    check('3v3 exact: 2 new teams, 0 unplaced', plan.newTeams.length === 2 && plan.unplaced.length === 0 && plan.finalTeams === 2)
    check('new team captain is the earliest-registered agent', plan.newTeams[0].captainUserId === plan.newTeams[0].members[0].userId)
  }
  {
    // 3v3 leftover: 7 free agents → 2 new teams, 1 unplaced.
    const { plan } = await planWith(3, [], 7)
    check('3v3 leftover: 2 new teams, 1 unplaced', plan.newTeams.length === 2 && plan.unplaced.length === 1)
  }
  {
    // 3v3 fill incomplete then form a team: one 2/3 team + 4 FAs → fill (1) + 1 new team (3), 0 unplaced.
    const { plan } = await planWith(3, [2], 4)
    check('3v3 fill: 1 incomplete filled + 1 new team, 0 unplaced', plan.fills.length === 1 && plan.fills[0].deficit === 1 && plan.newTeams.length === 1 && plan.unplaced.length === 0)
    check('3v3 fill: final team count = 2', plan.finalTeams === 2)
  }
  {
    // 4v4 spec example: existing teams complete; 3 free agents remain → 0 new teams, 3 named unplaced.
    const { plan } = await planWith(4, [4], 3) // a 4/4 team (already complete) + 3 FAs
    check('4v4: no new team, 3 free agents unplaced', plan.newTeams.length === 0 && plan.unplaced.length === 3)
    check('4v4: unplaced players are named', plan.unplaced.every((u) => !!u.name))
    check('4v4: final count = the one complete existing team', plan.finalTeams === 1)
  }
  {
    // 5v5 still-incomplete: a 3/5 team (deficit 2) + 1 FA → cannot fill; still incomplete, 1 unplaced.
    const { plan } = await planWith(5, [3], 1)
    check('5v5 still-incomplete team reported', plan.stillIncomplete.length === 1 && plan.stillIncomplete[0].needed === 5)
    check('5v5 leftover agent unplaced', plan.unplaced.length === 1 && plan.finalTeams === 0)
  }
  {
    // 2v2 + 6v6 divisions.
    const two = (await planWith(2, [], 5)).plan
    check('2v2: 5 FAs → 2 teams, 1 unplaced', two.newTeams.length === 2 && two.unplaced.length === 1)
    const six = (await planWith(6, [], 13)).plan
    check('6v6: 13 FAs → 2 teams, 1 unplaced', six.newTeams.length === 2 && six.unplaced.length === 1)
  }
  {
    // Maximize completions: two 2/3 teams + one 1/3 team + 3 FAs → complete the two cheapest, 1 unplaced.
    const { plan } = await planWith(3, [2, 2, 1], 3)
    check('maximizes completions (2 fills, deepest-deficit team left incomplete)', plan.fills.length === 2 && plan.stillIncomplete.length === 1 && plan.unplaced.length === 1)
  }

  // ---- Cancel = pure preview (nothing changes) + apply + idempotency ----
  {
    const { tid, plan } = await planWith(3, [2], 4)
    const teamsBefore = await prisma.tournamentTeam.count({ where: { tournamentId: tid } })
    const faBefore = await prisma.tournamentFreeAgent.count({ where: { tournamentId: tid, status: 'WAITING' } })
    await computeClosingPlan(tid); await computeClosingPlan(tid) // re-preview
    const teamsAfterPreview = await prisma.tournamentTeam.count({ where: { tournamentId: tid } })
    check('preview is pure — re-previewing changes nothing', teamsAfterPreview === teamsBefore && faBefore === 4)

    const applied = await applyClosingPlan(admin, tid)
    check('apply closes registration + returns the plan', applied.ok && applied.plan!.finalTeams === 2)
    const t = await prisma.tournament.findUniqueOrThrow({ where: { id: tid } })
    check('registration is CLOSED after apply', t.registrationStatus === 'CLOSED' && t.lifecycleState === 'REGISTRATION_CLOSED')
    const newTeamCount = await prisma.tournamentTeam.count({ where: { tournamentId: tid, withdrawn: false } })
    check('new free-agent team created + incomplete team filled', newTeamCount === 2)
    check('all free agents marked PLACED (none left WAITING)', (await prisma.tournamentFreeAgent.count({ where: { tournamentId: tid, status: 'WAITING' } })) === 0)
    check('free agents retained (not deleted) with PLACED status', (await prisma.tournamentFreeAgent.count({ where: { tournamentId: tid, status: 'PLACED' } })) === 4)

    // Idempotent retry: no duplicate teams.
    const retry = await applyClosingPlan(admin, tid)
    check('re-applying is a safe no-op (already closed)', !retry.ok)
    check('no duplicate teams created on retry', (await prisma.tournamentTeam.count({ where: { tournamentId: tid } })) === newTeamCount)
  }
  {
    // NOT_PLACED retention.
    const { tid } = await planWith(4, [4], 3)
    await applyClosingPlan(admin, tid)
    check('unplaced free agents retained as NOT_PLACED', (await prisma.tournamentFreeAgent.count({ where: { tournamentId: tid, status: 'NOT_PLACED' } })) === 3)
  }

  // ---- Simultaneous registration safety ----
  {
    const tid = await fresh(3)
    const uid = ids[0]
    const results = await Promise.allSettled([registerFreeAgent(U(uid), tid, (await idn(uid))!), registerFreeAgent(U(uid), tid, (await idn(uid))!)])
    const okCount = results.filter((r) => r.status === 'fulfilled' && r.value.ok).length
    check('simultaneous free-agent registration → exactly one succeeds', okCount === 1)
    check('only one free-agent row exists', (await prisma.tournamentFreeAgent.count({ where: { tournamentId: tid, userId: uid } })) === 1)
  }
} finally {
  await prisma.tournament.deleteMany({ where: { id: { in: cleanup } } }).catch(() => {})
  await prisma.player.deleteMany({ where: { linkedUserId: { in: ids.map(String) } } }).catch(() => {})
  await prisma.auditLog.deleteMany({ where: { actorUsername: { startsWith: 'fa' } } }).catch(() => {})
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
await prisma.$disconnect()
process.exit(fail === 0 ? 0 : 1)
