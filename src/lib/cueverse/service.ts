import 'server-only'
import { unstable_cache } from 'next/cache'
import { prisma } from '@/lib/prisma'
import type { Prisma } from '@prisma/client'
import {
  fetchLeaderboard, checksumOf, ProviderError, TOP_N,
  type LeaderboardEntry, type LeaderboardPayload,
} from './provider'

/**
 * Storing and reading the CueVerse leaderboard mirror.
 *
 * The rule that shapes this file: a refresh may only ever ADD a good snapshot. It can never damage
 * the one already there. So a failed fetch, a timeout, an empty list or a payload we do not
 * recognise all end the same way — nothing is written, the previous snapshot keeps serving, and the
 * homepage does not notice.
 *
 * The homepage reads `getLatestSnapshot()`, which touches only our own database. No page render
 * ever calls CueVerse.
 */

export const CUEVERSE_TAG = 'cueverse-leaderboard'

/** Past this age the card says so, rather than quietly presenting stale figures as current. */
export const STALE_AFTER_HOURS = 36

export interface CueVerseSnapshotView {
  /**
   * ISO strings, not Date objects.
   *
   * This view crosses `unstable_cache`, which serialises through JSON — a Date goes in and a string
   * comes back. Typing these as Date would have been a lie the compiler could not catch, because the
   * cache wrapper reports the function's declared return type rather than what survives the round
   * trip. It did exactly that, and the card crashed on `.toISOString()` of a string.
   */
  fetchedAt: string
  sourceUpdatedAt: string | null
  playersOnline: number | null
  tablesActive: number | null
  entries: LeaderboardEntry[]
  /** True once the snapshot is old enough that presenting it as current would be misleading. */
  stale: boolean
  ageHours: number
}

// --------------------------------------------------------------------------- reading

/** Uncached read. Exported so scripts and tests can call it outside a request context. */
export async function readLatestSnapshot(now = new Date()): Promise<CueVerseSnapshotView | null> {
  const snapshot = await prisma.cueVerseSnapshot.findFirst({
    orderBy: { fetchedAt: 'desc' },
    include: { entries: { orderBy: { rank: 'asc' } } },
  })
  if (!snapshot || snapshot.entries.length === 0) return null

  const ageHours = (now.getTime() - snapshot.fetchedAt.getTime()) / 3_600_000
  return {
    fetchedAt: snapshot.fetchedAt.toISOString(),
    sourceUpdatedAt: snapshot.sourceUpdatedAt ? snapshot.sourceUpdatedAt.toISOString() : null,
    playersOnline: snapshot.playersOnline,
    tablesActive: snapshot.tablesActive,
    stale: ageHours > STALE_AFTER_HOURS,
    ageHours,
    entries: snapshot.entries.map((e) => ({
      rank: e.rank,
      name: e.name,
      rating: e.rating,
      wins: e.wins,
      losses: e.losses,
      provisional: e.provisional,
    })),
  }
}

/**
 * The snapshot the homepage renders.
 *
 * Cached under a tag: the data changes once a day, so re-querying it on every homepage hit would be
 * waste. `refreshCueVerseLeaderboard` revalidates the tag, which is what makes a manual refresh show
 * up immediately.
 */
export const getLatestSnapshot = unstable_cache(
  async () => readLatestSnapshot(),
  ['cueverse-latest-snapshot'],
  { tags: [CUEVERSE_TAG], revalidate: 900 },
)

// --------------------------------------------------------------------------- writing

export interface RefreshResult {
  ok: boolean
  /** Why nothing was written. Safe to show an administrator; never contains a secret. */
  error?: string
  /** True when the fetch succeeded but matched the snapshot we already had. */
  unchanged?: boolean
  snapshotId?: number
  entries?: number
}

/**
 * A Postgres advisory lock, so two refreshes cannot run at once.
 *
 * Chosen over a database flag because it is released automatically when the connection goes away.
 * A crashed job holding a boolean column would block every future refresh until somebody noticed;
 * a crashed job holding an advisory lock blocks nothing.
 */
