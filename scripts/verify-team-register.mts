/**
 * End-to-end verification of the MyLeague-style create-then-join team registration (teamFormation
 * = PICK): start open + protected teams, join both, wrong codes, full teams, duplicate names
 * (case-insensitive), duplicate player registration, member + captain withdrawals (promotion +
 * disband), captain removals, incomplete-team marking, roster locking at close, join-code
 * set/change/remove, server-side authorization, and that join codes never reach history. Cleans up.
 *
 * Run:  npx tsx --tsconfig scripts/tsconfig.verify.json scripts/verify-team-register.mts
 */
import { prisma } from '../src/lib/prisma.ts'
import { startTeam, joinTeam, listJoinableTeams, getMyTeamMembership, withdrawFromTeam, removeTeamMember, setTeamJoinCode, excludeIncompletePickTeams } from '../src/lib/competition/teams.ts'

let pass = 0, fail = 0
const check = (n: string, c: boolean) => { if (c) { pass++; console.log('  ✓ ' + n) } else { fail++; console.log('  ✗ ' + n) } }

const U = (u: number) => ({ userId: u, username: `u${u}` })
const ID = (u: number) => ({ userId: u, playerId: `p${u}`, name: `Player ${u}`, handle: `ph${u}` })

const t = await prisma.tournament.create({
  data: {
    slug: 'tr-verify', name: 'TR Verify', code: 'TRV1', number: 94001,
    tournamentFormat: 'SINGLE_ELIM', participantFormat: 'TEAM', teamSize: 3, teamFormation: 'PICK',
    lifecycleState: 'REGISTRATION_OPEN', registrationStatus: 'OPEN', status: 'UPCOMING', playoffsStatus: 'PENDING',
  },
})
const tid = t.id
const teamId = async (name: string) => (await prisma.tournamentTeam.findFirstOrThrow({ where: { tournamentId: tid, name } })).id

