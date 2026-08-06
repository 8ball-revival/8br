/**
 * E2E: a MIGRATED historical player + a NEWLY created player both compete in a cup that is completed.
 * Verifies: the migrated player's entrant uses their EXISTING permanent profile (no duplicate Player),
 * completing the cup creates no duplicate players/identities, historical bridge (legacyPlayerId) is
 * intact, and the new result attaches to the SAME historical profile.
 */
import { prisma } from '../src/lib/prisma.ts'
import { addEntrantByProfile, rebuildManualPlayoff, publishPlayoff, recordPlayoffScore, verifyPlayoffMatch } from '../src/lib/competition/service.ts'
import { transitionCupState, getCupState } from '../src/lib/competition/cup-lifecycle.ts'
import { resolveIdentity } from '../src/lib/stats/identity.ts'
let pass = 0, fail = 0
const check = (n: string, c: boolean) => { if (c) { pass++; console.log('  ✓ ' + n) } else { fail++; console.log('  ✗ ' + n) } }
const actor = { userId: 990990, username: 'e2e-mig' }

// Migrated historical player (poolist → legacyPlayerId P1022).
const migrated = await prisma.player.findFirstOrThrow({ where: { cueverseId: { equals: 'poolist', mode: 'insensitive' } }, select: { id: true, legacyPlayerId: true, linkedUserId: true } })
console.log(`migrated poolist: profile ${migrated.id.slice(0, 8)} legacyId=${migrated.legacyPlayerId} user#${migrated.linkedUserId}`)

// A brand-new registered player (fresh profile, as an admin would create before adding).
const newbie = await prisma.player.create({ data: { primaryName: 'e2e_newbie', cueverseId: 'e2e_newbie', provenance: 'NATIVE_EGO' } })

const playersBefore = await prisma.player.count()
const cup = await prisma.season.create({ data: { slug: 'zzz-e2e-mig', name: 'E2E Mig Cup', competitionType: 'CUP', competitionCode: 'CE2EM', cupNumber: 99080, cupState: 'REGISTRATION_OPEN', registrationStatus: 'OPEN', seasonStatus: 'UPCOMING', playoffsStatus: 'PENDING', raceLength: 3, participantFormat: 'INDIVIDUAL' } })
const id = cup.id
try {
  // Add both entrants by permanent profile id (no free-text).
  check('add migrated poolist by profile ok', (await addEntrantByProfile(actor, id, migrated.id)).ok)
  check('add new player by profile ok', (await addEntrantByProfile(actor, id, newbie.id)).ok)

  const regs = await prisma.registration.findMany({ where: { seasonId: id }, select: { id: true, playerId: true } })
  check('exactly 2 entrants', regs.length === 2)
  check('migrated entrant references the EXISTING profile (no duplicate)', regs.some((r) => r.playerId === migrated.id))
  check('no duplicate Player was created for the migrated entrant', (await prisma.player.count({ where: { cueverseId: { equals: 'poolist', mode: 'insensitive' } } })) === 1)

  // Close → generate bracket → start.
  await transitionCupState(actor, id, 'REGISTRATION_CLOSED')
  await rebuildManualPlayoff(actor, id, regs.map((r) => r.id))
  await publishPlayoff(actor, id)
  await transitionCupState(actor, id, 'BRACKET_GENERATED')
  check('cup reached BRACKET_GENERATED', getCupState(await prisma.season.findUniqueOrThrow({ where: { id } })) === 'BRACKET_GENERATED')
  await transitionCupState(actor, id, 'IN_PROGRESS')

  // poolist wins the final 3–1.
  const final = await prisma.playoffMatch.findFirstOrThrow({ where: { seasonId: id, round: 1 } })
  const poolistReg = regs.find((r) => r.playerId === migrated.id)!
  const poolistIsHome = final.homeRegistrationId === poolistReg.id
  await recordPlayoffScore(actor, final.id, poolistIsHome ? 3 : 1, poolistIsHome ? 1 : 3)
  await verifyPlayoffMatch(actor, final.id)
  const decided = await prisma.playoffMatch.findUniqueOrThrow({ where: { id: final.id } })
  check('poolist recorded as the cup winner', decided.winnerRegistrationId === poolistReg.id)

  const done = await transitionCupState(actor, id, 'COMPLETED')
  check('cup completed ok', done.ok)

  // Invariants after completion.
  const playersAfter = await prisma.player.count()
  check('no duplicate players created by the cup (only +1 for the new player)', playersAfter === playersBefore)
  const stillMigrated = await prisma.player.findUniqueOrThrow({ where: { id: migrated.id }, select: { legacyPlayerId: true, cueverseId: true } })
  check('historical bridge intact (legacyPlayerId unchanged)', stillMigrated.legacyPlayerId === migrated.legacyPlayerId)
  check('new result attaches to the SAME historical identity', resolveIdentity(stillMigrated.cueverseId, stillMigrated.cueverseId)?.id === migrated.legacyPlayerId)
  check('migrated and new player resolve to DISTINCT identities', resolveIdentity('poolist', 'poolist')?.id !== resolveIdentity('e2e_newbie', 'e2e_newbie')?.id)
} finally {
  await prisma.season.delete({ where: { id } }).catch(() => {})
  await prisma.playerAlias.deleteMany({ where: { playerId: newbie.id } }).catch(() => {})
  await prisma.player.delete({ where: { id: newbie.id } }).catch(() => {})
  await prisma.auditLog.deleteMany({ where: { actorUsername: 'e2e-mig' } })
  const { regenerateCupSnapshot } = await import('../src/lib/cups/migrate.ts')
  await regenerateCupSnapshot().catch(() => {})
  console.log('cleaned up E2E cup + new player + audit + snapshot')
}
console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
await prisma.$disconnect(); process.exit(fail === 0 ? 0 : 1)