const LOCK_KEY = 8_811_005

async function withLock<T>(fn: () => Promise<T>): Promise<T | { locked: true }> {
  const [{ locked }] = await prisma.$queryRaw<{ locked: boolean }[]>`
    SELECT pg_try_advisory_lock(${LOCK_KEY}::bigint) AS locked`
  if (!locked) return { locked: true }
  try {
    return await fn()
  } finally {
    await prisma.$queryRaw`SELECT pg_advisory_unlock(${LOCK_KEY}::bigint)`
  }
}

/** How many snapshots to keep. Enough to roll back or spot a pattern; not a growing archive. */
const KEEP_SNAPSHOTS = 30

/**
 * Fetch and store, if and only if the result is good.
 *
 * `fetcher` is injectable so tests can drive the failure paths — a timeout, a malformed body, an
 * empty list — without touching the network.
 */
export async function refreshCueVerseLeaderboard(
  { fetcher = fetchLeaderboard, now = new Date() }: {
    fetcher?: () => Promise<LeaderboardPayload>
    now?: Date
  } = {},
): Promise<RefreshResult> {
  const outcome = await withLock(async (): Promise<RefreshResult> => {
    let payload: LeaderboardPayload
    try {
      payload = await fetcher()
    } catch (err) {
      // Expected: the source was down, slow, or said something we did not understand. The previous
      // snapshot stands. The message is the provider's own summary, which never carries a secret.
      const message = err instanceof ProviderError ? err.message : 'The CueVerse leaderboard could not be read.'
      console.warn('[cueverse] refresh failed:', message)
      return { ok: false, error: message }
    }

    // Belt and braces: the provider validates, and so does this. A write path that trusts its input
    // because "the parser already checked" is how an empty leaderboard eventually lands in storage.
    if (!Array.isArray(payload.entries) || payload.entries.length !== TOP_N) {
      return { ok: false, error: `Refused a leaderboard with ${payload.entries?.length ?? 0} rows.` }
    }

    const checksum = checksumOf(payload.entries)
    const latest = await prisma.cueVerseSnapshot.findFirst({
      orderBy: { fetchedAt: 'desc' },
      select: { id: true, checksum: true },
    })
    if (latest?.checksum && latest.checksum === checksum) {
      // Identical to what we hold. Recording the fetch time is still worth doing — it is the
      // difference between "unchanged since yesterday" and "we have not looked since yesterday".
      await prisma.cueVerseSnapshot.update({ where: { id: latest.id }, data: { fetchedAt: now } })
      return { ok: true, unchanged: true, snapshotId: latest.id, entries: payload.entries.length }
    }

    const created = await prisma.$transaction(async (db) => {
      const snapshot = await db.cueVerseSnapshot.create({
        data: {
          provider: 'cueverse',
          fetchedAt: now,
          checksum,
          raw: (payload.raw ?? null) as Prisma.InputJsonValue,
          playersOnline: payload.playersOnline,
          tablesActive: payload.tablesActive,
          entries: { create: payload.entries.map((e) => ({
            rank: e.rank, name: e.name, rating: e.rating,
            wins: e.wins, losses: e.losses, provisional: e.provisional,
          })) },
        },
        select: { id: true },
      })

      // Trim the tail. Done inside the transaction so the keep-window is never briefly violated.
      const old = await db.cueVerseSnapshot.findMany({
        orderBy: { fetchedAt: 'desc' },
        skip: KEEP_SNAPSHOTS,
        select: { id: true },
      })
      if (old.length) await db.cueVerseSnapshot.deleteMany({ where: { id: { in: old.map((o) => o.id) } } })

      return snapshot
    })

    return { ok: true, snapshotId: created.id, entries: payload.entries.length }
  })

  if ('locked' in outcome) {
    return { ok: false, error: 'A refresh is already running.' }
  }
  return outcome
}
