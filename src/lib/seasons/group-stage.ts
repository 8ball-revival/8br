import 'server-only'
import { prisma } from '@/lib/prisma'
import { recordAudit, type Actor } from '@/lib/competition/audit'
import { computeStandings, type StandingMatchInput } from '@/lib/competition/standings'
import { transitionSeasonState } from './lifecycle'

/** Top-N of every group that advance to the playoffs. Seasons always advance the top three. */
export const SEASON_QUALIFIERS_PER_GROUP = 3

// ---- Standings ------------------------------------------------------------

/** Recompute + persist standings for every group from resolved (COMPLETED/FORFEIT) matches only.
 *  Persists `draws` (unlike the Tournament standings). VOID/NO_CONTEST/SCHEDULED are excluded. */
export async function recomputeSeasonStandings(seasonId: number): Promise<void> {
  const groups = await prisma.seasonGroup.findMany({ where: { seasonId }, include: { players: { include: { entrant: { select: { id: true, username: true, displayName: true } } } } } })
  const matches = await prisma.seasonMatch.findMany({ where: { seasonId, status: { in: ['COMPLETED', 'FORFEIT'] } } })
  // The Season says how many times a pair meets; the standings only need it for the completion point.
  const season = await prisma.season.findUnique({ where: { id: seasonId }, select: { groupFormat: true } })
  const meetingsPerPair = season?.groupFormat === 'DOUBLE_ROUND_ROBIN' ? 2 : 1
  for (const g of groups) {
    const roster = g.players.map((p) => ({ registrationId: p.entrantId, username: p.entrant.displayName?.trim() || p.entrant.username }))
    const groupMatches: StandingMatchInput[] = matches
      .filter((m) => m.groupId === g.id)
      .map((m) => ({
        homeRegistrationId: m.homeEntrantId,
        awayRegistrationId: m.awayEntrantId,
        homeUsername: m.homeUsername,
        awayUsername: m.awayUsername,
        // Forfeits award the match but never games (Elo-/win%-neutral) → pass 0–0 with a winner.
        homeGames: m.status === 'FORFEIT' ? 0 : m.homeGames ?? 0,
        awayGames: m.status === 'FORFEIT' ? 0 : m.awayGames ?? 0,
        winnerRegistrationId: m.winnerEntrantId ?? null,
      }))
    const rows = computeStandings(roster, groupMatches, SEASON_QUALIFIERS_PER_GROUP, meetingsPerPair)
    await prisma.$transaction(async (tx) => {
      for (const r of rows) {
        await tx.seasonStanding.upsert({
          where: { groupId_entrantId: { groupId: g.id, entrantId: r.registrationId } },
          create: { seasonId, groupId: g.id, entrantId: r.registrationId, username: r.username, played: r.played, wins: r.wins, losses: r.losses, draws: r.draws, gamesWon: r.gamesWon, gamesLost: r.gamesLost, points: r.points, rank: r.rank, qualified: r.qualified },
          update: { username: r.username, played: r.played, wins: r.wins, losses: r.losses, draws: r.draws, gamesWon: r.gamesWon, gamesLost: r.gamesLost, points: r.points, rank: r.rank, qualified: r.qualified },
        })
      }
    })
  }
}

// ---- Flexible score / FF / KO parsing (pure) ------------------------------

type Field = { kind: 'number'; n: number } | { kind: 'ff' } | { kind: 'ko' } | { kind: 'blank' } | { kind: 'invalid' }
function parseField(raw: string | null | undefined): Field {
  const s = (raw ?? '').trim().toUpperCase()
  if (s === '') return { kind: 'blank' }
  if (s === 'FF') return { kind: 'ff' }
  if (s === 'KO') return { kind: 'ko' }
  if (/^\d+$/.test(s)) return { kind: 'number', n: Number(s) }
  return { kind: 'invalid' }
}

