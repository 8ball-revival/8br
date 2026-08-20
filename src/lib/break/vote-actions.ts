'use server'

import { revalidatePath } from 'next/cache'

import { currentBreakActor } from './permissions'
import { voteOnPost, voteOnComment, parseVoteValue, type VoteResult } from './voting'
import { consume, limitMessage } from './rate-limit'

/**
 * The one endpoint that records a vote.
 *
 * It accepts a DIRECTION and never a total — see `voting.ts`. Everything a caller could lie about is
 * re-derived here: who they are comes from the session, not the payload, and the value is parsed
 * rather than trusted.
 */
export async function castVoteAction(input: {
  target: 'post' | 'comment'
  id: number
  value: unknown
}): Promise<VoteResult> {
  const actor = await currentBreakActor()
  // Signing out mid-session, or a suspended account, lands here rather than at the database.
  if (!actor) return { ok: false, error: 'Sign in to vote.' }

  const value = parseVoteValue(input.value)
  if (value === null) return { ok: false, error: 'That is not a vote.' }

  const id = Number(input.id)
  if (!Number.isInteger(id) || id <= 0) return { ok: false, error: 'That is not a valid target.' }

  const limit = await consume('vote', { playerId: actor.playerId })
  if (!limit.allowed) return { ok: false, error: limitMessage('vote', limit) }

  const result = input.target === 'post'
    ? await voteOnPost(id, actor.playerId, value)
    : await voteOnComment(id, actor.playerId, value)

  /*
   * The feed's cached ordering has moved, so the cached page has to go.
   *
   * Only the paths, and only on success — revalidating after a refusal would throw away a correct
   * cache entry for nothing.
   */
  if (result.ok) {
    revalidatePath('/the-break')
    revalidatePath('/')
  }

  return result
}
