import 'server-only'
import type { Prisma, SeasonQualification } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { recordAudit, type Actor } from '@/lib/competition/audit'
import { validateResult } from '@/lib/competition/scoring'
import { planBracket, type Qualifier } from '@/lib/competition/bracket'
import { planDoubleElim } from '@/lib/competition/bracket-de'
import type { BracketRound, BracketMatch as ViewMatch } from '@/lib/tournaments/fixtures'
import { transitionSeasonState } from './lifecycle'
import { SEASON_QUALIFIERS_PER_GROUP } from './group-stage'

/**
 * SEASON PLAYOFFS — locked-seed selection, private draft bracket (single/double elim), publish, and
 * live result reporting with downstream rebuild. Reuses the pure bracket planners; persists to the
 * Season-owned season_playoff_match table.
 */

// ---- Seeding --------------------------------------------------------------

export interface SeasonSeedRow {
  entrantId: number
  name: string
  cueverseId: string | null
  group: string
  groupPosition: number
  points: number
  record: string // W-L-D
  winPct: number
  included: boolean
  qualification: SeasonQualification
  overallSeed: number | null
}

const winPctOf = (gw: number, gl: number) => (gw + gl === 0 ? 0 : gw / (gw + gl))

/** The complete, LOCKED seeding list. Order: all group winners, then all 2nd, then all 3rd, then
 *  wildcards; within each tier by points → win% → locked registration-close rating. Players cannot be
 *  manually reordered — this order is derived, not editable. */
export async function loadSeasonSeeding(seasonId: number): Promise<SeasonSeedRow[]> {
  const standings = await prisma.seasonStanding.findMany({ where: { seasonId }, include: { group: { select: { code: true, name: true } } } })
  const entrants = await prisma.seasonEntrant.findMany({ where: { seasonId }, select: { id: true, displayName: true, username: true, cueverseId: true, ratingSnapshot: true, kickedOut: true, playoffIncluded: true, qualification: true } })
  const entById = new Map(entrants.map((e) => [e.id, e]))

  const rows = standings
    .map((s) => {
      const e = entById.get(s.entrantId)
      if (!e) return null
      return {
        entrantId: s.entrantId,
        name: e.displayName?.trim() || e.username,
        cueverseId: e.cueverseId,
        group: s.group.name || s.group.code,
        groupPosition: s.rank,
        points: s.points,
        record: `${s.wins}-${s.losses}-${s.draws}`,
        winPct: winPctOf(s.gamesWon, s.gamesLost),
        rating: e.ratingSnapshot ?? 1500,
        included: e.playoffIncluded,
        qualification: e.qualification,
        kicked: e.kickedOut,
      }
    })
    .filter((r): r is NonNullable<typeof r> => !!r)

  // Tier: winners=1, 2nd=2, 3rd=3, wildcards=4 (wildcards follow auto-qualifiers regardless of position).
  const tierOf = (r: (typeof rows)[number]) => (r.qualification === 'WILDCARD' ? 4 : r.groupPosition)
  const included = rows.filter((r) => r.included && !r.kicked)
  included.sort((a, b) => tierOf(a) - tierOf(b) || b.points - a.points || b.winPct - a.winPct || b.rating - a.rating || a.entrantId - b.entrantId)
  const seedByEntrant = new Map(included.map((r, i) => [r.entrantId, i + 1]))

  return rows
    .sort((a, b) => (seedByEntrant.get(a.entrantId) ?? 1e9) - (seedByEntrant.get(b.entrantId) ?? 1e9) || tierOf(a) - tierOf(b) || b.points - a.points)
    .map((r) => ({
      entrantId: r.entrantId,
      name: r.name,
      cueverseId: r.cueverseId,
      group: r.group,
      groupPosition: r.groupPosition,
      points: r.points,
      record: r.record,
      winPct: r.winPct,
      included: r.included && !r.kicked,
      qualification: r.kicked ? 'KICKED_OUT' : r.qualification,
      overallSeed: seedByEntrant.get(r.entrantId) ?? null,
    }))
}

// ---- Enter setup + default qualifiers -------------------------------------

