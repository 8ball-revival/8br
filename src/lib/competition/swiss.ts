import 'server-only'
import { prisma } from '@/lib/prisma'
import { recordAudit, type Actor } from './audit'
import { validateResult } from './scoring'
import { assertCompetitionUnlocked } from './service'
import { transitionTournamentState, getTournamentState } from './tournament-lifecycle'

/**
 * Swiss-system runtime. Swiss is round-based (not a bracket): every round pairs all active entrants
 * on current standings, avoiding rematches where possible, with a bye for an odd field. Standings
 * (match points + Buchholz + game differential) drive the next round's pairings and the final
 * placement. On completion each participant's INDIVIDUAL results feed the Ladder (via the snapshot).
 *
 * Data: one SwissMatch row per board per round. Standings/tiebreaks are computed from those rows.
 */

// ---- entrants + seeding ----------------------------------------------------

interface Entrant {
  registrationId: number
  name: string
  handle: string | null
  playerId: string | null
  order: number // registration order (stable)
}

/** Deterministic PRNG (mulberry32) so "random" seeding is stable per tournament + re-run-safe. */
function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

async function loadEntrants(tournamentId: number): Promise<Entrant[]> {
  const regs = await prisma.registration.findMany({
    where: { tournamentId, status: 'APPROVED' },
    orderBy: { id: 'asc' },
    select: { id: true, username: true, displayName: true, cueverseId: true, playerId: true },
  })
  return regs.map((r, i) => ({
    registrationId: r.id,
    name: r.displayName || r.username,
    handle: r.cueverseId,
    playerId: r.playerId,
    order: i,
  }))
}

/** Order entrants for round-1 pairing per the tournament's seeding method. rating/rank fall back to
 *  registration order (the live Ladder is the seed source once it has data; empty on a fresh field). */
function seedEntrants(entrants: Entrant[], method: string, tournamentId: number): Entrant[] {
  const list = [...entrants]
  if (method === 'random') {
    const rand = rng(tournamentId * 2654435761)
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1))
      ;[list[i], list[j]] = [list[j], list[i]]
    }
    return list
  }
  // 'registration' | 'rating' | 'rank' → registration order (stable).
  return list.sort((a, b) => a.order - b.order)
}

function defaultRounds(n: number): number {
  const desired = Math.max(3, Math.ceil(Math.log2(Math.max(2, n))))
  return Math.min(desired, Math.max(1, n - 1))
}

// ---- start -----------------------------------------------------------------

export async function startSwiss(actor: Actor, tournamentId: number): Promise<{ ok: boolean; error?: string }> {
  const t = await prisma.tournament.findUnique({ where: { id: tournamentId } })
  if (!t) return { ok: false, error: 'Tournament not found.' }
  if (t.tournamentFormat !== 'SWISS') return { ok: false, error: 'This is not a Swiss Tournament.' }
  if (getTournamentState(t) !== 'REGISTRATION_CLOSED') return { ok: false, error: 'Close registration before starting the Swiss rounds.' }

  const existing = await prisma.swissMatch.count({ where: { tournamentId } })
  if (existing > 0) return { ok: false, error: 'Swiss rounds have already been generated.' }

  const entrants = await loadEntrants(tournamentId)
  if (entrants.length < 2) return { ok: false, error: 'Need at least 2 approved players to start.' }

  const totalRounds = t.swissRounds && t.swissRounds > 0 ? Math.min(t.swissRounds, Math.max(1, entrants.length - 1)) : defaultRounds(entrants.length)
  const seeded = seedEntrants(entrants, t.seedingMethod || 'rating', tournamentId)

  await prisma.$transaction(async (tx) => {
    let board = 0
    const pool = [...seeded]
    // Odd field → weakest seed gets the round-1 bye.
    let bye: Entrant | null = null
    if (pool.length % 2 === 1) bye = pool.pop() ?? null
    const half = pool.length / 2
    for (let i = 0; i < half; i++) {
      const home = pool[i]
      const away = pool[i + half]
      await tx.swissMatch.create({
        data: { tournamentId, round: 1, boardOrder: board++, homeRegistrationId: home.registrationId, awayRegistrationId: away.registrationId, homeName: home.name, awayName: away.name },
      })
    }
    if (bye) {
      await tx.swissMatch.create({
        data: { tournamentId, round: 1, boardOrder: board++, homeRegistrationId: bye.registrationId, awayRegistrationId: null, homeName: bye.name, isBye: true, winnerRegistrationId: bye.registrationId, reportedAt: new Date() },
      })
    }
    await tx.tournament.update({ where: { id: tournamentId }, data: { swissRounds: totalRounds } })
    await recordAudit(actor, { action: 'swiss.start', entity: 'Tournament', entityId: tournamentId, newValue: { rounds: totalRounds, players: entrants.length } }, tx)
  })

  const tr = await transitionTournamentState(actor, tournamentId, 'IN_PROGRESS')
  if (!tr.ok) return { ok: false, error: tr.error }
  return { ok: true }
}

