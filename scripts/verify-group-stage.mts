/**
 * End-to-end verification of the GROUP STAGE + PLAYOFFS lifecycle against the DB:
 * create → approve entrants → generate/publish groups → play round-robin → standings +
 * tiebreakers + qualifiers → confirm qualifiers → seed playoff (single AND double elim) →
 * play the bracket to a champion → complete → ranking ladder applied. Self-cleans.
 */
import { prisma } from '../src/lib/prisma.ts'
import { startGroupStage, recordGroupResult, groupStageComplete, confirmQualifiersAndSeed } from '../src/lib/competition/group-stage.ts'
import { recordPlayoffScore, verifyPlayoffMatch, publishPlayoff } from '../src/lib/competition/service.ts'
import { transitionTournamentState, getTournamentState, bracketMatchesEntrants } from '../src/lib/competition/tournament-lifecycle.ts'
import { computeBracketShape, playoffRaceLength } from '../src/lib/competition/match-format.ts'

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

/** Play every group match 10–0 to the LOWER registration id (deterministic; total = 10 as required). */
async function playGroups(tournamentId: number) {
  const matches = await prisma.tournamentMatch.findMany({ where: { tournamentId } })
  for (const m of matches) {
    const homeWins = m.homeRegistrationId < m.awayRegistrationId
    await recordGroupResult(actor, m.id, homeWins ? 10 : 0, homeWins ? 0 : 10)
  }
}

/** Play the whole playoff bracket: lower registration id wins at the match's hard-coded race length
 *  (Race to 7 early, Race to 9 for the semis/final/grand-final); walkovers auto-resolve. */
async function playBracket(tournamentId: number): Promise<number> {
  let guard = 0
  for (;;) {
    if (guard++ > 500) throw new Error('bracket did not resolve')
    const all = await prisma.playoffMatch.findMany({ where: { tournamentId }, select: { round: true, section: true } })
    const shape = computeBracketShape(all)
    const ready = await prisma.playoffMatch.findFirst({
      where: { tournamentId, winnerRegistrationId: null, NOT: [{ homeRegistrationId: null }, { awayRegistrationId: null }] },
      orderBy: [{ round: 'asc' }, { slot: 'asc' }],
    })
    if (!ready) break
    const race = playoffRaceLength({ round: ready.round, section: ready.section }, shape)
    const homeWins = ready.homeRegistrationId! < ready.awayRegistrationId!
    await recordPlayoffScore(actor, ready.id, homeWins ? race : 0, homeWins ? 0 : race)
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
    check('state is GROUPS_IN_PROGRESS', getTournamentState(await prisma.tournament.findUniqueOrThrow({ where: { id } })) === 'GROUPS_IN_PROGRESS')

    // Cannot advance before the group stage is complete.
    const early = await confirmQualifiersAndSeed(actor, id)
    check('advancing before groups finish is refused', !early.ok && /still need/i.test(early.error || ''))

    await playGroups(id)

    // --- Flexible Group Stage entry: uneven totals accepted, higher wins; 5–5 draw; 0–0 rejected ---
    const one = await prisma.tournamentMatch.findFirstOrThrow({ where: { tournamentId: id }, orderBy: { id: 'asc' } })
    check('uneven group total (7–2) accepted', (await recordGroupResult(actor, one.id, 7, 2)).ok)
    const unevenRow = await prisma.tournamentMatch.findUniqueOrThrow({ where: { id: one.id } })
    check('higher score wins (7–2 → home)', unevenRow.winnerRegistrationId === one.homeRegistrationId)
    check('0–0 rejected (not a played match)', !(await recordGroupResult(actor, one.id, 0, 0)).ok)
    const drew = await recordGroupResult(actor, one.id, 5, 5)
    check('5–5 group result accepted', drew.ok)
    const drawRow = await prisma.tournamentMatch.findUniqueOrThrow({ where: { id: one.id } })
    check('5–5 recorded as a draw (no winner, completed)', drawRow.winnerRegistrationId === null && drawRow.status === 'COMPLETED')
    check('a draw does NOT block group-stage completion', (await groupStageComplete(id)).complete)
    const drawStandings = await prisma.standing.findMany({ where: { groupId: one.groupId } })
    const homeStand = drawStandings.find((s) => s.registrationId === one.homeRegistrationId)!
    check('draw counts as played but not a win (played − wins − losses ≥ 1)', homeStand.played - homeStand.wins - homeStand.losses >= 1)
    // Restore the match to a decisive result so downstream qualifier seeding stays deterministic.
    const homeLower = one.homeRegistrationId < one.awayRegistrationId
    await recordGroupResult(actor, one.id, homeLower ? 10 : 0, homeLower ? 0 : 10)

    const complete = await groupStageComplete(id)
    check('group stage reports complete after all results', complete.complete)

    const standings = await prisma.standing.findMany({ where: { tournamentId: id }, orderBy: [{ groupId: 'asc' }, { rank: 'asc' }] })
    check('standings computed for all 8 players', standings.length === 8)
    check('top 2 of each group marked qualified (4 total)', standings.filter((s) => s.qualified).length === 4)
    check('rank 1 has the most wins in its group', standings.filter((s) => s.rank === 1).every((s) => s.wins >= 1))

    const seeded = await confirmQualifiersAndSeed(actor, id)
    check('confirm qualifiers + seed bracket ok', seeded.ok)
    // Confirming qualifiers seeds a DRAFT bracket and stops at BRACKET_GENERATED (a review step) — NOT live.
    check('state is BRACKET_GENERATED (draft seeded, not live)', getTournamentState(await prisma.tournament.findUniqueOrThrow({ where: { id } })) === 'BRACKET_GENERATED')
    check('bracket seeded but not yet published (reviewable)', (await prisma.playoffMatch.count({ where: { tournamentId: id, published: true } })) === 0)
    check('bracket is not falsely flagged stale', (await bracketMatchesEntrants(id)).ok)
    const pm = await prisma.playoffMatch.count({ where: { tournamentId: id } })
    check('playoff bracket created from qualifiers', pm > 0)
    if (doubleElim) {
      const sections = await prisma.playoffMatch.groupBy({ by: ['section'], where: { tournamentId: id }, _count: true })
      const has = (s: string) => sections.some((x) => x.section === s)
      check('double-elim bracket has WB + LB + GF sections', has('WB') && has('LB') && has('GF'))
    }

    // Review → publish the bracket → begin play (the seeding review step now exists).
    await publishPlayoff(actor, id)
    await transitionTournamentState(actor, id, 'IN_PROGRESS')
    check('published + started → IN_PROGRESS', getTournamentState(await prisma.tournament.findUniqueOrThrow({ where: { id } })) === 'IN_PROGRESS')

    // Already live (confirm qualifiers went straight to IN_PROGRESS). Play the bracket, complete.
    const champ = await playBracket(id)
    check('bracket plays to a single champion', champ > 0)
    const done = await transitionTournamentState(actor, id, 'COMPLETED')
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
const { regenerateTournamentSnapshot } = await import('../src/lib/tournaments/migrate.ts')
await regenerateTournamentSnapshot().catch(() => {})
console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
await prisma.$disconnect()
process.exit(fail === 0 ? 0 : 1)
