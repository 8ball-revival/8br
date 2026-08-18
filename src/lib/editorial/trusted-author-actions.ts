'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { requireCapability } from '@/lib/competition/staff-auth'

/**
 * Grant and revoke Trusted Author.
 *
 * The permission lives on the canonical Player rather than on the account, so it follows a member
 * through an account merge and is read from exactly one place by the editorial permission check.
 *
 * Revoking takes effect on the very next publish attempt — `canPublishNow` re-reads this column
 * instead of trusting a resolved session — but it deliberately leaves already-published articles
 * alone. Withdrawing somebody's ability to publish in future is a different decision from retracting
 * what they have already written, and conflating the two would silently un-publish a back catalogue
 * that had been through review.
 */

export interface TrustedAuthorResult {
  ok?: boolean
  error?: string
  trusted?: boolean
}

export async function setTrustedAuthorAction(
  targetUserId: number,
  trusted: boolean,
): Promise<TrustedAuthorResult> {
  // Managing member permissions is an administrator capability; the check throws for anybody else,
  // and it runs here rather than in the UI because a server action is a public endpoint.
  const actor = await requireCapability('manage_players')

  const player = await prisma.player.findUnique({
    where: { linkedUserId: String(targetUserId) },
    select: { id: true, cueverseId: true, primaryName: true, blogTrustedAuthor: true, active: true },
  })
  if (!player) return { error: 'That member has no linked profile, so there is nothing to grant.' }
  if (!player.active && trusted) return { error: 'Reactivate the profile before granting Trusted Author.' }
  if (player.blogTrustedAuthor === trusted) return { ok: true, trusted }

  await prisma.$transaction(async (db) => {
    await db.player.update({ where: { id: player.id }, data: { blogTrustedAuthor: trusted } })
    // Recorded so the change can be explained and reversed later, like any other editorial decision.
    await db.editorialModerationRecord.create({
      data: {
        action: trusted ? 'permission.trusted_author_granted' : 'permission.trusted_author_revoked',
        actorPlayerId: null,
        actorName: actor.username,
        detail: { targetPlayerId: player.id, targetUserId, handle: player.cueverseId ?? player.primaryName },
      },
    })
  })

  revalidatePath('/staff/members')
  revalidatePath(`/staff/members/${targetUserId}`)
  revalidatePath('/news')
  return { ok: true, trusted }
}