export type MatchInterpretation =
  | { kind: 'unplayed' }
  | { kind: 'result'; homeGames: number; awayGames: number; winner: 'home' | 'away' | 'draw' }
  | { kind: 'ff'; forfeiter: 'home' | 'away' }
  /** Legacy only — `interpretMatch` no longer produces this. Kept so old readers still compile. */
  | { kind: 'ko'; who: 'home' | 'away' }
  | { kind: 'invalid'; reason: string }

/** Interpret one editable matchup's two fields under the flexible Season rules. */
export function interpretMatch(homeRaw: string, awayRaw: string): MatchInterpretation {
  const h = parseField(homeRaw), a = parseField(awayRaw)
  /*
   * KO is no longer entered here.
   *
   * Typing KO into a score cell voided every one of that player's group matches, including results
   * other people had already entered, from a field that looks exactly like a score. A control that
   * destructive does not belong on the same keystroke as "7". Removing an entrant from a competition
   * is an entrant-level decision and is made where entrants are managed.
   *
   * Existing kicked-out players keep their data: their VOID matches and `kickedOut` flag are
   * untouched and still displayed. Only the ENTRY path is closed.
   */
  if (h.kind === 'ko' || a.kind === 'ko') {
    return { kind: 'invalid', reason: 'KO is no longer entered in the score table. Manage the entrant instead.' }
  }
  // FF: exactly one field is FF, the other blank.
  if (h.kind === 'ff' || a.kind === 'ff') {
    if (h.kind === 'ff' && a.kind === 'blank') return { kind: 'ff', forfeiter: 'home' }
    if (a.kind === 'ff' && h.kind === 'blank') return { kind: 'ff', forfeiter: 'away' }
    return { kind: 'invalid', reason: 'FF goes in the forfeiting player’s field only; leave the opponent blank.' }
  }
  if (h.kind === 'blank' && a.kind === 'blank') return { kind: 'unplayed' }
  if (h.kind === 'number' && a.kind === 'number') {
    if (h.n === 0 && a.n === 0) return { kind: 'unplayed' }
    if (h.n === a.n) return { kind: 'result', homeGames: h.n, awayGames: a.n, winner: 'draw' }
    return { kind: 'result', homeGames: h.n, awayGames: a.n, winner: h.n > a.n ? 'home' : 'away' }
  }
  if (h.kind === 'invalid' || a.kind === 'invalid') return { kind: 'invalid', reason: 'Enter whole numbers, or FF / KO.' }
  return { kind: 'invalid', reason: 'Enter both game totals (or leave both blank for unplayed).' }
}

// ---- Batch Save Group -----------------------------------------------------

export interface GroupResultEntry { matchId: number; home: string; away: string; version: number }
export interface SaveGroupResult {
  ok: boolean
  error?: string
  conflict?: boolean
  invalidMatchId?: number
  needConfirmFF?: { matchId: number; forfeiter: string; opponent: string }[]
  needConfirmKO?: { entrantId: number; name: string }[]
}

/**
 * Save all changed results for one group in a SINGLE transaction. Validates every entry first — if any
 * one is invalid, NONE are saved and the offending match is identified. Detects stale edits via a
 * per-match version and requires a refresh on conflict. FF/KO require an explicit confirmation
 * (two-phase): the first call returns what needs confirming, the second (with confirm flags) applies.
 */
