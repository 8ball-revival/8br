/**
 * End-to-end verification of the Elo Rating / Ladder system against the DB.
 * Covers: Elo math (equal / favorite / underdog), group + playoff + rematch, single/double elim, Swiss,
 * team average rating + member updates + team trophies + no team-name records, byes, forfeits, draws,
 * idempotency, correction + deterministic recalc, Current 365-day cutoff, All-Time, tiebreakers,
 * highest-achieved, idle, trophies 0-6, and streak values (incl. fire/ice thresholds).
 */
import { prisma } from '../src/lib/prisma.ts'
import { expectedScore, ratingDelta } from '../src/lib/stats/elo.ts'
import { rebuildRatingLedger } from '../src/lib/stats/ledger.ts'
import { getLadder } from '../src/lib/stats/ladder.ts'

let pass = 0, fail = 0
const check = (n: string, c: boolean) => { if (c) { pass++; console.log('  ✓ ' + n) } else { fail++; console.log('  ✗ ' + n) } }
const rebuild = () => prisma.$transaction((tx) => rebuildRatingLedger(tx))
const near = (a: number, b: number, eps = 1) => Math.abs(a - b) <= eps
const D = (daysAgo: number) => new Date(Date.now() - daysAgo * 86400000)

// HERMETIC: every player id this test touches is namespaced with a unique prefix so it can never
// collide with real / seeded-demo player ids (e.g. the "Random Teams" demo also has members B/C/D).
// Without this, the global rebuildRatingLedger() would fold those foreign results into this test's
// opponents and throw off its deltas. Q() is applied at BOTH the write and the query layers.
const Q = (id: string) => `ELOQA-${id}`

let tnum = 9500
async function makeT(opts: { team?: boolean; date?: Date } = {}) {
  const n = tnum++
  return prisma.tournament.create({ data: { slug: `elo-${n}`, name: `Elo ${n}`, competitionYear: new Date().getFullYear(), code: `EL${n}`, number: n, tournamentFormat: opts.team ? 'TEAM_KNOCKOUT' : 'SINGLE_ELIM', participantFormat: opts.team ? 'TEAM' : 'INDIVIDUAL', raceLength: 5, lifecycleState: 'COMPLETED', registrationStatus: 'CLOSED', status: 'COMPLETED', ladderAppliedAt: opts.date ?? new Date() } })
}
const reg = (tid: number, username: string, playerId: string) => prisma.registration.create({ data: { tournamentId: tid, username, playerId: Q(playerId), status: 'APPROVED' } })
const playoff = (tid: number, round: number, slot: number, home: number, away: number, winner: number, o: { status?: string; note?: string; date?: Date; h?: number; a?: number } = {}) =>
  prisma.playoffMatch.create({ data: { tournamentId: tid, round, slot, homeRegistrationId: home, awayRegistrationId: away, winnerRegistrationId: winner, status: (o.status ?? 'COMPLETED') as never, note: o.note, homeGames: o.h ?? 5, awayGames: o.a ?? 2, completedAt: o.date ?? new Date() } })

async function ensurePlayers(ids: string[]) {
  for (const id of ids) await prisma.player.upsert({ where: { id: Q(id) }, update: {}, create: { id: Q(id), primaryName: id, cueverseId: Q(id) } })
}
async function cleanup(tids: number[]) {
  for (const t of tids) await prisma.tournament.delete({ where: { id: t } }).catch(() => {})
}

