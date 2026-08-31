'use server'

/**
 * The Owner's entry point to lower-bracket routing.
 *
 * ── Why Owner rather than the Creator capability ────────────────────────────────────────────────
 * Everything else in Creator is gated on `manage_competitions`, which Administrators hold. This one
 * is not: it rewrites the routing of a bracket that is already published and part-played, on a
 * judgement call about how an outside bracket was originally run. There is no rule the application
 * can check to say whether the new routing is the RIGHT one — only that it is legal — so the
 * decision is the Owner's, and the gate says so.
 *
 * The gate is enforced here, in the action, and not merely by hiding the button: a server action is
 * reachable without the page that drew it.
 */

import { revalidatePath } from 'next/cache'

import { resolveStaffAccess } from '@/lib/competition/staff-auth'
import {
  getLowerBracket, resolveStrandedLowerSlots, saveLowerBracketRouting,
  type SaveResult, type SwapPair,
} from '@/lib/competition/lower-bracket-service'
import type { LowerRoundView } from '@/lib/competition/lower-bracket-edit'

const DENIED = 'Only the Owner can edit a published lower bracket.'

async function owner(): Promise<{ ok: true; actor: { userId: number; username: string } } | { ok: false; error: string }> {
  const access = await resolveStaffAccess()
  if (access.status !== 'ok' || !access.actor.isOwner) return { ok: false, error: DENIED }
  return { ok: true, actor: { userId: access.actor.userId, username: access.actor.username } }
}

/** The losers bracket as the editor draws it. Owner-only: it exposes the routing. */
export async function loadLowerBracketAction(tournamentId: number): Promise<LowerRoundView[]> {
  const gate = await owner()
  if (!gate.ok) return []
  return getLowerBracket(tournamentId)
}

/**
 * Save a set of same-round swaps.
 *
 * The whole list is applied or none of it is — see `saveLowerBracketRouting`. A refusal returns the
 * engine's own message, because "Losers R2 M1 has a result and cannot be changed" tells the Owner
 * what to do next and "invalid edit" does not.
 */
export async function saveLowerBracketAction(
  tournamentId: number,
  swaps: SwapPair[],
  reason?: string,
): Promise<SaveResult> {
  const gate = await owner()
  if (!gate.ok) return { ok: false, error: gate.error }

  const result = await saveLowerBracketRouting(gate.actor, tournamentId, swaps, reason)
  if (result.ok) {
    revalidatePath(`/creator/tournaments/${tournamentId}/playoffs`)
    revalidatePath(`/tournaments/${tournamentId}`)
  }
  return result
}

/**
 * Settle losers-bracket seats waiting on a loser that cannot exist.
 *
 * Owner-only for the same reason the routing editor is: it writes completions into a published
 * bracket. It is safe to press twice — the work is idempotent — and it never touches a match that
 * already holds a result.
 */
export async function resolveWalkoversAction(
  tournamentId: number,
): Promise<{ ok: boolean; error?: string; settled?: number; detail?: string[] }> {
  const gate = await owner()
  if (!gate.ok) return { ok: false, error: gate.error }

  const r = await resolveStrandedLowerSlots(gate.actor, tournamentId)
  if (r.ok) {
    revalidatePath(`/creator/tournaments/${tournamentId}/playoffs`)
    revalidatePath(`/tournaments/${tournamentId}`)
  }
  return r
}