export async function saveSeasonGroupResults(
  actor: Actor,
  seasonId: number,
  groupId: number,
  entries: GroupResultEntry[],
  opts: { confirmFF?: boolean; confirmKO?: boolean; koReason?: string } = {},
): Promise<SaveGroupResult> {
  const s = await prisma.season.findUnique({ where: { id: seasonId }, select: { lifecycleState: true } })
  if (!s) return { ok: false, error: 'Season not found.' }
  if (s.lifecycleState !== 'GROUP_STAGE_LIVE') return { ok: false, error: 'Group results can only be saved while the group stage is live.' }

  const ids = entries.map((e) => e.matchId)
  const matches = await prisma.seasonMatch.findMany({ where: { id: { in: ids }, seasonId, groupId } })
  const byId = new Map(matches.map((m) => [m.id, m]))

  // Validate + version-check every entry before touching anything.
  const ffPending: { matchId: number; forfeiter: string; opponent: string }[] = []
  const koVictims = new Map<number, string>() // entrantId → name
  const plan: { match: (typeof matches)[number]; interp: MatchInterpretation }[] = []
  for (const e of entries) {
    const m = byId.get(e.matchId)
    if (!m) return { ok: false, error: 'A match in this group no longer exists — refresh.', conflict: true }
    if (m.version !== e.version) return { ok: false, conflict: true, error: 'Another admin updated this group. Refresh to see the latest results before saving.' }
    const interp = interpretMatch(e.home, e.away)
    if (interp.kind === 'invalid') return { ok: false, invalidMatchId: e.matchId, error: `${m.homeUsername} vs ${m.awayUsername}: ${interp.reason}` }
    if (interp.kind === 'ff') {
      const forfeiter = interp.forfeiter === 'home' ? m.homeUsername : m.awayUsername
      const opponent = interp.forfeiter === 'home' ? m.awayUsername : m.homeUsername
      ffPending.push({ matchId: m.id, forfeiter, opponent })
    }
    if (interp.kind === 'ko') {
      const who = interp.who === 'home' ? m.homeEntrantId : m.awayEntrantId
      koVictims.set(who, interp.who === 'home' ? m.homeUsername : m.awayUsername)
    }
    plan.push({ match: m, interp })
  }

  if (ffPending.length && !opts.confirmFF) return { ok: false, needConfirmFF: ffPending }
  if (koVictims.size && (!opts.confirmKO || !opts.koReason?.trim())) {
    return { ok: false, needConfirmKO: [...koVictims].map(([entrantId, name]) => ({ entrantId, name })) }
  }

  await prisma.$transaction(async (tx) => {
    for (const { match: m, interp } of plan) {
      if (interp.kind === 'ko') continue // handled below (player-level)
      const base = { version: { increment: 1 }, note: null as string | null }
      if (interp.kind === 'unplayed') {
        await tx.seasonMatch.update({ where: { id: m.id }, data: { ...base, status: 'SCHEDULED', homeGames: null, awayGames: null, winnerEntrantId: null, loserEntrantId: null, forfeitEntrantId: null, completedAt: null } })
      } else if (interp.kind === 'result') {
        const winner = interp.winner === 'draw' ? null : interp.winner === 'home' ? m.homeEntrantId : m.awayEntrantId
        const loser = interp.winner === 'draw' ? null : interp.winner === 'home' ? m.awayEntrantId : m.homeEntrantId
        await tx.seasonMatch.update({ where: { id: m.id }, data: { ...base, status: 'COMPLETED', homeGames: interp.homeGames, awayGames: interp.awayGames, winnerEntrantId: winner, loserEntrantId: loser, forfeitEntrantId: null, completedAt: new Date() } })
      } else if (interp.kind === 'ff') {
        const forfeiter = interp.forfeiter === 'home' ? m.homeEntrantId : m.awayEntrantId
        const winner = interp.forfeiter === 'home' ? m.awayEntrantId : m.homeEntrantId
        await tx.seasonMatch.update({ where: { id: m.id }, data: { ...base, status: 'FORFEIT', homeGames: null, awayGames: null, winnerEntrantId: winner, loserEntrantId: forfeiter, forfeitEntrantId: forfeiter, completedAt: new Date() } })
        await recordAudit(actor, { action: 'season.group.ff', entity: 'Season', entityId: seasonId, newValue: { matchId: m.id, forfeiter } }, tx)
      }
    }
    // KO — player-level: void every group match involving each kicked entrant, mark them kicked out.
    for (const [entrantId, name] of koVictims) {
      await tx.seasonMatch.updateMany({ where: { seasonId, OR: [{ homeEntrantId: entrantId }, { awayEntrantId: entrantId }] }, data: { status: 'VOID', winnerEntrantId: null, loserEntrantId: null, forfeitEntrantId: null, homeGames: null, awayGames: null, version: { increment: 1 } } })
      await tx.seasonEntrant.update({ where: { id: entrantId }, data: { kickedOut: true, status: 'KICKED_OUT', qualification: 'KICKED_OUT', playoffIncluded: false, kickedReason: opts.koReason!.trim(), kickedAt: new Date(), kickedByUserId: actor.userId } })
      await recordAudit(actor, { action: 'season.group.ko', entity: 'Season', entityId: seasonId, newValue: { entrantId, name }, reason: opts.koReason!.trim() }, tx)
    }
    await recordAudit(actor, { action: 'season.group.save', entity: 'Season', entityId: seasonId, newValue: { groupId, changed: plan.length } }, tx)
  })
  await recomputeSeasonStandings(seasonId)
  return { ok: true }
}

