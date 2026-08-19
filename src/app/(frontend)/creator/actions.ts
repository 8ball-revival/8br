'use server'

import { creatorActor } from '@/lib/creator/access'
import {
  reopenForCorrection, recomplete, type CorrectionKind,
} from '@/lib/competition/correction'

export interface CorrectionActionResult { ok: boolean; error?: string; message?: string }

const KINDS: CorrectionKind[] = ['season', 'tournament']

/**
 * Validate the arguments a client sent.
 *
 * Never trust a client-supplied kind or id: both address a canonical record, and a mistyped kind
 * would send a Season id into the Tournament path. The id must be a positive whole number and the
 * kind must be one of exactly two strings.
 */
function parse(kind: string, id: number): { ok: true; kind: CorrectionKind; id: number } | { ok: false; error: string } {
  if (!KINDS.includes(kind as CorrectionKind)) return { ok: false, error: 'Unknown record type.' }
  if (!Number.isInteger(id) || id <= 0) return { ok: false, error: 'Invalid record id.' }
  return { ok: true, kind: kind as CorrectionKind, id }
}

/**
 * Reopen a completed record for corrections.
 *
 * Authorisation is checked HERE, not in the page that rendered the button. A server action is a
 * public endpoint: it can be called directly, with any arguments, by anyone who has seen the page
 * once — so the navigation hiding Creator and the page's own gate protect nothing on their own.
 */
export async function reopenForCorrectionAction(
  kind: string, id: number, reason?: string,
): Promise<CorrectionActionResult> {
  const access = await creatorActor()
  if (!access.ok) return { ok: false, error: access.error }
  const args = parse(kind, id)
  if (!args.ok) return { ok: false, error: args.error }

  const trimmed = reason?.trim().slice(0, 500) || undefined
  const r = await reopenForCorrection(access.actor, args.kind, args.id, trimmed)
  if (!r.ok) return { ok: false, error: r.error }
  return {
    ok: true,
    message: r.alreadyDone
      ? 'This record was already open for corrections.'
      : 'Reopened for corrections. It has left the Archives and is no longer counting towards the Rankings.',
  }
}

/** Complete a corrected record and put it back into the record. Same authorisation rules. */
export async function recompleteAction(
  kind: string, id: number, reason?: string,
): Promise<CorrectionActionResult> {
  const access = await creatorActor()
  if (!access.ok) return { ok: false, error: access.error }
  const args = parse(kind, id)
  if (!args.ok) return { ok: false, error: args.error }

  const trimmed = reason?.trim().slice(0, 500) || undefined
  const r = await recomplete(access.actor, args.kind, args.id, trimmed)
  if (!r.ok) return { ok: false, error: r.error }
  return {
    ok: true,
    message: r.alreadyDone
      ? 'This record was already completed.'
      : 'Completed and republished. It is back in the Archives and counting towards the Rankings.',
  }
}
