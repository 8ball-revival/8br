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

  const run = async (t: import('@prisma/client').Prisma.TransactionClient) => {
    await t.season.update({ where: { id: seasonId }, data: { lifecycleState: to, ...(to === 'COMPLETED' ? { completedAt: new Date() } : {}) } })
    await recordAudit(
      actor,
      { action: opts.recovery && !canTransition(from, to) ? 'season.state.recovery' : 'season.state', entity: 'Season', entityId: seasonId, oldValue: { state: from }, newValue: { state: to }, reason: opts.reason },
      t,
    )
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