try {
  // --- Start teams (open + protected) ---
  check('start open team "Zion"', (await startTeam(U(1), tid, 'Zion', ID(1), null)).ok)
  check('start protected team "Falcons" (with code)', (await startTeam(U(2), tid, 'Falcons', ID(2), 'secret')).ok)
  const myA = await getMyTeamMembership(1, tid)
  check('captain is first member + captain flag', myA?.isCaptain === true && myA?.members.length === 1)
  check('new team is incomplete (1 of 3)', myA?.complete === false && myA?.spaces === 2)
  check('open team is not protected; protected team is', myA?.protected === false && (await getMyTeamMembership(2, tid))?.protected === true)

  // --- Duplicate team name (case-insensitive) ---
  check('duplicate team name rejected (ignores case)', !(await startTeam(U(3), tid, 'ziON', ID(3), null)).ok)

  // --- One account = one team ---
  check('captain cannot start a second team', !(await startTeam(U(1), tid, 'Other', ID(1), null)).ok)

  // --- Join open team (no code) ---
  check('join OPEN team without a code', (await joinTeam(U(3), tid, await teamId('Zion'), ID(3), null)).ok)

  // --- Join protected team ---
  check('join PROTECTED team with WRONG code rejected', !(await joinTeam(U(4), tid, await teamId('Falcons'), ID(4), 'nope')).ok)
  check('join PROTECTED team with MISSING code rejected', !(await joinTeam(U(4), tid, await teamId('Falcons'), ID(4), null)).ok)
  check('join PROTECTED team with CORRECT code', (await joinTeam(U(4), tid, await teamId('Falcons'), ID(4), 'secret')).ok)

  // --- Duplicate player registration ---
  check('a player already on a team cannot join another', !(await joinTeam(U(3), tid, await teamId('Falcons'), ID(3), 'secret')).ok)

  // --- Full team ---
  check('fill Zion to capacity', (await joinTeam(U(5), tid, await teamId('Zion'), ID(5), null)).ok)
  const zion = await getMyTeamMembership(1, tid)
  check('Zion is now complete (3 of 3)', zion?.complete === true && zion?.spaces === 0)
  check('joining a FULL team rejected', !(await joinTeam(U(6), tid, await teamId('Zion'), ID(6), null)).ok)
  const list = await listJoinableTeams(tid)
  check('joinable list marks Zion full + protection flags', list.find((x) => x.name === 'Zion')?.full === true && list.find((x) => x.name === 'Falcons')?.protected === true)

  // --- Member withdraws ---
  check('member withdraws from team', (await withdrawFromTeam(U(3), tid)).ok)
  check('withdrawn player has no membership', (await getMyTeamMembership(3, tid)) === null)
  check('Zion back to 2 of 3', (await getMyTeamMembership(1, tid))?.members.length === 2)

  // --- Captain removes a member (authorization) ---
  check('non-captain cannot remove a member', !(await removeTeamMember(U(5), tid, 1)).ok)
  check('captain removes a member', (await removeTeamMember(U(1), tid, 5)).ok)
  check('removed player has no membership', (await getMyTeamMembership(5, tid)) === null)
  check('captain cannot remove self via remove (use withdraw)', !(await removeTeamMember(U(1), tid, 1)).ok)

  // --- Captain withdraws → promotion ---
  check('captain of Falcons withdraws (promotes next member)', (await withdrawFromTeam(U(2), tid)).ok)
  check('promoted member is now captain', (await getMyTeamMembership(4, tid))?.isCaptain === true)
  check('former captain has no membership', (await getMyTeamMembership(2, tid)) === null)

  // --- Join code set / change / remove (captain only) ---
  check('non-captain cannot set a join code', !(await setTeamJoinCode(U(5), tid, 'x')).ok)
  check('captain sets a join code', (await setTeamJoinCode(U(1), tid, 'newcode')).ok)
  check('team is now protected', (await getMyTeamMembership(1, tid))?.protected === true)
  check('new code is enforced on join', !(await joinTeam(U(7), tid, await teamId('Zion'), ID(7), 'wrong')).ok && (await joinTeam(U(8), tid, await teamId('Zion'), ID(8), 'newcode')).ok)
  check('captain removes the join code (opens team)', (await setTeamJoinCode(U(1), tid, null)).ok && (await getMyTeamMembership(1, tid))?.protected === false)

  // --- Captain withdraws as the last member → disband ---
  check('solo captain "Falcons" (now Player 4) withdraws → disband', (await withdrawFromTeam(U(4), tid)).ok)
  check('disbanded team is gone from the joinable list', !(await listJoinableTeams(tid)).some((x) => x.name === 'Falcons'))

  // --- Join codes NEVER recorded in history ---
  const audits = await prisma.auditLog.findMany({ where: { entity: 'TournamentTeam' } })
  const leaked = audits.some((a) => JSON.stringify(a.newValue ?? '').includes('secret') || JSON.stringify(a.newValue ?? '').includes('newcode'))
  check('no join code appears in tournament history/audit', !leaked)

  // --- Roster lock at registration close ---
  await prisma.tournament.update({ where: { id: tid }, data: { registrationStatus: 'CLOSED', lifecycleState: 'REGISTRATION_CLOSED' } })
  check('start team refused once registration closes', !(await startTeam(U(9), tid, 'Late', ID(9), null)).ok)
  check('join refused once registration closes', !(await joinTeam(U(9), tid, await teamId('Zion'), ID(9), null)).ok)
  check('withdraw refused once registration closes (rosters locked)', !(await withdrawFromTeam(U(1), tid)).ok)
  check('remove-member refused once registration closes', !(await removeTeamMember(U(1), tid, 8)).ok)
  check('set-join-code refused once registration closes', !(await setTeamJoinCode(U(1), tid, 'z')).ok)

  // --- Incomplete teams cannot enter (excluded at seeding) ---
  const t2 = await prisma.tournament.create({ data: { slug: 'tr-verify-2', name: 'TR Verify 2', code: 'TRV2', number: 94002, tournamentFormat: 'SINGLE_ELIM', participantFormat: 'TEAM', teamSize: 3, teamFormation: 'PICK', lifecycleState: 'REGISTRATION_OPEN', registrationStatus: 'OPEN', status: 'UPCOMING', playoffsStatus: 'PENDING' } })
  try {
    await startTeam(U(20), t2.id, 'Full', ID(20), null)
    await joinTeam(U(21), t2.id, (await prisma.tournamentTeam.findFirstOrThrow({ where: { tournamentId: t2.id, name: 'Full' } })).id, ID(21), null)
    await joinTeam(U(22), t2.id, (await prisma.tournamentTeam.findFirstOrThrow({ where: { tournamentId: t2.id, name: 'Full' } })).id, ID(22), null)
    await startTeam(U(23), t2.id, 'Short', ID(23), null) // only 1 of 3 — incomplete
    const exc = await excludeIncompletePickTeams(U(99), t2.id)
    check('incomplete teams excluded at seeding', exc.ok && exc.excluded === 1)
    const remaining = await prisma.tournamentTeam.findMany({ where: { tournamentId: t2.id, withdrawn: false } })
    check('only the complete team remains eligible', remaining.length === 1 && remaining[0].name === 'Full')
    const short = await prisma.tournamentTeam.findFirstOrThrow({ where: { tournamentId: t2.id, name: 'Short' } })
    check('incomplete team is withdrawn (cannot enter)', short.withdrawn === true)
  } finally {
    await prisma.tournament.delete({ where: { id: t2.id } }).catch(() => {})
  }
} finally {
  await prisma.tournament.delete({ where: { id: tid } }).catch(() => {})
  await prisma.auditLog.deleteMany({ where: { actorUsername: { startsWith: 'u' }, entity: 'TournamentTeam' } }).catch(() => {})
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
await prisma.$disconnect()
process.exit(fail === 0 ? 0 : 1)