/** Open the playoff setup phase and auto-select the top-three eligible players from every group as
 *  Automatic Qualifiers. */
export async function enterSeasonPlayoffSetup(actor: Actor, seasonId: number): Promise<{ ok: boolean; error?: string }> {
  const s = await prisma.season.findUnique({ where: { id: seasonId }, select: { lifecycleState: true } })
  if (!s) return { ok: false, error: 'Season not found.' }
  if (s.lifecycleState !== 'GROUPS_CLOSED') return { ok: false, error: 'Open playoff setup from the Groups Closed phase.' }
  const standings = await prisma.seasonStanding.findMany({ where: { seasonId }, select: { entrantId: true, rank: true } })
  const kicked = new Set((await prisma.seasonEntrant.findMany({ where: { seasonId, kickedOut: true }, select: { id: true } })).map((e) => e.id))
  const auto = standings.filter((s2) => s2.rank <= SEASON_QUALIFIERS_PER_GROUP && !kicked.has(s2.entrantId)).map((s2) => s2.entrantId)

  await prisma.$transaction(async (tx) => {
    await tx.seasonEntrant.updateMany({ where: { seasonId, kickedOut: false }, data: { playoffIncluded: false, qualification: 'NOT_SELECTED', qualificationReason: null } })
    if (auto.length) await tx.seasonEntrant.updateMany({ where: { seasonId, id: { in: auto } }, data: { playoffIncluded: true, qualification: 'AUTOMATIC' } })
    await recordAudit(actor, { action: 'season.playoff.setup', entity: 'Season', entityId: seasonId, newValue: { autoQualifiers: auto.length } }, tx)
    const t = await transitionSeasonState(actor, seasonId, 'PLAYOFF_SETUP', { tx })
    if (!t.ok) throw new Error(t.error)
  })
  return { ok: true }
}

// ---- Selection changes (invalidate any draft) -----------------------------

async function invalidateDraft(tx: Prisma.TransactionClient, seasonId: number): Promise<void> {
  await tx.seasonPlayoffMatch.deleteMany({ where: { seasonId, published: false } })
}

export type QualAction = 'disqualify' | 'wildcard' | 'restore'

export async function setSeasonQualification(actor: Actor, seasonId: number, entrantId: number, action: QualAction, reason?: string): Promise<{ ok: boolean; error?: string }> {
  const s = await prisma.season.findUnique({ where: { id: seasonId }, select: { lifecycleState: true } })
  if (s?.lifecycleState !== 'PLAYOFF_SETUP') return { ok: false, error: 'Qualification can only be changed during playoff setup.' }
  const e = await prisma.seasonEntrant.findFirst({ where: { id: entrantId, seasonId } })
  if (!e) return { ok: false, error: 'Entrant not found.' }
  if (e.kickedOut) return { ok: false, error: 'Kicked-out players cannot be selected.' }
  if ((action === 'disqualify' || action === 'wildcard') && !reason?.trim()) return { ok: false, error: 'A reason is required.' }

  const data =
    action === 'disqualify' ? { playoffIncluded: false, qualification: 'DISQUALIFIED' as const, qualificationReason: reason!.trim() }
    : action === 'wildcard' ? { playoffIncluded: true, qualification: 'WILDCARD' as const, qualificationReason: reason!.trim() }
    : { playoffIncluded: true, qualification: 'AUTOMATIC' as const, qualificationReason: null }

  await prisma.$transaction(async (tx) => {
    await tx.seasonEntrant.update({ where: { id: entrantId }, data })
    await recordAudit(actor, { action: `season.playoff.${action}`, entity: 'Season', entityId: seasonId, newValue: { entrantId }, reason: reason?.trim() }, tx)
    await invalidateDraft(tx, seasonId) // selection changed → any draft bracket is stale
  })
  return { ok: true }
}