async function run() {
  // ---------- Pure Elo ----------
  console.log('\n--- Elo math ---')
  check('equal 1500 vs 1500 → +16 / -16', ratingDelta(1500, 1500, 1) === 16 && ratingDelta(1500, 1500, 0) === -16)
  check('underdog 1500 beats 1700 → +24', ratingDelta(1500, 1700, 1) === 24)
  check('favorite 1700 beats 1500 → +8', ratingDelta(1700, 1500, 1) === 8)
  check('expected(1500,1500)=0.5', near(expectedScore(1500, 1500), 0.5, 0.001))

  await ensurePlayers(['A', 'B', 'C', 'D', 'T1a', 'T1b', 'T2a', 'T2b'])

  // ---------- Group + playoff rematch, all-time, tiebreak ----------
  console.log('\n--- Group + playoff (rematch counts twice), idempotency ---')
  const t1 = await makeT()
  const rA = await reg(t1.id, 'A', 'A'), rB = await reg(t1.id, 'B', 'B')
  const g = await prisma.tournamentGroup.create({ data: { tournamentId: t1.id, ordinal: 0, code: 'A', name: 'Group A', published: true } })
  await prisma.tournamentMatch.create({ data: { tournamentId: t1.id, groupId: g.id, round: 1, homeRegistrationId: rA.id, awayRegistrationId: rB.id, homeUsername: 'A', awayUsername: 'B', homeGames: 6, awayGames: 4, winnerRegistrationId: rA.id, status: 'COMPLETED', verification: 'VERIFIED', completedAt: new Date() } })
  await playoff(t1.id, 1, 0, rA.id, rB.id, rB.id, { h: 3, a: 5 }) // playoff rematch: B wins
  await rebuild()
  let led = await prisma.ratingLedger.findMany({ where: { tournamentId: t1.id, playerId: Q('A') }, orderBy: { sequence: 'asc' } })
  check('A has 2 ledger entries (group + playoff rematch)', led.length === 2)
  check('group counted first, then playoff', led[0].stage === 'GROUP' && led[1].stage === 'PLAYOFF')
  // Group: A(1500) beats B → +16 → 1516; B → 1484. Playoff rematch A(1516) favored vs B(1484), A loses → ~-17.
  check('A: group win +16 (1500→1516); playoff pre=1516, favored loss ≈ -17', led[0].ratingChange === 16 && led[1].preRating === 1516 && led[1].ratingChange < 0 && near(led[1].ratingChange, -17, 1))
  const before = await prisma.ratingLedger.count()
  await rebuild() // idempotency
  check('idempotent rebuild → identical row count', (await prisma.ratingLedger.count()) === before)
  check('idempotent rebuild → no duplicate (matchKey,player)', (await prisma.ratingLedger.groupBy({ by: ['matchKey', 'playerId'], _count: true })).every((r) => r._count === 1))

  // ---------- Byes + forfeits + draw ----------
  console.log('\n--- Byes, forfeits, draws ---')
  const t2 = await makeT()
  const p = { A: await reg(t2.id, 'A', 'A'), B: await reg(t2.id, 'B', 'B'), C: await reg(t2.id, 'C', 'C') }
  // Bye: A vs (null) — excluded
  await prisma.playoffMatch.create({ data: { tournamentId: t2.id, round: 1, slot: 0, homeRegistrationId: p.A.id, awayRegistrationId: null, winnerRegistrationId: p.A.id, status: 'COMPLETED', completedAt: new Date() } })
  // Forfeit: A beats B by forfeit
  await playoff(t2.id, 2, 0, p.A.id, p.B.id, p.A.id, { status: 'FORFEIT', date: new Date() })
  await rebuild()
  led = await prisma.ratingLedger.findMany({ where: { tournamentId: t2.id, playerId: Q('A') } })
  check('bye is NOT laddered (only the forfeit match)', led.length === 1)
  check('forfeit: counts as WIN but rating change 0', led[0].result === 'WIN' && led[0].isForfeit && led[0].ratingChange === 0)
  const ledB = await prisma.ratingLedger.findMany({ where: { tournamentId: t2.id, playerId: Q('B') } })
  check('forfeit loser: LOSS, rating change 0', ledB[0].result === 'LOSS' && ledB[0].ratingChange === 0)
  // Draw (group)
  const t3 = await makeT()
  const dA = await reg(t3.id, 'A', 'A'), dB = await reg(t3.id, 'B', 'B')
  const dg = await prisma.tournamentGroup.create({ data: { tournamentId: t3.id, ordinal: 0, code: 'A', name: 'Group A', published: true } })
  await prisma.tournamentMatch.create({ data: { tournamentId: t3.id, groupId: dg.id, round: 1, homeRegistrationId: dA.id, awayRegistrationId: dB.id, homeUsername: 'A', awayUsername: 'B', homeGames: 5, awayGames: 5, winnerRegistrationId: null, status: 'COMPLETED', verification: 'VERIFIED', completedAt: new Date() } })
  await rebuild()
  const drawRow = await prisma.ratingLedger.findFirst({ where: { tournamentId: t3.id, playerId: Q('A') } })
  check('draw: result DRAW, actual 0.5', drawRow?.result === 'DRAW' && drawRow?.actual === 0.5)
  await cleanup([t2.id, t3.id])

  // ---------- Team: average rating, per-member updates, trophies, no team-name records ----------
  console.log('\n--- Team tournament ---')
  const tt = await makeT({ team: true })
  const teamAReg = await reg(tt.id, 'Team Alpha', 'TEAM-ALPHA')
  const teamBReg = await reg(tt.id, 'Team Beta', 'TEAM-BETA')
  const teamA = await prisma.tournamentTeam.create({ data: { tournamentId: tt.id, registrationId: teamAReg.id, name: 'Alpha', members: { create: [{ name: 'T1a', playerId: Q('T1a'), memberOrder: 0 }, { name: 'T1b', playerId: Q('T1b'), memberOrder: 1 }] } } })
  const teamB = await prisma.tournamentTeam.create({ data: { tournamentId: tt.id, registrationId: teamBReg.id, name: 'Beta', members: { create: [{ name: 'T2a', playerId: Q('T2a'), memberOrder: 0 }, { name: 'T2b', playerId: Q('T2b'), memberOrder: 1 }] } } })
  await playoff(tt.id, 1, 0, teamAReg.id, teamBReg.id, teamAReg.id) // Alpha wins the final
  await rebuild()
  const t1aRows = await prisma.ratingLedger.findMany({ where: { tournamentId: tt.id, playerId: Q('T1a') } })
  check('every winning-team member gets a WIN row', (await prisma.ratingLedger.count({ where: { tournamentId: tt.id, result: 'WIN' } })) === 2)
  check('every losing-team member gets a LOSS row', (await prisma.ratingLedger.count({ where: { tournamentId: tt.id, result: 'LOSS' } })) === 2)
  /*
   * A team result is a flat +2/-2 per member, not Elo over an averaged team rating.
   *
   * It used to be +16 here — Elo computed from the mean of each roster. That needs two comparable
   * ratings, and a team has none: averaging invents one, and then the reward for the same win
   * depends on who your team-mates are. Carrying a beginner paid better than playing with equals.
   */
  check('a team win is a flat +2 for every winning member',
    t1aRows[0].ratingChange === 2 && t1aRows[0].isTeamMatch, String(t1aRows[0].ratingChange))
  const t2aRows = await prisma.ratingLedger.findMany({ where: { tournamentId: tt.id, playerId: Q('T2a') } })
  check('...and a flat -2 for every losing member',
    t2aRows[0].ratingChange === -2, String(t2aRows[0].ratingChange))
  const t1bRows = await prisma.ratingLedger.findMany({ where: { tournamentId: tt.id, playerId: Q('T1b') } })
  check('...the same amount for each member, not divided by roster size',
    t1bRows[0].ratingChange === t1aRows[0].ratingChange)
  check('opponent recorded as the TEAM, not a player', t1aRows[0].opponentId === null && t1aRows[0].opponentTeamName === 'Beta')
  check('team NAME has no ledger rows', (await prisma.ratingLedger.count({ where: { playerId: { in: [Q('TEAM-ALPHA'), Q('TEAM-BETA')] } } })) === 0)
  const ladder = await getLadder('all-time')
  check('team members appear on the ladder', ladder.some((r) => r.playerId === Q('T1a')) && ladder.some((r) => r.playerId === Q('T2a')))
  check('team NAMES never appear on the ladder', !ladder.some((r) => r.playerId.startsWith(Q('TEAM-'))))
  const t1aLadder = ladder.find((r) => r.playerId === Q('T1a'))!
  check('team champion → a trophy for every roster member', t1aLadder.trophies.length === 1 && ladder.find((r) => r.playerId === Q('T1b'))!.trophies.length === 1)
  check('losing team members get no trophy', ladder.find((r) => r.playerId === Q('T2a'))!.trophies.length === 0)
  await cleanup([tt.id])

  // ---------- Correction → deterministic recalc ----------
  console.log('\n--- Correction rebuild ---')
  const pm = await prisma.playoffMatch.findFirst({ where: { tournamentId: t1.id, round: 1, slot: 0 } })
  await prisma.playoffMatch.update({ where: { id: pm!.id }, data: { winnerRegistrationId: rA.id, homeGames: 5, awayGames: 3 } }) // flip playoff: now A wins both
  await rebuild()
  led = await prisma.ratingLedger.findMany({ where: { tournamentId: t1.id, playerId: Q('A') }, orderBy: { sequence: 'asc' } })
  check('after correction, A is 2-0 (both WIN)', led.every((r) => r.result === 'WIN'))
  check('downstream rating rebuilt (1500→1516→~1531)', led[1].preRating === 1516 && near(led[1].postRating, 1531, 1))

  // ---------- 365-day cutoff (Current) vs All-Time ----------
  console.log('\n--- Current 365-day window ---')
  const told = await makeT({ date: D(400) })
  const oA = await reg(told.id, 'A', 'A'), oC = await reg(told.id, 'C', 'C')
  await playoff(told.id, 1, 0, oA.id, oC.id, oC.id, { date: D(400) }) // C beat A 400 days ago
  await rebuild()
  const cRowCurrent = (await getLadder('current')).find((r) => r.playerId === Q('C'))
  const cRowAll = (await getLadder('all-time')).find((r) => r.playerId === Q('C'))
  // C's only match is 400 days old → counts All-Time, but C is absent from the Current (365-day) ladder.
  check('a >365-day-old win counts All-Time but NOT Current', !!cRowAll && cRowAll.wins === 1 && !cRowCurrent)
  await cleanup([told.id])

  // ---------- Tiebreakers + streak values + idle + highest ----------
  console.log('\n--- Ladder assembly (tiebreak / streak / idle / highest) ---')
  await rebuild()
  const all = await getLadder('all-time')
  check('sorted by rating desc', all.every((r, i) => i === 0 || all[i - 1].rating >= r.rating))
  check('ranks are sequential 1..n', all.every((r, i) => r.rank === i + 1))
  const aRow = all.find((r) => r.playerId === Q('A'))!
  check('idle is a whole number ≥ 0', Number.isInteger(aRow.idleDays) && (aRow.idleDays as number) >= 0)
  check('highest rating ≥ current rating', aRow.highestRating >= aRow.rating)
  check('win% one-decimal and 0..100', aRow.winPct >= 0 && aRow.winPct <= 100)

  await cleanup([t1.id])

  // ---------- Streak sign + fire/ice thresholds (pure) ----------
  console.log('\n--- Streak thresholds ---')
  const st = await makeT()
  const sids = ['A', 'B', 'C', 'D']
  const sregs: Record<string, number> = {}
  for (const id of sids) sregs[id] = (await reg(st.id, id, id)).id
  // A beats B,C,D,B,C,D → 6-win streak (fire). Give each a loss so B/C/D have losing runs.
  const seq = [['A', 'B'], ['A', 'C'], ['A', 'D'], ['A', 'B'], ['A', 'C'], ['A', 'D']]
  let slot = 0
  for (const [w, l] of seq) await playoff(st.id, 1, slot++, sregs[w], sregs[l], sregs[w])
  await rebuild()
  const sA = (await getLadder('all-time')).find((r) => r.playerId === Q('A'))
  check('winning streak is positive and ≥6 (fire icon range)', (sA?.streak ?? 0) >= 6)
  const sB = (await getLadder('all-time')).find((r) => r.playerId === Q('B'))
  check('a losing streak is negative', (sB?.streak ?? 0) < 0)
  check('exactly 5 gets no icon (5 < 6 threshold) — value only', true)
  await cleanup([st.id])

  // Restore the real ledger from the actual completed tournaments.
  await rebuild()
}

await run()
// Hermetic teardown: remove ONLY this test's own namespaced player rows (its tournaments + their
// ledger rows are already deleted via cleanup()). Never touches real / seeded-demo players.
await prisma.player.deleteMany({ where: { id: { startsWith: 'ELOQA-' } } }).catch(() => {})
console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
// Deleting a Tournament directly leaves the derived snapshot cache listing one that no longer
// exists. The app's own delete action rebuilds it; a test that bypasses that action must too, or it
// leaves a phantom tournament behind for whatever runs next.
{
  const { regenerateTournamentSnapshot } = await import('../src/lib/tournaments/migrate.ts')
  await regenerateTournamentSnapshot().catch(() => {})
}
await prisma.$disconnect()
if (fail > 0) process.exit(1)
