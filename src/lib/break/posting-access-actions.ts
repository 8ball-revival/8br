'use server'

import { revalidatePath } from 'next/cache'

import { prisma } from '@/lib/prisma'
import { requireCapability } from '@/lib/competition/staff-auth'

/**
 * Removing and restoring somebody's ability to post in The Break.
 *
 * ── A revocation, not a grant ────────────────────────────────────────────────────────────────────
 * Every member in good standing may post. This is the lever for the ones who abuse it, so the
 * default state is "allowed" and nothing has to be done to a new member before they can write. The
 * asymmetry matters: a grant system fails closed and quietly excludes everybody nobody remembered to
 * approve, which is how a community feed ends up with four authors.
 *
 * ── Why it is not a timeout or a ban ─────────────────────────────────────────────────────────────
 * Those already exist, and both remove the whole account. Someone who posts badly but argues well in
 * the comments should lose the first and keep the second, and without a narrower penalty the only
 * available answer to a posting problem was to remove the person. This takes posting and leaves
 * reading, commenting, voting and saving alone.
 *
 * ── Where it lives ───────────────────────────────────────────────────────────────────────────────
 * On the canonical Player, like Trusted Author, so it follows a member through an account merge
 * rather than being stranded on a secondary profile. It is read fresh on every attempt — see
 * `currentEditorialActor` — so a removal takes effect on the member's next action rather than
 * whenever their session expires, and a restoration is equally immediate.
 */

export interface PostingAccessResult {
  ok?: boolean
  error?: string
  blocked?: boolean
}

/** How much of a reason we keep. Long enough to be useful, short enough not to become a case file. */
const MAX_REASON = 500

export async function setBreakPostingBlockedAction(
  targetUserId: number,
  blocked: boolean,
  reason?: string,
): Promise<PostingAccessResult> {
  /*
   * `manage_players`, matching Trusted Author, because this is a decision about a member rather than
   * about a post. It runs here rather than in the component because a server action is a public
   * endpoint and a button that is not drawn stops nobody.
   */
  const actor = await requireCapability('manage_players')

  const player = await prisma.player.findUnique({
    where: { linkedUserId: String(targetUserId) },
    select: { id: true, cueverseId: true, primaryName: true, breakPostingBlocked: true },
  })
  if (!player) return { error: 'That member has no linked profile, so there is nothing to change.' }
  if (player.breakPostingBlocked === blocked) return { ok: true, blocked }

  const trimmed = (reason ?? '').trim().slice(0, MAX_REASON)
  /*
   * A removal needs a reason; a restoration does not.
   *
   * The member is shown this text when they try to post, so "why can I not write any more" has an
   * answer that does not require finding a moderator. Restoring needs no justification — giving
   * somebody their ordinary rights back is not an exceptional act.
   */
  if (blocked && trimmed.length === 0) {
    return { error: 'Give a reason. The member is shown it when they try to post.' }
  }

  await prisma.$transaction(async (db) => {
    await db.player.update({
      where: { id: player.id },
      data: {
        breakPostingBlocked: blocked,
        breakPostingBlockedAt: blocked ? new Date() : null,
        breakPostingBlockedReason: blocked ? trimmed : null,
      },
    })
    /*
     * Recorded in the same place as every other editorial decision, so a member asking why can be
     * answered from the record rather than from memory, and so a restoration is as visible as a
     * removal. Published posts are deliberately untouched: withdrawing the ability to write again is
     * a different decision from retracting what has already been written and discussed.
     */
    await db.editorialModerationRecord.create({
      data: {
        action: blocked ? 'permission.break_posting_removed' : 'permission.break_posting_restored',
        actorPlayerId: null,
        actorName: actor.username,
        detail: {
          targetPlayerId: player.id,
          targetUserId,
          handle: player.cueverseId ?? player.primaryName,
          ...(blocked ? { reason: trimmed } : {}),
        },
      },
    })
  })

  revalidatePath('/staff/members')
  revalidatePath(`/staff/members/${targetUserId}`)
  revalidatePath('/the-break')
  return { ok: true, blocked }
}