export async function setSeasonPlayoffType(actor: Actor, seasonId: number, doubleElim: boolean): Promise<{ ok: boolean; error?: string }> {
  const s = await prisma.season.findUnique({ where: { id: seasonId }, select: { lifecycleState: true } })
  if (s?.lifecycleState !== 'PLAYOFF_SETUP') return { ok: false, error: 'The bracket type can only be set during playoff setup.' }
  await prisma.$transaction(async (tx) => {
    await tx.season.update({ where: { id: seasonId }, data: { playoffDoubleElim: doubleElim } })
    await recordAudit(actor, { action: 'season.playoff.type', entity: 'Season', entityId: seasonId, newValue: { doubleElim } }, tx)
    await invalidateDraft(tx, seasonId)
  })
  return { ok: true }
}

// ---- Generate + publish ---------------------------------------------------

const deRound = (section: string, round: number) => (section === 'WB' ? round : section === 'LB' ? 100 + round : 201)

/** Build a PRIVATE draft bracket from the included players in locked seed order (single or double
 *  elim per the Season setting). Byes are handled automatically. Replaces any prior draft. */
export async function generateSeasonBracket(actor: Actor, seasonId: number): Promise<{ ok: boolean; error?: string; matches?: number }> {
  const s = await prisma.season.findUnique({ where: { id: seasonId }, select: { lifecycleState: true, playoffDoubleElim: true } })
  if (s?.lifecycleState !== 'PLAYOFF_SETUP') return { ok: false, error: 'Generate the bracket during playoff setup.' }
  const seeding = (await loadSeasonSeeding(seasonId)).filter((r) => r.included && r.overallSeed != null)
  if (seeding.length < 2) return { ok: false, error: 'Select at least two players for the playoffs.' }
  const qualifiers: Qualifier[] = seeding.map((r) => ({ registrationId: r.entrantId, username: r.name, seed: r.overallSeed! }))

  await prisma.$transaction(async (tx) => {
    await tx.seasonPlayoffMatch.deleteMany({ where: { seasonId } })
    if (s.playoffDoubleElim) {
      const plan = planDoubleElim(qualifiers)
      const idByIndex = new Map<number, number>()
      for (const m of plan.matches) {
        const row = await tx.seasonPlayoffMatch.create({ data: { seasonId, section: m.section, round: deRound(m.section, m.round), slot: m.slot, label: m.label, homeEntrantId: m.home.registrationId, awayEntrantId: m.away.registrationId, homeUsername: m.home.username, awayUsername: m.away.username, homeSeed: m.home.seed, awaySeed: m.away.seed } })
        idByIndex.set(m.index, row.id)
      }
      for (const m of plan.matches) {
        await tx.seasonPlayoffMatch.update({ where: { id: idByIndex.get(m.index)! }, data: { feedsMatchId: m.feedsIndex != null ? idByIndex.get(m.feedsIndex) : null, feedsSlot: m.feedsSlot, loserFeedsMatchId: m.loserFeedsIndex != null ? idByIndex.get(m.loserFeedsIndex) : null, loserFeedsSlot: m.loserFeedsSlot } })
      }
    } else {
      const plan = planBracket(qualifiers)
      const idByIndex = new Map<number, number>()
      for (const m of plan.matches) {
        const row = await tx.seasonPlayoffMatch.create({ data: { seasonId, round: m.round, slot: m.slot, label: m.label, homeEntrantId: m.home.registrationId, awayEntrantId: m.away.registrationId, homeUsername: m.home.username, awayUsername: m.away.username, homeSeed: m.home.seed, awaySeed: m.away.seed } })
        idByIndex.set(m.index, row.id)
      }
      for (const m of plan.matches) {
        await tx.seasonPlayoffMatch.update({ where: { id: idByIndex.get(m.index)! }, data: { feedsMatchId: m.feedsIndex != null ? idByIndex.get(m.feedsIndex) : null, feedsSlot: m.feedsSlot } })
      }
    }
    // Auto-complete generation-time byes so seeded players advance through empty slots.
    await settleByes(tx, seasonId)
    await recordAudit(actor, { action: 'season.playoff.generate', entity: 'Season', entityId: seasonId, newValue: { players: qualifiers.length, doubleElim: s.playoffDoubleElim } }, tx)
  })
  const n = await prisma.seasonPlayoffMatch.count({ where: { seasonId } })
  return { ok: true, matches: n }
}