// ---- Close / Reopen groups ------------------------------------------------

export async function seasonGroupsUnresolved(seasonId: number): Promise<{ count: number; matchups: { home: string; away: string }[] }> {
  const rows = await prisma.seasonMatch.findMany({ where: { seasonId, status: 'SCHEDULED' }, select: { homeUsername: true, awayUsername: true } })
  return { count: rows.length, matchups: rows.map((r) => ({ home: r.homeUsername, away: r.awayUsername })) }
}

/**
 * Close the group stage.
 *
 * Unplayed matches become NO_CONTEST - excluded from points, W/L/D, rating, game differential and
 * streaks. That is the routine case and it proceeds.
 *
 * A MALFORMED match refuses. A half-entered row is somebody's result that did not land, and turning
 * it into "never played" would erase it under the same word that describes a fixture nobody
 * contested. The names come back so the caller can say which ones, and they must be corrected or
 * explicitly cleared first. See `closeGroupsPreflight`.
 */
export async function closeSeasonGroups(actor: Actor, seasonId: number): Promise<{ ok: boolean; error?: string; noContest?: number }> {
  const s = await prisma.season.findUnique({ where: { id: seasonId }, select: { lifecycleState: true } })
  if (!s) return { ok: false, error: 'Season not found.' }
  if (s.lifecycleState !== 'GROUP_STAGE_LIVE') return { ok: false, error: 'The group stage is not live.' }

  const { closeGroupsPreflight } = await import('./group-close')
  const pre = await closeGroupsPreflight(seasonId)
  if (!pre.canClose) {
    const names = pre.malformed.slice(0, 3).map((m) => `${m.home} v ${m.away}`).join(', ')
    const more = pre.malformed.length > 3 ? `, and ${pre.malformed.length - 3} more` : ''
    return {
      ok: false,
      error: `${pre.malformed.length} match${pre.malformed.length === 1 ? ' is' : 'es are'} half-entered `
        + `(${names}${more}). Correct or clear them before closing - they must not become No Contest.`,
    }
  }

  let noContest = 0
  await prisma.$transaction(async (tx) => {
    const unresolved = await tx.seasonMatch.updateMany({ where: { seasonId, status: 'SCHEDULED' }, data: { status: 'NO_CONTEST' } })
    noContest = unresolved.count
    await recordAudit(actor, { action: 'season.groups.close', entity: 'Season', entityId: seasonId, newValue: { noContest: unresolved.count } }, tx)
    const t = await transitionSeasonState(actor, seasonId, 'GROUPS_CLOSED', { tx })
    if (!t.ok) throw new Error(t.error)
  })
  await recomputeSeasonStandings(seasonId)
  return { ok: true, noContest }
}

/**
 * Clear one malformed match back to unplayed, deliberately.
 *
 * The escape hatch that makes the block above fair: a row that cannot be reconstructed has to be
 * removable, but by naming it, one at a time, rather than by a sweep that cannot tell a lost result
 * from an uncontested fixture.
 */
