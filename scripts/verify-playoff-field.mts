/**
 * Verifies the "players in playoffs" trim: building a bracket from the TOP-N seeds (a subset of the
 * field) produces a bracket containing only those N players — the same server path the SeedBuilder's
 * field-size control uses (buildTournamentBracketAction → reseedEntrants + rebuildManualPlayoff).
 * Self-cleans.
 *
 * Run:  npx tsx --tsconfig scripts/tsconfig.verify.json scripts/verify-playoff-field.mts
 */
import { prisma } from '../src/lib/prisma.ts'
import { reseedEntrants, rebuildManualPlayoff } from '../src/lib/competition/service.ts'

let pass = 0, fail = 0
const check = (n: string, c: boolean) => { if (c) { pass++; console.log('  ✓ ' + n) } else { fail++; console.log('  ✗ ' + n) } }
const actor = { userId: 940001, username: 'field-verify' }

const t = await prisma.tournament.create({
  data: {
    slug: 'field-verify', name: 'Field Verify', competitionYear: new Date().getFullYear(), code: 'FLD1', number: 94001,
    tournamentFormat: 'SINGLE_ELIM', participantFormat: 'INDIVIDUAL', raceLength: 5,
    lifecycleState: 'REGISTRATION_CLOSED', registrationStatus: 'CLOSED', status: 'UPCOMING', playoffsStatus: 'PENDING',
  },
})
const tid = t.id

async function distinctBracketPlayers(): Promise<Set<number>> {
  const ms = await prisma.playoffMatch.findMany({ where: { tournamentId: tid }, select: { homeRegistrationId: true, awayRegistrationId: true } })
  const s = new Set<number>()
  for (const m of ms) { if (m.homeRegistrationId) s.add(m.homeRegistrationId); if (m.awayRegistrationId) s.add(m.awayRegistrationId) }
  return s
}

try {
  const ids: number[] = []
  for (let i = 1; i <= 6; i++) {
    const r = await prisma.registration.create({ data: { tournamentId: tid, username: `p${i}`, displayName: `P${i}`, status: 'APPROVED', approvedAt: new Date() } })
    ids.push(r.id)
  }

  // Full field of 6 → 8-slot bracket (2 byes), all 6 present.
  await reseedEntrants(actor, tid, ids)
  const full = await rebuildManualPlayoff(actor, tid, ids)
  check('full-field bracket builds', full.ok)
  const allPlayers = await distinctBracketPlayers()
  check('all 6 players are in the full bracket', allPlayers.size === 6)

  // Trim to the TOP 4 → bracket has only those 4; the bottom 2 are excluded.
  const top4 = ids.slice(0, 4)
  await reseedEntrants(actor, tid, top4)
  const trimmed = await rebuildManualPlayoff(actor, tid, top4)
  check('trimmed (top-4) bracket builds', trimmed.ok)
  const players = await distinctBracketPlayers()
  check('exactly the top 4 seeds are in the bracket', players.size === 4)
  check('the top 4 are all present', top4.every((id) => players.has(id)))
  check('the bottom 2 are excluded', !players.has(ids[4]) && !players.has(ids[5]))

  // Trim to the TOP 2 → a single final between them.
  const top2 = ids.slice(0, 2)
  await reseedEntrants(actor, tid, top2)
  const two = await rebuildManualPlayoff(actor, tid, top2)
  check('top-2 bracket builds a single final', two.ok && (await prisma.playoffMatch.count({ where: { tournamentId: tid } })) === 1)
} finally {
  await prisma.tournament.delete({ where: { id: tid } }).catch(() => {})
}

console.log(`\n${pass} passed, ${fail} failed`)
// Deleting a Tournament directly leaves the derived snapshot cache listing one that no longer
// exists. The app's own delete action rebuilds it; a test that bypasses that action must too, or it
// leaves a phantom tournament behind for whatever runs next.
{
  const { regenerateTournamentSnapshot } = await import('../src/lib/tournaments/migrate.ts')
  await regenerateTournamentSnapshot().catch(() => {})
}
await prisma.$disconnect()
if (fail) process.exit(1)