/** Advance any match that has one real player and one 'Bye' slot (round-1 byes chain through). */
async function settleByes(tx: Prisma.TransactionClient, seasonId: number): Promise<void> {
  // Iterate a few passes so byes chain through multiple rounds.
  for (let pass = 0; pass < 6; pass++) {
    const open = await tx.seasonPlayoffMatch.findMany({ where: { seasonId, winnerEntrantId: null, feedsMatchId: { not: null } } })
    let changed = false
    for (const m of open) {
      const homeBye = m.homeUsername === 'Bye'
      const awayBye = m.awayUsername === 'Bye'
      const homeReal = m.homeEntrantId != null && !homeBye
      const awayReal = m.awayEntrantId != null && !awayBye
      if ((homeReal && awayBye) || (awayReal && homeBye)) {
        const win = homeReal ? { id: m.homeEntrantId!, name: m.homeUsername!, seed: m.homeSeed } : { id: m.awayEntrantId!, name: m.awayUsername!, seed: m.awaySeed }
        await tx.seasonPlayoffMatch.update({ where: { id: m.id }, data: { winnerEntrantId: win.id, verification: 'VERIFIED', status: 'COMPLETED' } })
        if (m.feedsMatchId != null) await placeInto(tx, m.feedsMatchId, m.feedsSlot ?? 0, win)
        changed = true
      }
    }
    if (!changed) break
  }
}

async function placeInto(tx: Prisma.TransactionClient, matchId: number, slot: number, player: { id: number; name: string; seed: number | null }): Promise<void> {
  const data = slot === 0 ? { homeEntrantId: player.id, homeUsername: player.name, homeSeed: player.seed } : { awayEntrantId: player.id, awayUsername: player.name, awaySeed: player.seed }
  await tx.seasonPlayoffMatch.update({ where: { id: matchId }, data })
}

export async function seasonHasDraft(seasonId: number): Promise<boolean> {
  return (await prisma.seasonPlayoffMatch.count({ where: { seasonId } })) > 0
}

/** Publish the draft bracket publicly and lock participants/seeds/type; go live. */
export async function startSeasonPlayoffs(actor: Actor, seasonId: number): Promise<{ ok: boolean; error?: string }> {
  const s = await prisma.season.findUnique({ where: { id: seasonId }, select: { lifecycleState: true } })
  if (s?.lifecycleState !== 'PLAYOFF_SETUP') return { ok: false, error: 'Start playoffs from the playoff setup phase.' }
  const count = await prisma.seasonPlayoffMatch.count({ where: { seasonId } })
  if (count === 0) return { ok: false, error: 'Generate the bracket before starting the playoffs.' }
  await prisma.$transaction(async (tx) => {
    await tx.seasonPlayoffMatch.updateMany({ where: { seasonId }, data: { published: true } })
    await recordAudit(actor, { action: 'season.playoff.start', entity: 'Season', entityId: seasonId }, tx)
    const t = await transitionSeasonState(actor, seasonId, 'PLAYOFFS_LIVE', { tx })
    if (!t.ok) throw new Error(t.error)
  })
  return { ok: true }
}

// ---- Live results + advancement + downstream rebuild ----------------------

export interface DownstreamWarning { affected: { id: number; label: string }[] }

/** Record a playoff result. Equal scores rejected (no playoff draw); 0–0/blank leaves it unplayed.
 *  Advances the winner (and DE loser). Editing a completed match that fed downstream clears + rebuilds
 *  only the affected path (pass `confirmRebuild` after showing the warning). */
