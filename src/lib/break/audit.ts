import 'server-only'
import type { Prisma } from '@prisma/client'

import { prisma } from '@/lib/prisma'
import { recordAudit } from '@/lib/competition/audit'
import type { BreakActor } from './permissions'

/**
 * The record of who managed a post, and on what grounds.
 *
 * ── Why The Break needs its own entry point ──────────────────────────────────────────────────────
 * `recordAudit` identifies an actor by their Payload user id, because every staff mutation in the
 * competition system starts from a signed-in staff session. The Break identifies people by canonical
 * Player id instead — authorship has to survive an account merge, which a user id does not. This
 * bridges the two, once, so the log stays one log.
 *
 * ── What it deliberately does not store ──────────────────────────────────────────────────────────
 * Field names, never field contents. An audit entry that copied the body of every edited post would
 * become a second, unmanaged store of everything anybody has written — including the passage they
 * edited out because they regretted it. The entry says which fields moved; the post says what they
 * now say; the two together are enough to review a decision.
 */
export interface BreakAuditEntry {
  action:
    | 'break.post.update'
    | 'break.post.delete'
    | 'break.post.discard'
    | 'break.post.restore'
  postId: number
  title: string
  /** Whose post it is. Never changed by a management action — an admin edit is not a byline. */
  authorPlayerId: string | null
  /** Author's own edit, or a use of `manage_the_break` on somebody else's post. */
  basis: 'author' | 'capability'
  changed?: string[]
  commentCount?: number
}

/**
 * The acting account's Payload user id.
 *
 * A Player is the canonical identity and a user is the login attached to it; the audit log wants the
 * login, so a reviewer can tie the action to the session that took it. A Player with no linked user
 * cannot sign in and therefore cannot reach this code, but the lookup is written to tolerate it
 * rather than throw inside somebody's delete.
 */
async function actingUserId(playerId: string): Promise<number | null> {
  const p = await prisma.player.findUnique({ where: { id: playerId }, select: { linkedUserId: true } })
  return p?.linkedUserId != null ? Number(p.linkedUserId) : null
}

export async function recordBreakAudit(
  actor: BreakActor,
  entry: BreakAuditEntry,
  tx?: Prisma.TransactionClient,
): Promise<void> {
  const userId = await actingUserId(actor.playerId)
  await recordAudit(
    { userId: userId ?? 0, username: actor.handle ?? actor.name },
    {
      action: entry.action,
      entity: 'BreakPost',
      entityId: entry.postId,
      /*
       * `oldValue` carries who it belonged to and `newValue` who acted, so the pair reads as
       * "this admin did this to that author's post" without either name being mistaken for a byline.
       */
      oldValue: {
        authorPlayerId: entry.authorPlayerId,
        title: entry.title,
        ...(entry.commentCount != null ? { commentCount: entry.commentCount } : {}),
      },
      newValue: {
        actingPlayerId: actor.playerId,
        actingHandle: actor.handle,
        basis: entry.basis,
        capability: entry.basis === 'capability' ? 'manage_the_break' : null,
        ...(entry.changed ? { changedFields: entry.changed } : {}),
      },
      reason: entry.basis === 'capability'
        ? `staff management of another member's post (manage_the_break)`
        : 'author managing their own post',
    },
    tx,
  )
}
