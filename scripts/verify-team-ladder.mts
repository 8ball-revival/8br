/**
 * Verifies the team → individual-player Ladder attribution: a completed TEAM tournament credits each
 * ROSTER MEMBER on the Ladder (Current + All-Time), and the TEAM NAME never appears as a ranked
 * competitor. Team-average model: every winner gets one win, every loser one loss. Self-cleans.
 *
 * Run:  npx tsx --tsconfig scripts/tsconfig.verify.json scripts/verify-team-ladder.mts
 */
import { prisma } from '../src/lib/prisma.ts'
import { reseedEntrants, rebuildManualPlayoff, publishPlayoff, recordPlayoffScore, verifyPlayoffMatch } from '../src/lib/competition/service.ts'
import { transitionTournamentState } from '../src/lib/competition/tournament-lifecycle.ts'
import { getCurrentScoreRankings } from '../src/lib/stats/current-score.ts'
import { getAllTimeRankings } from '../src/lib/stats/rankings.ts'
import { tournamentStore, loadTournamentContext } from '../src/lib/tournaments/prime.ts'

let pass = 0, fail = 0
const check = (n: string, c: boolean) => { if (c) { pass++; console.log('  ✓ ' + n) } else { fail++; console.log('  ✗ ' + n) } }
const actor = { userId: 930001, username: 'ladder-verify' }
const RACE = 5

async function makeTeam(tid: number, name: string, members: { name: string; handle: string }[]) {
  const reg = await prisma.registration.create({ data: { tournamentId: tid, username: name, displayName: name, status: 'APPROVED', approvedAt: new Date() } })
  const team = await prisma.tournamentTeam.create({ data: { tournamentId: tid, registrationId: reg.id, name } })
  await prisma.tournamentTeamMember.createMany({ data: members.map((m, i) => ({ teamId: team.id, name: m.name, handle: m.handle, memberOrder: i, captain: i === 0 })) })
  return reg.id
}

const t = await prisma.tournament.create({
  data: {
    slug: 'ladder-verify', name: 'Ladder Verify', code: 'LDV1', number: 93001,
    tournamentFormat: 'SINGLE_ELIM', participantFormat: 'TEAM', teamSize: 2, teamFormation: 'PICK', raceLength: RACE,
    lifecycleState: 'REGISTRATION_CLOSED', registrationStatus: 'CLOSED', status: 'UPCOMING', playoffsStatus: 'PENDING',
  },
})
const tid = t.id

try {
  const alpha = await makeTeam(tid, 'Alpha', [{ name: 'A1', handle: 'alphaone' }, { name: 'A2', handle: 'alphatwo' }])
  const beta = await makeTeam(tid, 'Beta', [{ name: 'B1', handle: 'betaone' }, { name: 'B2', handle: 'betatwo' }])

  // Seed + build + publish the (single) final between the two team entrants.
  await reseedEntrants(actor, tid, [alpha, beta])
  const built = await rebuildManualPlayoff(actor, tid, [alpha, beta], { doubleElim: false })
  if (!built.ok) throw new Error('build failed: ' + built.error)
  await publishPlayoff(actor, tid)
  await transitionTournamentState(actor, tid, 'BRACKET_GENERATED').catch(() => {})
  await transitionTournamentState(actor, tid, 'IN_PROGRESS')

  // Play the final: Alpha beats Beta.
  const final = await prisma.playoffMatch.findFirstOrThrow({ where: { tournamentId: tid, winnerRegistrationId: null, NOT: [{ homeRegistrationId: null }, { awayRegistrationId: null }] } })
  const alphaHome = final.homeRegistrationId === alpha
  await recordPlayoffScore(actor, final.id, alphaHome ? RACE : 0, alphaHome ? 0 : RACE)
  await verifyPlayoffMatch(actor, final.id)
  const done = await transitionTournamentState(actor, tid, 'COMPLETED')
  check('team tournament completes', done.ok)

  // Prime the snapshot-backed store, then compute the ladders.
  tournamentStore.enterWith(await loadTournamentContext())
  const cur = getCurrentScoreRankings()
  const all = getAllTimeRankings()
  const curIds = new Set(cur.rows.map((r) => r.id.toLowerCase()))
  const curNames = new Set(cur.rows.map((r) => r.name))
  const allIds = new Set([...all.rows, ...(all.unranked ?? [])].map((r) => r.id.toLowerCase()))

  const members = ['alphaone', 'alphatwo', 'betaone', 'betatwo']
  check('Current ladder: team names ARE NOT ranked', !curNames.has('Alpha') && !curNames.has('Beta') && !curIds.has('alpha') && !curIds.has('beta'))
  check('Current ladder: all four PLAYERS are ranked', members.every((m) => curIds.has(m)))
  check('All-Time ladder: team names ARE NOT ranked', !allIds.has('alpha') && !allIds.has('beta'))
  check('All-Time ladder: all four PLAYERS appear', members.every((m) => allIds.has(m)))

  const byId = new Map(cur.rows.map((r) => [r.id.toLowerCase(), r]))
  check('each winning-team player has exactly one win', (byId.get('alphaone')?.wins === 1) && (byId.get('alphatwo')?.wins === 1))
  check('each losing-team player has exactly one loss', (byId.get('betaone')?.losses === 1) && (byId.get('betatwo')?.losses === 1))
  check('winners recorded no loss; losers recorded no win', byId.get('alphaone')?.losses === 0 && byId.get('betaone')?.wins === 0)
  // Champion team's members share the finish → they rank above the losing team's members.
  const rankOf = (id: string) => cur.rows.find((r) => r.id.toLowerCase() === id)?.rank ?? 999
  check('champion team players outrank the losing team players', Math.max(rankOf('alphaone'), rankOf('alphatwo')) < Math.min(rankOf('betaone'), rankOf('betatwo')))
} finally {
  await prisma.tournament.delete({ where: { id: tid } }).catch(() => {})
  await prisma.auditLog.deleteMany({ where: { actorUsername: 'ladder-verify' } }).catch(() => {})
  const { regenerateTournamentSnapshot } = await import('../src/lib/tournaments/migrate.ts')
  await regenerateTournamentSnapshot().catch(() => {})
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
await prisma.$disconnect()
process.exit(fail === 0 ? 0 : 1)
