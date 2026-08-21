import 'server-only'
import { prisma } from '@/lib/prisma'
import type { Actor } from './audit'
import {
  generateGroups,
  publishGroups,
  recordScore,
  verifyMatch,
  recomputeStandings,
  generatePlayoff,
  rebuildManualPlayoff,
} from './service'
import { transitionTournamentState } from './tournament-lifecycle'
import { orderQualifiers, type GroupQualifiers } from './bracket'
import { seededShuffle } from './prng'

/** True when a tournament runs a group stage before its playoff bracket. */
export function isGroupStageFormat(tournamentFormat: string | null | undefined): boolean {
  return tournamentFormat === 'GROUPS_PLAYOFFS'
}

/**
 * Start the group stage: generate the configured number of round-robin groups from the
 * approved entrants, publish them (which builds the round-robin schedule + seeds standings),
 * and move the tournament REGISTRATION_CLOSED → GROUPS_IN_PROGRESS. Idempotent-safe (force).
 */
export async function startGroupStage(actor: Actor, tournamentId: number): Promise<{ ok: boolean; error?: string }> {
  const t = await prisma.tournament.findUnique({
    where: { id: tournamentId },
    select: { tournamentFormat: true, groupCount: true },
  })
  if (!t) return { ok: false, error: 'Tournament not found.' }
  if (!isGroupStageFormat(t.tournamentFormat)) return { ok: false, error: 'This is not a Group Stage + Playoffs Tournament.' }

  const numGroups = t.groupCount && t.groupCount > 0 ? t.groupCount : 1
  const approved = await prisma.registration.count({ where: { tournamentId, status: 'APPROVED' } })
  if (approved < numGroups) return { ok: false, error: `Need at least ${numGroups} approved player(s) for ${numGroups} group(s).` }
  if (approved < 2) return { ok: false, error: 'Need at least 2 approved players.' }

  const gen = await generateGroups(actor, tournamentId, numGroups, undefined, { force: true })
  if (!gen.ok) return gen
  const pub = await publishGroups(actor, tournamentId)
  if (!pub.ok) return pub
  await recomputeStandings(tournamentId)

  const tr = await transitionTournamentState(actor, tournamentId, 'GROUPS_IN_PROGRESS')
  if (!tr.ok) return { ok: false, error: tr.error }
  return { ok: true }
}

/**
 * Record + verify a group match result. Admin/mod entry is authoritative, so the result is
 * recorded and immediately verified (standings recompute automatically). Also used to CORRECT
 * an existing result (re-recording overwrites it, then re-verifies + recomputes).
 */
export async function recordGroupResult(
  actor: Actor,
  matchId: number,
  homeGames: number,
  awayGames: number,
  reason?: string,
): Promise<{ ok: boolean; error?: string }> {
  const rec = await recordScore(actor, matchId, homeGames, awayGames, reason)
  if (!rec.ok) return rec
  return verifyMatch(actor, matchId, true, reason)
}

/** Every group match must have a verified, decided result before qualifiers can be confirmed. */
export async function groupStageComplete(tournamentId: number): Promise<{ complete: boolean; total: number; remaining: number }> {
  const total = await prisma.tournamentMatch.count({ where: { tournamentId } })
  // A match is settled once it is VERIFIED and in a completed status — including a 5–5 draw, which is
  // COMPLETED with a null winner. Only unplayed/disputed/unverified matches remain.
  const remaining = await prisma.tournamentMatch.count({
    where: {
      tournamentId,
      OR: [{ verification: { not: 'VERIFIED' } }, { status: { notIn: ['COMPLETED', 'FORFEIT', 'NO_SHOW'] } }],
    },
  })
  return { complete: total > 0 && remaining === 0, total, remaining }
}

/** Qualified registration ids across all groups, in overall seed order (winners, then runners-up, …). */
async function qualifierSeedOrder(tournamentId: number): Promise<number[]> {
  const groups = await prisma.tournamentGroup.findMany({
    where: { tournamentId },
    orderBy: { ordinal: 'asc' },
    include: { standings: { where: { qualified: true }, orderBy: { rank: 'asc' } } },
  })
  const gq: GroupQualifiers[] = groups.map((g) => ({
    groupOrdinal: g.ordinal,
    players: g.standings.map((s) => ({ registrationId: s.registrationId, username: s.username })),
  }))
  return orderQualifiers(gq).map((q) => q.registrationId)
}

/**
 * Confirm the final qualifiers and seed them into the playoff bracket per the tournament's
 * configured seeding rule, then move GROUPS_IN_PROGRESS → BRACKET_GENERATED. Refuses until every
 * group match has a verified result.
 *   - "standing" → cross-group seeding (group winners top, kept apart in the bracket)
 *   - "random"   → deterministic random draw of the qualifiers
 *   - "manual"   → qualifiers in standing order, editable afterward in the Bracket tab
 * Double-elimination playoffs are honored when `playoffDoubleElim` is set.
 */
export async function confirmQualifiersAndSeed(actor: Actor, tournamentId: number): Promise<{ ok: boolean; error?: string }> {
  const t = await prisma.tournament.findUnique({
    where: { id: tournamentId },
    select: { tournamentFormat: true, playoffSeeding: true, playoffDoubleElim: true },
  })
  if (!t) return { ok: false, error: 'Tournament not found.' }
  if (!isGroupStageFormat(t.tournamentFormat)) return { ok: false, error: 'This is not a Group Stage + Playoffs Tournament.' }

  const status = await groupStageComplete(tournamentId)
  if (!status.complete)
    return { ok: false, error: `${status.remaining} group match${status.remaining === 1 ? '' : 'es'} still need a verified result before advancing to the playoffs.` }

  await recomputeStandings(tournamentId)

  const seeding = t.playoffSeeding ?? 'standing'
  const doubleElim = Boolean(t.playoffDoubleElim)

  let seed: { ok: boolean; error?: string }
  if (seeding === 'standing') {
    // Cross-group standing seed straight into the bracket.
    seed = await generatePlayoff(actor, tournamentId, { force: true, doubleElim })
  } else {
    const ordered = await qualifierSeedOrder(tournamentId)
    if (ordered.length < 2) return { ok: false, error: 'Need at least 2 qualified players. Finish the group stage first.' }
    const ids = seeding === 'random' ? seededShuffle(ordered, `playoff-seed:${tournamentId}`) : ordered
    seed = await rebuildManualPlayoff(actor, tournamentId, ids, { doubleElim })
  }
  if (!seed.ok) return seed

  // Confirming qualifiers seeds a DRAFT playoff bracket (unpublished) and moves to BRACKET_GENERATED — a
  // review step. The Admin then adjusts who's in / the seeding on the Bracket tab, publishes it, and
  // starts play. It does NOT auto-publish or go live here, so seeding can still be changed.
  const tr = await transitionTournamentState(actor, tournamentId, 'BRACKET_GENERATED')
  if (!tr.ok) return { ok: false, error: tr.error }
  return { ok: true }
}
