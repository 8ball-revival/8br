import 'server-only'
import { prisma } from '@/lib/prisma'
import { recordAudit, type Actor } from '@/lib/competition/audit'
import { canTransition, SEASON_STATE_LABEL, type SeasonState } from './shared'

/**
 * SEASON LIFECYCLE (server) — the DB-bound, server-enforced transitions for a Season, built on the
 * client-safe machine in ./shared. Every transition is audited. There is intentionally NO CANCELLED
 * state — Seasons are never cancelled, only completed or deleted.
 */

// Re-export the client-safe machine so server callers can import everything from one place.
export { canTransition, isPreGroupPhase, SEASON_STATE_LABEL, type SeasonState } from './shared'

export interface SeasonTransitionResult {
  ok: boolean
  error?: string
  from?: SeasonState
  to?: SeasonState
}

/**
 * Transition a Season to a new state. `recovery` (Head-Admin-gated by the caller) permits an
 * otherwise-invalid move (e.g. rolling live playoffs back to Groups Closed) and is audited distinctly.
 * The optional `tx` lets a transition participate in a larger atomic operation (publish, close, etc.).
 */
export async function transitionSeasonState(
  actor: Actor,
  seasonId: number,
  to: SeasonState,
  opts: { reason?: string; recovery?: boolean; tx?: import('@prisma/client').Prisma.TransactionClient } = {},
): Promise<SeasonTransitionResult> {
  const db = opts.tx ?? prisma
  const season = await db.season.findUnique({ where: { id: seasonId }, select: { lifecycleState: true } })
  if (!season) return { ok: false, error: 'Season not found.' }
  const from = season.lifecycleState
  if (from === to) return { ok: true, from, to }
  if (!canTransition(from, to) && !opts.recovery) {
    return { ok: false, error: `Invalid transition: ${SEASON_STATE_LABEL[from]} → ${SEASON_STATE_LABEL[to]}.` }
  }

  // Only a CLOSED Season feeds Rankings, Records, ratings and championship totals. Reopening one
  // must therefore withdraw its contribution immediately rather than leaving stale numbers standing
  // until it happens to be closed again. `ladderAppliedAt` is cleared for the same reason: it
  // records that the ladder currently includes this Season, and after a reopen it no longer does.
  const reopened = from === 'COMPLETED' && to !== 'COMPLETED'

  const run = async (t: import('@prisma/client').Prisma.TransactionClient) => {
    await t.season.update({
      where: { id: seasonId },
      data: {
        lifecycleState: to,
        ...(to === 'COMPLETED' ? { completedAt: new Date() } : {}),
        ...(reopened ? { ladderAppliedAt: null } : {}),
      },
    })
    await recordAudit(
      actor,
      { action: opts.recovery && !canTransition(from, to) ? 'season.state.recovery' : 'season.state', entity: 'Season', entityId: seasonId, oldValue: { state: from }, newValue: { state: to }, reason: opts.reason },
      t,
    )
    if (reopened) {
      // A full deterministic replay across every still-completed competition — the same pipeline
      // close and delete use, so reopening can never leave the ladder in a bespoke state.
      const { rebuildRatingLedger } = await import('@/lib/stats/ledger')
      await rebuildRatingLedger(t)
    }
  }
  if (opts.tx) await run(opts.tx)
  else await prisma.$transaction(run)
  return { ok: true, from, to }
}

/** Server-side gate: assert the Season is in one of the expected states. */
export async function requireSeasonState(seasonId: number, allowed: SeasonState[]): Promise<{ ok: true; state: SeasonState } | { ok: false; error: string }> {
  const s = await prisma.season.findUnique({ where: { id: seasonId }, select: { lifecycleState: true } })
  if (!s) return { ok: false, error: 'Season not found.' }
  if (!allowed.includes(s.lifecycleState)) {
    return { ok: false, error: `This action is not available while the Season is ${SEASON_STATE_LABEL[s.lifecycleState]}.` }
  }
  return { ok: true, state: s.lifecycleState }
}

/**
 * Keep a Season's Rankings/Records contribution in step with its data.
 *
 * Only a CLOSED Season contributes, so this is a no-op for one that is still being played. For a
 * closed Season it replays the whole ledger, which is how an edit to a finished Season is reflected
 * in ratings, career totals and championship counts without any bespoke incremental arithmetic.
 *
 * Safe to call after any write that could change a Season's results. Cheap when it does nothing.
 */
export async function syncSeasonRankingContribution(
  seasonId: number,
  tx?: import('@prisma/client').Prisma.TransactionClient,
): Promise<{ rebuilt: boolean }> {
  const db = tx ?? prisma
  const s = await db.season.findUnique({ where: { id: seasonId }, select: { lifecycleState: true } })
  if (s?.lifecycleState !== 'COMPLETED') return { rebuilt: false }
  const { rebuildRatingLedger } = await import('@/lib/stats/ledger')
  if (tx) await rebuildRatingLedger(tx)
  else await prisma.$transaction(async (t) => { await rebuildRatingLedger(t) })
  return { rebuilt: true }
}