// ---- record a result -------------------------------------------------------

export async function recordSwissResult(actor: Actor, matchId: number, homeGames: number, awayGames: number, reason?: string): Promise<{ ok: boolean; error?: string }> {
  const m = await prisma.swissMatch.findUnique({ where: { id: matchId }, include: { tournament: true } })
  if (!m) return { ok: false, error: 'Match not found.' }
  await assertCompetitionUnlocked(prisma, m.tournamentId)
  if (m.isBye || m.homeRegistrationId == null || m.awayRegistrationId == null) return { ok: false, error: 'A bye has no score to report.' }
  // Swiss pairings need a winner every board (standings don't model draws), so a tie is rejected. Any
  // non-negative whole-number score is accepted; the configured race length is informational only.
  const res = validateResult(m.homeRegistrationId, m.awayRegistrationId, homeGames, awayGames, { allowDraw: false })
  if (!res.ok) return { ok: false, error: res.error }
  await prisma.swissMatch.update({ where: { id: matchId }, data: { homeGames, awayGames, winnerRegistrationId: res.winnerRegistrationId, reportedAt: new Date() } })
  await recordAudit(actor, { action: 'swiss.recordScore', entity: 'SwissMatch', entityId: matchId, oldValue: { homeGames: m.homeGames, awayGames: m.awayGames }, newValue: { homeGames, awayGames }, reason })
  return { ok: true }
}

// ---- standings -------------------------------------------------------------

/** A win, and a bye, are worth this many standings points. Matches the group-stage convention. */
export const WIN_POINTS = 2

export interface SwissStandingRow {
  registrationId: number
  name: string
  handle: string | null
  playerId: string | null
  rank: number
  points: number // match wins (incl. byes)
  played: number // decided matches (excl. byes)
  gameW: number
  gameL: number
  byes: number
  buchholz: number
}

async function computeStandings(tournamentId: number): Promise<SwissStandingRow[]> {
  const entrants = await loadEntrants(tournamentId)
  const byReg = new Map(entrants.map((e) => [e.registrationId, e]))
  const matches = await prisma.swissMatch.findMany({ where: { tournamentId }, orderBy: [{ round: 'asc' }, { boardOrder: 'asc' }] })

  const acc = new Map<number, { points: number; played: number; gameW: number; gameL: number; byes: number; opponents: number[] }>()
  const get = (id: number) => {
    let a = acc.get(id)
    if (!a) { a = { points: 0, played: 0, gameW: 0, gameL: 0, byes: 0, opponents: [] }; acc.set(id, a) }
    return a
  }
  for (const e of entrants) get(e.registrationId) // ensure every entrant appears

  /*
   * Standings points: a win is 2, a bye is 2, a loss is 0.
   *
   * The scale used to be 1 per win, which ordered players identically but disagreed with every other
   * table on the site — Season groups have scored Win 2 / Draw 1 for as long as they have existed.
   * Two tables using the word "points" for different quantities is the kind of difference nobody
   * notices until they compare them.
   *
   * A bye scores the same as a win because that is what a bye IS: an unopposed advance. It produces
   * no other record — no win, no loss, no games, no differential, no streak, no rating — which is
   * why it is counted here and nowhere else.
   */
  for (const m of matches) {
    if (m.isBye && m.homeRegistrationId != null) {
      const a = get(m.homeRegistrationId)
      a.points += WIN_POINTS
      a.byes += 1
      continue
    }
    if (m.winnerRegistrationId == null || m.homeRegistrationId == null || m.awayRegistrationId == null) continue
    const h = get(m.homeRegistrationId)
    const w = get(m.awayRegistrationId)
    h.opponents.push(m.awayRegistrationId)
    w.opponents.push(m.homeRegistrationId)
    h.played += 1
    w.played += 1
    h.gameW += m.homeGames ?? 0
    h.gameL += m.awayGames ?? 0
    w.gameW += m.awayGames ?? 0
    w.gameL += m.homeGames ?? 0
    if (m.winnerRegistrationId === m.homeRegistrationId) h.points += WIN_POINTS
    else w.points += WIN_POINTS
  }

  // Buchholz = sum of opponents' match points (byes contribute no opponent).
  const pointsOf = (id: number) => acc.get(id)?.points ?? 0
  const rows: SwissStandingRow[] = entrants.map((e) => {
    const a = get(e.registrationId)
    const buchholz = a.opponents.reduce((s, oid) => s + pointsOf(oid), 0)
    return { registrationId: e.registrationId, name: e.name, handle: e.handle, playerId: e.playerId, rank: 0, points: a.points, played: a.played, gameW: a.gameW, gameL: a.gameL, byes: a.byes, buchholz }
  })
  /*
   * Points, Buchholz, game differential, game win percentage, then the original seed.
   *
   * Win percentage was missing and matters exactly where differential cannot separate: +4 from 12-8
   * and +4 from 20-16 are the same margin over very different volumes. The seed is last because it
   * is the one thing guaranteed to break every remaining tie, so the order stays total and stable.
   */
  const winPct = (r: SwissStandingRow) => (r.gameW + r.gameL === 0 ? 0 : r.gameW / (r.gameW + r.gameL))
  rows.sort((x, y) =>
    y.points - x.points ||
    y.buchholz - x.buchholz ||
    (y.gameW - y.gameL) - (x.gameW - x.gameL) ||
    winPct(y) - winPct(x) ||
    (byReg.get(x.registrationId)?.order ?? 0) - (byReg.get(y.registrationId)?.order ?? 0),
  )
  rows.forEach((r, i) => (r.rank = i + 1))
  return rows
}