export async function clearSeasonMatch(actor: Actor, seasonId: number, matchId: number): Promise<{ ok: boolean; error?: string }> {
  const s = await prisma.season.findUnique({ where: { id: seasonId }, select: { lifecycleState: true } })
  if (!s) return { ok: false, error: 'Season not found.' }
  if (s.lifecycleState !== 'GROUP_STAGE_LIVE') return { ok: false, error: 'Matches can only be cleared while the group stage is live.' }
  const m = await prisma.seasonMatch.findFirst({ where: { id: matchId, seasonId }, select: { id: true, homeUsername: true, awayUsername: true, status: true } })
  if (!m) return { ok: false, error: 'Match not found.' }
  if (m.status === 'VOID') return { ok: false, error: 'A voided match is legacy kick-out data and is left as it is.' }

  await prisma.$transaction(async (tx) => {
    await tx.seasonMatch.update({
      where: { id: matchId },
      data: {
        status: 'SCHEDULED', homeGames: null, awayGames: null,
        winnerEntrantId: null, loserEntrantId: null, forfeitEntrantId: null,
        completedAt: null, version: { increment: 1 },
      },
    })
    await recordAudit(actor, {
      action: 'season.group.clear', entity: 'Season', entityId: seasonId,
      oldValue: { matchId, matchup: `${m.homeUsername} v ${m.awayUsername}`, status: m.status },
    }, tx)
  })
  await recomputeSeasonStandings(seasonId)
  return { ok: true }
}

/**
 * Reopen the group stage for correction.
 *
 * -- What it does NOT do any more --------------------------------------------------------------
 * It used to delete the private playoff bracket draft and wipe every playoff selection, on the
 * reasoning that changed standings might invalidate them. They MIGHT. A draft somebody arranged by
 * hand is real work, and destroying it to save them a review is the expensive way to be helpful --
 * especially when the reopen is usually to fix one transposed score that changes nothing.
 *
 * So the structure, the scores, the selection and the draft bracket all survive, and
 * `reopenGroupsImpact` names what needs looking at. Discarding the draft is still available, but
 * only when the caller explicitly asks for it.
 */
export async function reopenSeasonGroups(
  actor: Actor,
  seasonId: number,
  opts: { discardDraftBracket?: boolean } = {},
): Promise<{ ok: boolean; error?: string; discardedDraftMatches?: number }> {
  const s = await prisma.season.findUnique({ where: { id: seasonId }, select: { lifecycleState: true } })
  if (!s) return { ok: false, error: 'Season not found.' }
  if (s.lifecycleState !== 'GROUPS_CLOSED') return { ok: false, error: 'Groups can only be reopened while they are closed and before playoffs start.' }

  let discardedDraftMatches = 0
  await prisma.$transaction(async (tx) => {
    // Restore auto-closed matches (NO_CONTEST to SCHEDULED); leave FF/KO/completed results intact.
    await tx.seasonMatch.updateMany({ where: { seasonId, status: 'NO_CONTEST' }, data: { status: 'SCHEDULED' } })

    if (opts.discardDraftBracket) {
      // Asked for, by name. Published playoff matches are public results and are never touched.
      const gone = await tx.seasonPlayoffMatch.deleteMany({ where: { seasonId, published: false } })
      discardedDraftMatches = gone.count
      await tx.seasonEntrant.updateMany({
        where: { seasonId, kickedOut: false },
        data: { playoffIncluded: false, qualification: 'NOT_SELECTED', qualificationReason: null, playoffSeed: null },
      })
    }

    await recordAudit(actor, {
      action: 'season.groups.reopen', entity: 'Season', entityId: seasonId,
      newValue: { discardedDraftBracket: !!opts.discardDraftBracket, discardedDraftMatches },
    }, tx)
    const t = await transitionSeasonState(actor, seasonId, 'GROUP_STAGE_LIVE', { tx })
    if (!t.ok) throw new Error(t.error)
  })
  await recomputeSeasonStandings(seasonId)
  return { ok: true, discardedDraftMatches }
}

