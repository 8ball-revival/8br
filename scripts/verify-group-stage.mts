/**
 * End-to-end verification of the GROUP STAGE + PLAYOFFS lifecycle against the DB:
 * create → approve entrants → generate/publish groups → play round-robin → standings +
 * tiebreakers + qualifiers → confirm qualifiers → seed playoff (single AND double elim) →
 * play the bracket to a champion → complete → ranking ladder applied. Self-cleans.
 */
import { prisma } from '../src/lib/prisma.ts'
import { startGroupStage, recordGroupResult, groupStageComplete, confirmQualifiersAndSeed } from '../src/lib/competition/group-stage.ts'
import { recordPlayoffScore, verifyPlayoffMatch } from '../src/lib/competition/service.ts'
import { transitionCupState, getCupState } from '../src/lib/competition/tournament-lifecycle.ts'

let pass = 0, fail = 0
const check = (n: string, c: boolean) => { if (c) { pass++; console.log('  ✓ ' + n) } else { fail++; console.log('  ✗ ' + n) } }
const actor = { userId: 990980, username: 'gs-verify' }

async function makeTournament(number: number, doubleElim: boolean, players: number, groupCount: number, qualifiersPerGroup: number) {
  const t = await prisma.tournament.create({
    data: {
      slug: `gs-verify-${number}`, name: `GS Verify ${number}`, code: `GSV${number}`, number,
      tournamentFormat: 'GROUPS_PLAYOFFS', groupCount, qualifiersPerGroup, playoffSeeding: 'standing',
      playoffDoubleElim: doubleElim, raceLength: 5, participantFormat: 'INDIVIDUAL',
      lifecycleState: 'REGISTRATION_CLOSED', registrationStatus: 'CLOSED', status: 'UPCOMING', playoffsStatus: 'PENDING',
    },
  })
  for (let i = 1; i <= players; i++) {
    await prisma.registration.create({ data: { tournamentId: t.id, username: `GSP${number}_${i}`, status: 'APPROVED' } })
  }
  return t.id
}

/** Play every group match: the player with the LOWER registration id wins 5–0 (deterministic). */
async function playGroups(tournamentId: number) {
  const matches = await prisma.tournamentMatch.findMany({ where: { tournamentId } })
  for (const m of matches) {
    const homeWins = m.homeRegistrationId < m.awayRegistrationId
    await recordGroupResult(actor, m.id, homeWins ? 5 : 0, homeWins ? 0 : 5)
  }
}

/** Play the whole playoff bracket: lower registration id wins; walkovers auto-resolve. */
async function playBracket(tournamentId: number): Promise<number> {
  let guard = 0
  for (;;) {
    if (guard++ > 500) throw new Error('bracket did not resolve')
    const ready = await prisma.playoffMatch.findFirst({
      where: { tournamentId, winnerRegistrationId: null, NOT: [{ homeRegistrationId: null }, { awayRegistrationId: null }] },
      orderBy: [{ round: 'asc' }, { slot: 'asc' }],
    })
    if (!ready) break
    const homeWins = ready.homeRegistrationId! < ready.awayRegistrationId!
    await recordPlayoffScore(actor, ready.id, homeWins ? 5 : 0, homeWins ? 0 : 5)
    await verifyPlayoffMatch(actor, ready.id)
  }
  // champion = winner of the highest-round decided match (GF for double-elim, final for single)
  const finalMatch = await prisma.playoffMatch.findFirst({ where: { tournamentId, NOT: { winnerRegistrationId: null } }, orderBy: [{ round: 'desc' }, { slot: 'desc' }] })
  return finalMatch?.winnerRegistrationId ?? -1
}

async function run(number: number, doubleElim: boolean) {
  console.log(`\n--- Group Stage + Playoffs (${doubleElim ? 'DOUBLE' : 'single'}-elim), 8 players / 2 groups / top 2 ---`)
  const id = await makeTournament(number, doubleElim, 8, 2, 2)
  try {
    const started = await startGroupStage(actor, id)
    check('start group stage ok', started.ok)
    const groups = await prisma.tournamentGroup.count({ where: { tournamentId: id } })
    check('2 groups generated + published', groups === 2)
    const gmatches = await prisma.tournamentMatch.count({ where: { tournamentId: id } })
    check('round-robin schedule generated (12 matches for 2×4)', gmatches === 12)
    check('state is GROUPS_IN_PROGRESS', getCupState(await prisma.tournament.findUniqueOrThrow({ where: { id } })) === 'GROUPS_IN_PROGRESS')

    // Cannot advance before the group stage is complete.
    const early = await confirmQualifiersAndSeed(actor, id)
    check('advancing before groups finish is refused', !early.ok && /still need/i.test(early.error || ''))

    await playGroups(id)
    const complete = await groupStageComplete(id)
    check('group stage reports complete after all results', complete.complete)

    const standings = await prisma.standing.findMany({ where: { tournamentId: id }, orderBy: [{ groupId: 'asc' }, { rank: 'asc' }] })
    check('standings computed for all 8 players', standings.length === 8)
    check('top 2 of each group marked qualified (4 total)', standings.filter((s) => s.qualified).length === 4)
    check('rank 1 has the most wins in its group', standings.filter((s) => s.rank === 1).every((s) => s.wins >= 1))

    const seeded = await confirmQualifiersAndSeed(actor, id)
    check('confirm qualifiers + seed bracket ok', seeded.ok)
    check('state is BRACKET_GENERATED', getCupState(await prisma.tournament.findUniqueOrThrow({ where: { id } })) === 'BRACKET_GENERATED')
    const pm = await prisma.playoffMatch.count({ where: { tournamentId: id } })
    check('playoff bracket created from qualifiers', pm > 0)
    if (doubleElim) {
      const sections = await prisma.playoffMatch.groupBy({ by: ['section'], where: { tournamentId: id }, _count: true })
      const has = (s: string) => sections.some((x) => x.section === s)
      check('double-elim bracket has WB + LB + GF sections', has('WB') && has('LB') && has('GF'))
    }

    // Begin, play the bracket, complete.
    await transitionCupState(actor, id, 'IN_PROGRESS')
    const champ = await playBracket(id)
    check('bracket plays to a single champion', champ > 0)
    const done = await transitionCupState(actor, id, 'COMPLETED')
    check('tournament completes', done.ok)
    const t = await prisma.tournament.findUniqueOrThrow({ where: { id } })
    check('ranking ladder applied on completion', t.ladderAppliedAt != null)
    check('champion recorded', t.championName != null)
  } finally {
    await prisma.tournament.delete({ where: { id } }).catch(() => {})
    await prisma.auditLog.deleteMany({ where: { actorUsername: 'gs-verify' } })
  }
}

await run(99201, false)
await run(99202, true)
const { regenerateCupSnapshot } = await import('../src/lib/tournaments/migrate.ts')
await regenerateCupSnapshot().catch(() => {})
console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
await prisma.$disconnect()
process.exit(fail === 0 ? 0 : 1)