export async function recordSeasonPlayoffResult(
  actor: Actor,
  matchId: number,
  homeGames: number,
  awayGames: number,
  opts: { confirmRebuild?: boolean } = {},
): Promise<{ ok: boolean; error?: string; warning?: DownstreamWarning }> {
  const m = await prisma.seasonPlayoffMatch.findUnique({ where: { id: matchId } })
  if (!m) return { ok: false, error: 'Match not found.' }
  const season = await prisma.season.findUnique({ where: { id: m.seasonId }, select: { lifecycleState: true } })
  if (season?.lifecycleState !== 'PLAYOFFS_LIVE') return { ok: false, error: 'Playoffs are not live.' }
  if (m.homeEntrantId == null || m.awayEntrantId == null) return { ok: false, error: 'Both players must be determined first.' }
  const v = validateResult(m.homeEntrantId, m.awayEntrantId, homeGames, awayGames, { allowDraw: false })
  if (!v.ok) return { ok: false, error: v.error } // equal scores are rejected here (no playoff draw)

  // If this match already had a winner that advanced, editing rebuilds the downstream path.
  const wasDecided = m.winnerEntrantId != null
  if (wasDecided && !opts.confirmRebuild) {
    const affected = await downstreamMatches(m.seasonId, m)
    if (affected.length) return { ok: false, warning: { affected: affected.map((x) => ({ id: x.id, label: x.label ?? `Round ${x.round}` })) } }
  }

  const winnerId = v.winnerRegistrationId!
  const winnerHome = winnerId === m.homeEntrantId
  const winnerName = winnerHome ? m.homeUsername! : m.awayUsername!
  const winnerSeed = winnerHome ? m.homeSeed : m.awaySeed
  const loserId = winnerHome ? m.awayEntrantId : m.homeEntrantId
  const loserName = winnerHome ? m.awayUsername! : m.homeUsername!
  const loserSeed = winnerHome ? m.awaySeed : m.homeSeed

  await prisma.$transaction(async (tx) => {
    if (wasDecided) await clearDownstream(tx, m.seasonId, m)
    await tx.seasonPlayoffMatch.update({ where: { id: matchId }, data: { homeGames, awayGames, winnerEntrantId: winnerId, status: 'COMPLETED', verification: 'VERIFIED', completedAt: new Date() } })
    if (m.feedsMatchId != null) await placeInto(tx, m.feedsMatchId, m.feedsSlot ?? 0, { id: winnerId, name: winnerName, seed: winnerSeed })
    if (m.loserFeedsMatchId != null) await placeInto(tx, m.loserFeedsMatchId, m.loserFeedsSlot ?? 0, { id: loserId, name: loserName, seed: loserSeed })
    await settleByes(tx, m.seasonId)
    await recordAudit(actor, { action: wasDecided ? 'season.playoff.correct' : 'season.playoff.result', entity: 'Season', entityId: m.seasonId, newValue: { matchId, home: homeGames, away: awayGames } }, tx)
  })
  return { ok: true }
}

/** Every match reachable downstream of `m` (winner + DE loser paths). */
async function downstreamMatches(seasonId: number, m: { feedsMatchId: number | null; loserFeedsMatchId: number | null }): Promise<{ id: number; label: string | null; round: number }[]> {
  const all = await prisma.seasonPlayoffMatch.findMany({ where: { seasonId }, select: { id: true, label: true, round: true, feedsMatchId: true, loserFeedsMatchId: true } })
  const byId = new Map(all.map((x) => [x.id, x]))
  const out: { id: number; label: string | null; round: number }[] = []
  const seen = new Set<number>()
  const queue = [m.feedsMatchId, m.loserFeedsMatchId].filter((x): x is number => x != null)
  while (queue.length) {
    const id = queue.shift()!
    if (seen.has(id)) continue
    seen.add(id)
    const node = byId.get(id)
    if (!node) continue
    out.push({ id: node.id, label: node.label, round: node.round })
    if (node.feedsMatchId != null) queue.push(node.feedsMatchId)
    if (node.loserFeedsMatchId != null) queue.push(node.loserFeedsMatchId)
  }
  return out
}

/** Clear the result + seated slots of every match downstream of `m` so the path can be rebuilt. */
async function clearDownstream(tx: Prisma.TransactionClient, seasonId: number, m: { feedsMatchId: number | null; loserFeedsMatchId: number | null }): Promise<void> {
  const affected = await downstreamMatches(seasonId, m)
  for (const a of affected) {
    await tx.seasonPlayoffMatch.update({ where: { id: a.id }, data: { winnerEntrantId: null, status: 'SCHEDULED', verification: 'UNVERIFIED', homeGames: null, awayGames: null, completedAt: null, homeEntrantId: null, homeUsername: null, homeSeed: null, awayEntrantId: null, awayUsername: null, awaySeed: null } })
  }
}

