/**
 * End-to-end verification of the SWISS runtime against the DB: start → round pairings (with a bye
 * for an odd field) → report results → standings + tiebreaks → pair subsequent rounds avoiding
 * rematches → completion → champion + per-player Ladder materialization. Runs an even field (8) and
 * an odd field (5, exercising byes). Deterministic: the lower registration id always wins. Cleans up.
 *
 * Run:  npx tsx --tsconfig scripts/tsconfig.verify.json scripts/verify-swiss.mts
 */
import { prisma } from '../src/lib/prisma.ts'
import { startSwiss, recordSwissResult, getSwissState, pairNextRound, completeSwiss } from '../src/lib/competition/swiss.ts'

let pass = 0, fail = 0
const check = (n: string, c: boolean) => { if (c) { pass++; console.log('  ✓ ' + n) } else { fail++; console.log('  ✗ ' + n) } }
const actor = { userId: 970001, username: 'swiss-verify' }
const RACE = 3

async function makeTournament(number: number, players: number, rounds: number | null) {
  const t = await prisma.tournament.create({
    data: {
      slug: `swiss-verify-${number}`, name: `Swiss Verify ${number}`, code: `SWV${number}`, number,
      tournamentFormat: 'SWISS', swissRounds: rounds, seedingMethod: 'registration', raceLength: RACE, participantFormat: 'INDIVIDUAL',
      lifecycleState: 'REGISTRATION_CLOSED', registrationStatus: 'CLOSED', status: 'UPCOMING', playoffsStatus: 'PENDING',
    },
  })
  for (let i = 1; i <= players; i++) {
    await prisma.registration.create({ data: { tournamentId: t.id, username: `SW${number}_${String(i).padStart(2, '0')}`, status: 'APPROVED' } })
  }
  return t.id
}

/** Report every unreported non-bye match in the current round: lower registration id wins RACE–0. */
async function playRound(tournamentId: number, round: number) {
  const matches = await prisma.swissMatch.findMany({ where: { tournamentId, round, isBye: false, winnerRegistrationId: null } })
  for (const m of matches) {
    const homeWins = m.homeRegistrationId! < m.awayRegistrationId!
    const r = await recordSwissResult(actor, m.id, homeWins ? RACE : 0, homeWins ? 0 : RACE)
    if (!r.ok) throw new Error('report failed: ' + r.error)
  }
}

async function run(number: number, players: number) {
  const odd = players % 2 === 1
  console.log(`\n--- Swiss, ${players} players (${odd ? 'odd → byes' : 'even'}) ---`)
  const id = await makeTournament(number, players, null)
  try {
    const started = await startSwiss(actor, id)
    check('start swiss ok', started.ok)

    let st = await getSwissState(id)
    check('total rounds computed (>=3)', st.totalRounds >= 3)
    const r1 = st.rounds.find((r) => r.round === 1)!
    check('round 1 has ceil(n/2) boards incl. bye', r1.matches.length === Math.ceil(players / 2))
    check(odd ? 'odd field has exactly one round-1 bye' : 'even field has no bye', r1.matches.filter((m) => m.isBye).length === (odd ? 1 : 0))

    // Play every round; pair the next until the final round.
    for (let round = 1; round <= st.totalRounds; round++) {
      await playRound(id, round)
      st = await getSwissState(id)
      check(`round ${round} reports as complete`, st.roundComplete)
      if (round < st.totalRounds) {
        const p = await pairNextRound(actor, id)
        check(`paired round ${round + 1}`, p.ok)
      }
    }

    // Cannot pair beyond the final round.
    const beyond = await pairNextRound(actor, id)
    check('pairing beyond the final round is refused', !beyond.ok)

    st = await getSwissState(id)
    check('standings cover every player', st.standings.length === players)
    check('ranks are 1..n', st.standings.every((s, i) => s.rank === i + 1))
    // The player who wins every game (lowest reg id) tops the standings.
    const topName = st.standings[0].name
    check('undefeated player tops the standings', topName === `SW${number}_01`)

    // No player received more than one bye.
    const byeCounts = new Map<number, number>()
    for (const rd of st.rounds) for (const m of rd.matches) if (m.isBye && m.homeRegistrationId != null) byeCounts.set(m.homeRegistrationId, (byeCounts.get(m.homeRegistrationId) ?? 0) + 1)
    check('no player gets more than one bye', [...byeCounts.values()].every((c) => c <= 1))

    // No repeat opponents (avoidable at these field sizes).
    const met = new Set<string>()
    let repeats = 0
    for (const rd of st.rounds) for (const m of rd.matches) {
      if (m.isBye || m.homeRegistrationId == null || m.awayRegistrationId == null) continue
      const key = [m.homeRegistrationId, m.awayRegistrationId].sort((a, b) => a - b).join('-')
      if (met.has(key)) repeats++
      met.add(key)
    }
    check('no repeat opponents', repeats === 0)

    const done = await completeSwiss(actor, id)
    check('complete swiss ok', done.ok)
    const t = await prisma.tournament.findUniqueOrThrow({ where: { id } })
    check('tournament is COMPLETED', t.lifecycleState === 'COMPLETED')
    check('champion recorded', t.championName === `SW${number}_01`)
    check('ladder applied on completion', t.ladderAppliedAt != null)
    // Swiss results materialized into snapshot bracket rows so the Ladder credits each player.
    const materialized = await prisma.tournamentBracketMatch.count({ where: { tournamentId: id, bracketKind: 'MAIN' } })
    check('decided matches materialized for the Ladder', materialized > 0)
  } finally {
    await prisma.tournament.delete({ where: { id } }).catch(() => {})
    await prisma.auditLog.deleteMany({ where: { actorUsername: 'swiss-verify' } }).catch(() => {})
  }
}

await run(97001, 8)
await run(97002, 5)
const { regenerateTournamentSnapshot } = await import('../src/lib/tournaments/migrate.ts')
await regenerateTournamentSnapshot().catch(() => {})
console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
await prisma.$disconnect()
process.exit(fail === 0 ? 0 : 1)