// ---- round state -----------------------------------------------------------

async function roundComplete(tournamentId: number, round: number): Promise<boolean> {
  const pending = await prisma.swissMatch.count({ where: { tournamentId, round, isBye: false, winnerRegistrationId: null } })
  return pending === 0
}

export interface SwissState {
  totalRounds: number
  currentRound: number
  roundComplete: boolean
  canPairNext: boolean
  canComplete: boolean
  rounds: { round: number; matches: { id: number; boardOrder: number; homeRegistrationId: number | null; awayRegistrationId: number | null; homeName: string | null; awayName: string | null; homeGames: number | null; awayGames: number | null; winnerRegistrationId: number | null; isBye: boolean }[] }[]
  standings: SwissStandingRow[]
}

export async function getSwissState(tournamentId: number): Promise<SwissState> {
  const t = await prisma.tournament.findUniqueOrThrow({ where: { id: tournamentId }, select: { swissRounds: true, lifecycleState: true, status: true } })
  const totalRounds = t.swissRounds ?? 0
  // Once the tournament is finished, no more Swiss management actions are offered.
  const isDone = t.lifecycleState === 'COMPLETED' || t.lifecycleState === 'CANCELLED' || t.status === 'COMPLETED'
  const all = await prisma.swissMatch.findMany({ where: { tournamentId }, orderBy: [{ round: 'asc' }, { boardOrder: 'asc' }] })
  const currentRound = all.reduce((m, x) => Math.max(m, x.round), 0)
  const byRound = new Map<number, SwissState['rounds'][number]['matches']>()
  for (const m of all) {
    if (!byRound.has(m.round)) byRound.set(m.round, [])
    byRound.get(m.round)!.push({ id: m.id, boardOrder: m.boardOrder, homeRegistrationId: m.homeRegistrationId, awayRegistrationId: m.awayRegistrationId, homeName: m.homeName, awayName: m.awayName, homeGames: m.homeGames, awayGames: m.awayGames, winnerRegistrationId: m.winnerRegistrationId, isBye: m.isBye })
  }
  const rounds = [...byRound.keys()].sort((a, b) => a - b).map((r) => ({ round: r, matches: byRound.get(r)! }))
  const complete = currentRound > 0 ? await roundComplete(tournamentId, currentRound) : false
  return {
    totalRounds,
    currentRound,
    roundComplete: complete,
    canPairNext: !isDone && complete && currentRound > 0 && currentRound < totalRounds,
    canComplete: !isDone && complete && currentRound > 0 && currentRound >= totalRounds,
    rounds,
    standings: await computeStandings(tournamentId),
  }
}

// ---- pair the next round ---------------------------------------------------