// ---- Renderer view --------------------------------------------------------

function columnName(round: number, totalRounds: number): string {
  const fromEnd = totalRounds - round
  if (round >= 201) return 'Grand Final'
  if (round >= 101) return `Losers R${round - 100}`
  if (fromEnd === 0) return 'Final'
  if (fromEnd === 1) return 'Semifinals'
  if (fromEnd === 2) return 'Quarterfinals'
  if (fromEnd === 3) return 'Round of 16'
  return `Round ${round}`
}

/** Build the shared bracket renderer's BracketRound[] from the Season's playoff matches. */
export async function seasonPlayoffRounds(seasonId: number): Promise<BracketRound[]> {
  const rows = await prisma.seasonPlayoffMatch.findMany({ where: { seasonId }, orderBy: [{ round: 'asc' }, { slot: 'asc' }] })
  if (!rows.length) return []
  const entrantIds = [...new Set(rows.flatMap((r) => [r.homeEntrantId, r.awayEntrantId]).filter((x): x is number => x != null))]
  const ents = await prisma.seasonEntrant.findMany({ where: { id: { in: entrantIds } }, select: { id: true, cueverseId: true } })
  const cueverseOf = new Map(ents.map((e) => [e.id, e.cueverseId]))
  const wbRounds = rows.filter((r) => r.round < 100).map((r) => r.round)
  const totalWb = wbRounds.length ? Math.max(...wbRounds) : 0

  const byRound = new Map<number, typeof rows>()
  for (const r of rows) { if (!byRound.has(r.round)) byRound.set(r.round, []); byRound.get(r.round)!.push(r) }
  const out: BracketRound[] = []
  for (const round of [...byRound.keys()].sort((a, b) => a - b)) {
    const matches: ViewMatch[] = byRound.get(round)!.sort((a, b) => a.slot - b.slot).map((r) => {
      const slot = (id: number | null, name: string | null, seed: number | null, games: number | null) => {
        if (id == null && name == null) return undefined
        if (name === 'Bye') return { name: 'Bye' }
        const handle = id != null ? cueverseOf.get(id) ?? undefined : undefined
        return { name: name ?? 'TBD', ...(handle ? { handle, slug: handle } : {}), ...(seed != null ? { seed } : {}), ...(games != null ? { score: games } : {}) }
      }
      const m: ViewMatch = {}
      const a = slot(r.homeEntrantId, r.homeUsername, r.homeSeed, r.homeGames)
      const b = slot(r.awayEntrantId, r.awayUsername, r.awaySeed, r.awayGames)
      if (a) m.a = a
      if (b) m.b = b
      if (r.winnerEntrantId != null) m.winner = r.winnerEntrantId === r.homeEntrantId ? 'a' : 'b'
      return m
    })
    out.push({ name: columnName(round, totalWb), matches })
  }
  return out
}

/** The Season champion (once the final is decided), for close/summary. Returns null until decided. */
export async function seasonChampion(seasonId: number): Promise<{ championId: number; championName: string; runnerUpName: string | null; finalScore: string | null } | null> {
  const rows = await prisma.seasonPlayoffMatch.findMany({ where: { seasonId } })
  if (!rows.length) return null
  const maxRound = Math.max(...rows.map((r) => r.round))
  const final = rows.filter((r) => r.round === maxRound).sort((a, b) => a.slot - b.slot)[0]
  if (!final || final.winnerEntrantId == null) return null
  const champHome = final.winnerEntrantId === final.homeEntrantId
  return {
    championId: final.winnerEntrantId,
    championName: (champHome ? final.homeUsername : final.awayUsername) ?? 'Champion',
    runnerUpName: (champHome ? final.awayUsername : final.homeUsername) ?? null,
    finalScore: final.homeGames != null && final.awayGames != null ? `${Math.max(final.homeGames, final.awayGames)}–${Math.min(final.homeGames, final.awayGames)}` : null,
  }
}
