/**
 * Verifies (a) RANDOM-draw team assembly — solo entrants shuffled into full teams of the chosen
 * size, leftovers withdrawn, solo registrations retired, idempotent re-draw; and (b) password-gated
 * registration — a private tournament refuses the wrong join password and accepts the right one,
 * while an OPEN tournament needs none. Self-cleans.
 *
 * Run:  npx tsx --tsconfig scripts/tsconfig.verify.json scripts/verify-random-and-access.mts
 */
import { prisma } from '../src/lib/prisma.ts'
import { assembleRandomTeams } from '../src/lib/competition/teams.ts'
import { createPublicRegistration } from '../src/lib/competition/service.ts'
import { hashJoinPassword } from '../src/lib/competition/join-password.ts'

let pass = 0, fail = 0
const check = (n: string, c: boolean) => { if (c) { pass++; console.log('  ✓ ' + n) } else { fail++; console.log('  ✗ ' + n) } }
const actor = { userId: 960001, username: 'rand-verify' }

async function makeRandomTeamTournament(number: number, players: number, size: number) {
  const t = await prisma.tournament.create({
    data: {
      slug: `rand-verify-${number}`, name: `Rand Verify ${number}`, competitionYear: new Date().getFullYear(), code: `RNV${number}`, number,
      tournamentFormat: 'SINGLE_ELIM', participantFormat: 'TEAM', teamSize: size, teamFormation: 'RANDOM',
      lifecycleState: 'REGISTRATION_CLOSED', registrationStatus: 'CLOSED', status: 'UPCOMING', playoffsStatus: 'PENDING',
    },
  })
  for (let i = 1; i <= players; i++) {
    await prisma.registration.create({ data: { tournamentId: t.id, userId: number * 1000 + i, username: `RP${number}_${i}`, displayName: `Player ${i}`, cueverseId: `rp${number}_${i}`, playerId: `rand-${number}-${i}`, status: 'APPROVED' } })
  }
  return t.id
}

async function runRandom(number: number, players: number, size: number, expectTeams: number) {
  console.log(`\n--- Random draw: ${players} players, teams of ${size} (divisible) ---`)
  const id = await makeRandomTeamTournament(number, players, size)
  try {
    const r = await assembleRandomTeams(actor, id)
    check('assemble ok', r.ok)
    check(`formed ${expectTeams} teams`, r.teams === expectTeams)

    const teams = await prisma.tournamentTeam.findMany({ where: { tournamentId: id }, include: { members: true } })
    check('team rows created', teams.length === expectTeams)
    check('every team has exactly `size` members', teams.every((t) => t.members.length === size))
    check('every member carries a player id (account-linked)', teams.every((t) => t.members.every((m) => !!m.playerId)))
    check('every member has a frozen rating (ratingAtClose)', teams.every((t) => t.members.every((m) => m.ratingAtClose != null)))
    const names = teams.map((t) => t.name)
    check('team names are unique within the tournament', new Set(names).size === names.length)
    check('team names are curated (not "Team N")', names.every((n) => !/^Team \d+$/.test(n)))

    const activeTeamRegs = await prisma.registration.count({ where: { tournamentId: id, status: 'APPROVED', team: { isNot: null } } })
    check('team entrants are the only approved registrations', activeTeamRegs === expectTeams)
    const soloApproved = await prisma.registration.count({ where: { tournamentId: id, status: 'APPROVED', team: { is: null } } })
    check('every drawn player is on a team (none dropped)', soloApproved === 0)

    const again = await assembleRandomTeams(actor, id)
    check('re-draw is a no-op (already drawn)', again.ok && again.teams === expectTeams)
  } finally {
    await prisma.tournament.delete({ where: { id } }).catch(() => {})
    await prisma.auditLog.deleteMany({ where: { actorUsername: 'rand-verify' } }).catch(() => {})
  }
}

async function runBlocked(number: number, players: number, size: number, expectAdd: number, expectRemove: number) {
  console.log(`\n--- Random draw: ${players} players, teams of ${size} (NOT divisible — must block) ---`)
  const id = await makeRandomTeamTournament(number, players, size)
  try {
    const r = await assembleRandomTeams(actor, id)
    check('non-divisible draw is blocked', !r.ok)
    check('message tells admin how many to add', (r.error || '').includes(`Add ${expectAdd}`))
    check('message tells admin how many to remove', (r.error || '').includes(`remove ${expectRemove}`))
    const teams = await prisma.tournamentTeam.count({ where: { tournamentId: id } })
    check('no teams created when blocked', teams === 0)
    const dropped = await prisma.registration.count({ where: { tournamentId: id, status: 'WITHDRAWN' } })
    check('no player withdrawn/dropped when blocked', dropped === 0)
  } finally {
    await prisma.tournament.delete({ where: { id } }).catch(() => {})
    await prisma.auditLog.deleteMany({ where: { actorUsername: 'rand-verify' } }).catch(() => {})
  }
}

async function runAccess() {
  console.log('\n--- Password-gated registration ---')
  const priv = await prisma.tournament.create({
    data: {
      slug: 'access-verify-priv', name: 'Access Verify Priv', competitionYear: new Date().getFullYear(), code: 'ACV1', number: 96901,
      tournamentFormat: 'SINGLE_ELIM', participantFormat: 'INDIVIDUAL', accessMode: 'PASSWORD', joinPasswordHash: hashJoinPassword('letmein'),
      lifecycleState: 'REGISTRATION_OPEN', registrationStatus: 'OPEN', status: 'UPCOMING', playoffsStatus: 'PENDING',
    },
  })
  const open = await prisma.tournament.create({
    data: {
      slug: 'access-verify-open', name: 'Access Verify Open', competitionYear: new Date().getFullYear(), code: 'ACV2', number: 96902,
      tournamentFormat: 'SINGLE_ELIM', participantFormat: 'INDIVIDUAL', accessMode: 'OPEN',
      lifecycleState: 'REGISTRATION_OPEN', registrationStatus: 'OPEN', status: 'UPCOMING', playoffsStatus: 'PENDING',
    },
  })
  try {
    const wrong = await createPublicRegistration(priv.id, 969101, 'u1', { playerId: 'acc-1' }, 'nope')
    check('private tournament rejects a wrong password', !wrong.ok && /join password/i.test(wrong.error || ''))
    const missing = await createPublicRegistration(priv.id, 969102, 'u2', { playerId: 'acc-2' })
    check('private tournament rejects a missing password', !missing.ok)
    const right = await createPublicRegistration(priv.id, 969103, 'u3', { playerId: 'acc-3' }, 'letmein')
    check('private tournament accepts the correct password', right.ok)
    const openOk = await createPublicRegistration(open.id, 969104, 'u4', { playerId: 'acc-4' })
    check('open tournament needs no password', openOk.ok)
  } finally {
    await prisma.tournament.deleteMany({ where: { id: { in: [priv.id, open.id] } } }).catch(() => {})
  }
}

await runRandom(9601, 9, 3, 3)
await runRandom(9602, 6, 3, 2)
await runRandom(9603, 8, 2, 4)
await runBlocked(9604, 8, 3, 1, 2) // 8 of 3 → add 1 (to 9 = 3 teams) or remove 2 (to 6 = 2 teams)
await runBlocked(9605, 10, 4, 2, 2) // 10 of 4 → add 2 (to 12 = 3 teams) or remove 2 (to 8 = 2 teams)
await runAccess()
console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
await prisma.$disconnect()
process.exit(fail === 0 ? 0 : 1)