export async function pairNextRound(actor: Actor, tournamentId: number): Promise<{ ok: boolean; error?: string; round?: number }> {
  const t = await prisma.tournament.findUnique({ where: { id: tournamentId }, select: { swissRounds: true, tournamentFormat: true } })
  if (!t || t.tournamentFormat !== 'SWISS') return { ok: false, error: 'This is not a Swiss Tournament.' }
  await assertCompetitionUnlocked(prisma, tournamentId)
  const totalRounds = t.swissRounds ?? 0
  const all = await prisma.swissMatch.findMany({ where: { tournamentId } })
  const currentRound = all.reduce((m, x) => Math.max(m, x.round), 0)
  if (currentRound === 0) return { ok: false, error: 'Start the Swiss rounds first.' }
  if (currentRound >= totalRounds) return { ok: false, error: 'All Swiss rounds have been played.' }
  if (!(await roundComplete(tournamentId, currentRound))) return { ok: false, error: 'Report every result in the current round first.' }

  const standings = await computeStandings(tournamentId)

  // Prior opponents + prior byes (avoid repeats where possible).
  const played = new Map<number, Set<number>>()
  const hadBye = new Set<number>()
  for (const m of all) {
    if (m.isBye && m.homeRegistrationId != null) { hadBye.add(m.homeRegistrationId); continue }
    if (m.homeRegistrationId != null && m.awayRegistrationId != null) {
      if (!played.has(m.homeRegistrationId)) played.set(m.homeRegistrationId, new Set())
      if (!played.has(m.awayRegistrationId)) played.set(m.awayRegistrationId, new Set())
      played.get(m.homeRegistrationId)!.add(m.awayRegistrationId)
      played.get(m.awayRegistrationId)!.add(m.homeRegistrationId)
    }
  }
  const haveMet = (a: number, b: number) => played.get(a)?.has(b) ?? false

  const nameOf = new Map(standings.map((s) => [s.registrationId, s.name]))
  const pool = standings.map((s) => s.registrationId) // standings order (rank asc)

  // Odd field → lowest-ranked player without a prior bye gets the bye.
  let byeReg: number | null = null
  if (pool.length % 2 === 1) {
    for (let i = pool.length - 1; i >= 0; i--) {
      if (!hadBye.has(pool[i])) { byeReg = pool[i]; break }
    }
    if (byeReg == null) byeReg = pool[pool.length - 1] // everyone already had one → lowest ranked
    pool.splice(pool.indexOf(byeReg), 1)
  }

  // Greedy pairing down the standings, preferring a non-rematch; fall back to a rematch only if
  // no fresh opponent remains (guarantees the round completes).
  const remaining = [...pool]
  const pairs: [number, number][] = []
  while (remaining.length > 0) {
    const a = remaining.shift()!
    let idx = remaining.findIndex((b) => !haveMet(a, b))
    if (idx === -1) idx = 0 // unavoidable rematch
    const b = remaining.splice(idx, 1)[0]
    pairs.push([a, b])
  }

  const nextRound = currentRound + 1
  await prisma.$transaction(async (tx) => {
    let board = 0
    for (const [a, b] of pairs) {
      await tx.swissMatch.create({ data: { tournamentId, round: nextRound, boardOrder: board++, homeRegistrationId: a, awayRegistrationId: b, homeName: nameOf.get(a) ?? null, awayName: nameOf.get(b) ?? null } })
    }
    if (byeReg != null) {
      await tx.swissMatch.create({ data: { tournamentId, round: nextRound, boardOrder: board++, homeRegistrationId: byeReg, awayRegistrationId: null, homeName: nameOf.get(byeReg) ?? null, isBye: true, winnerRegistrationId: byeReg, reportedAt: new Date() } })
    }
    await recordAudit(actor, { action: 'swiss.pairRound', entity: 'Tournament', entityId: tournamentId, newValue: { round: nextRound, pairings: pairs.length, bye: byeReg != null } }, tx)
  })
  return { ok: true, round: nextRound }
}

// ---- complete --------------------------------------------------------------

export async function completeSwiss(actor: Actor, tournamentId: number): Promise<{ ok: boolean; error?: string }> {
  const t = await prisma.tournament.findUnique({ where: { id: tournamentId }, select: { swissRounds: true, tournamentFormat: true } })
  if (!t || t.tournamentFormat !== 'SWISS') return { ok: false, error: 'This is not a Swiss Tournament.' }
  const totalRounds = t.swissRounds ?? 0
  const all = await prisma.swissMatch.findMany({ where: { tournamentId } })
  const currentRound = all.reduce((m, x) => Math.max(m, x.round), 0)
  if (currentRound < totalRounds) return { ok: false, error: 'Play all Swiss rounds before finishing.' }
  if (!(await roundComplete(tournamentId, currentRound))) return { ok: false, error: 'Report every result in the final round first.' }

  const standings = await computeStandings(tournamentId)
  const champ = standings[0]
  const runner = standings[1]
  await prisma.tournament.update({
    where: { id: tournamentId },
    data: { championName: champ?.name ?? null, championHandle: champ?.handle ?? null, runnerUpName: runner?.name ?? null, runnerUpHandle: runner?.handle ?? null },
  })
  const tr = await transitionTournamentState(actor, tournamentId, 'COMPLETED')
  if (!tr.ok) return { ok: false, error: tr.error }
  return { ok: true }
}
