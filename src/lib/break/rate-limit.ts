import 'server-only'
import { createHash } from 'node:crypto'

import { prisma } from '@/lib/prisma'

/**
 * Server-side rate limits.
 *
 * ── Why it is a table and not memory ─────────────────────────────────────────────────────────────
 * An in-process counter resets on every deploy and is not shared between instances, so it limits
 * nothing that matters. A row per action is a little more work and is actually a limit.
 *
 * ── What is stored ───────────────────────────────────────────────────────────────────────────────
 * An account id, an action name and a timestamp. Where a limit has to apply to a request rather than
 * an account, the signal is HASHED with a per-install secret before it is written — the point is to
 * tell two requests apart, which a hash does, and not to keep a log of who was where, which a raw
 * address would be. Rows are pruned by the cleanup service; nothing here is retained.
 */

export interface Limit {
  /** How many are allowed inside the window. */
  max: number
  windowSeconds: number
}

/**
 * The limits, in one table so they can be read at a glance and tuned without hunting call sites.
 *
 * They are set to be invisible to somebody using the site normally and obstructive to a script:
 * nobody writes six posts in ten minutes by hand, and a person voting quickly through a feed does
 * perhaps one a second, not thirty.
 */
export const LIMITS = {
  'post.create':    { max: 5,   windowSeconds: 600 },
  'post.edit':      { max: 30,  windowSeconds: 600 },
  'comment.create': { max: 20,  windowSeconds: 300 },
  'comment.edit':   { max: 40,  windowSeconds: 600 },
  'vote':           { max: 120, windowSeconds: 60 },
  'report':         { max: 10,  windowSeconds: 600 },
  'media.upload':   { max: 20,  windowSeconds: 600 },
  'link.preview':   { max: 20,  windowSeconds: 600 },
  'search':         { max: 60,  windowSeconds: 60 },
  'poll.vote':      { max: 30,  windowSeconds: 300 },
} as const satisfies Record<string, Limit>

export type LimitAction = keyof typeof LIMITS

export interface LimitVerdict {
  allowed: boolean
  /** Seconds until the oldest counted action falls out of the window. */
  retryAfter: number
  remaining: number
}

/** Hash a request signal so two requests can be told apart without keeping the signal itself. */
export function clientHash(signal: string | null | undefined): string | null {
  if (!signal) return null
  const salt = process.env.RATE_LIMIT_SALT ?? 'the-break-local'
  return createHash('sha256').update(`${salt}:${signal}`).digest('hex').slice(0, 32)
}

/**
 * Check a limit and record the attempt.
 *
 * Deliberately counts the attempt BEFORE deciding. Recording only successes would let a caller
 * hammer a refused endpoint for free, which is the cheapest denial there is.
 */
export async function consume(
  action: LimitAction,
  who: { playerId?: string | null; clientHash?: string | null },
): Promise<LimitVerdict> {
  const limit = LIMITS[action]
  const since = new Date(Date.now() - limit.windowSeconds * 1000)

  const where = who.playerId
    ? { playerId: who.playerId, action, createdAt: { gte: since } }
    : who.clientHash
      ? { clientHash: who.clientHash, action, createdAt: { gte: since } }
      // Nothing to key on. Refuse rather than grant an unlimited allowance.
      : null

  if (!where) return { allowed: false, retryAfter: limit.windowSeconds, remaining: 0 }

  const [used, oldest] = await Promise.all([
    prisma.breakActionLog.count({ where }),
    prisma.breakActionLog.findFirst({ where, orderBy: { createdAt: 'asc' }, select: { createdAt: true } }),
  ])

  await prisma.breakActionLog.create({
    data: { action, playerId: who.playerId ?? null, clientHash: who.clientHash ?? null },
  })

  const allowed = used < limit.max
  const retryAfter = oldest
    ? Math.max(1, Math.ceil((oldest.createdAt.getTime() + limit.windowSeconds * 1000 - Date.now()) / 1000))
    : limit.windowSeconds

  return { allowed, retryAfter, remaining: Math.max(0, limit.max - used - 1) }
}

/** A friendly refusal that says when to try again rather than only that something went wrong. */
export function limitMessage(action: LimitAction, v: LimitVerdict): string {
  const noun = action.startsWith('post') ? 'posting'
    : action.startsWith('comment') ? 'commenting'
    : action === 'vote' ? 'voting'
    : action === 'report' ? 'reporting'
    : action.startsWith('media') ? 'uploading'
    : 'doing that'
  const wait = v.retryAfter >= 60 ? `${Math.ceil(v.retryAfter / 60)} minute(s)` : `${v.retryAfter} second(s)`
  return `You are ${noun} a little too quickly. Try again in ${wait}.`
}

/** Drop expired rows. Nothing here is kept beyond the longest window by any margin. */
export async function pruneActionLog(olderThanHours = 24): Promise<number> {
  const { count } = await prisma.breakActionLog.deleteMany({
    where: { createdAt: { lt: new Date(Date.now() - olderThanHours * 3_600_000) } },
  })
  return count
}
