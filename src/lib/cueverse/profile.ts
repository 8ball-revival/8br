import 'server-only'
import { unstable_cache } from 'next/cache'
import { CUEVERSE_GAME, formatStreak, opponentParts, cueverseReplayUrl, resultLabel, type OpponentPart } from './links'

/**
 * CueVerse, behind one adapter.
 *
 * ── Where this comes from ───────────────────────────────────────────────────────────────────────
 * CueVerse's public profile page is a client-rendered shell: its HTML contains no player data at
 * all, so reading it would mean running their JavaScript. It does not come to that. The page's own
 * Content-Security-Policy names the origin it talks to —
 *
 *     connect-src 'self' https://api.cueverse.gg
 *
 * — and its bundle fetches exactly one endpoint:
 *
 *     GET https://api.cueverse.gg/api/profile?name=<id>&game=pool&limit=<n>
 *
 * That is the structured endpoint CueVerse itself uses, it answers with JSON and CORS open to all,
 * and it returns 404 for an unknown player. So this is a documented read of a public API, not a
 * scrape: no HTML is parsed, no markup is depended upon, and a redesign of their page cannot break
 * it.
 *
 * ── The boundary this file exists to hold ───────────────────────────────────────────────────────
 * Nothing here reaches an 8 Ball Registry table, in either direction. CueVerse games are not
 * imported, its rating is never added to a Registry rating, and its record is never merged into a
 * Registry record. The two careers are shown side by side and stay separate — a combined figure
 * would belong to neither system and could not be checked against either.
 *
 * ── Values are passed through, never recomputed ─────────────────────────────────────────────────
 * Wins, losses, rating and the rating after each game are CueVerse's arithmetic. This normalises
 * types and shapes and stops. Recalculating any of it here would produce a second opinion about
 * somebody else's ladder, and the two would drift.
 */

/** How long a fetched profile is reused. Long enough to survive a page's own re-renders and a
 *  visitor clicking between tabs; short enough that a game played now shows up in a minute. */
const CACHE_SECONDS = 60

/**
 * How long a FAILURE is reused, and why it is not the same number.
 *
 * A failure and an answer do not deserve the same shelf life. The cache above is Vercel's Data
 * Cache: shared by every visitor and every instance, so one unlucky read becomes the answer the
 * whole site gives. Holding that for a minute is how a single cold-start hiccup turned into
 * "CueVerse is unavailable" on a live profile long after CueVerse was answering in half a second.
 *
 * Still worth holding briefly. If CueVerse really is down, going back on every render turns their
 * outage into a stampede from us. Ten seconds is enough to absorb a burst of traffic on one profile
 * and short enough that a blip heals before anyone thinks to reload.
 */
const NEGATIVE_CACHE_MS = 10_000

/**
 * CueVerse is a third party on somebody else's schedule. A slow reply must not hold our page.
 *
 * Ten seconds, not the six it was: the only read that has ever missed this deadline was a first
 * connection from a cold instance, paying DNS and a TLS handshake before CueVerse had done any
 * work. The card sits inside its own Suspense boundary, so a slow read delays that panel alone and
 * never the page around it — the deadline exists to bound a hang, not to keep the page quick.
 */
const TIMEOUT_MS = 10_000

/** The brief: always the latest 100, no picker. */
export const GAME_LIMIT = 100

export interface CueverseRecord {
  rating: number
  wins: number
  losses: number
  draws: number
  total: number
  /** Signed, as CueVerse stores it. Use `formatStreak` for display. */
  streak: number
  /** CueVerse's own flag for a rating still finding its level. */
  provisional: boolean
}

export interface CueverseGame {
  /** CueVerse's game id. Also the replay id — see `watchHref`. */
  id: number
  /** Epoch milliseconds, as sent. Rendered in the visitor's own timezone on the client. */
  at: number
  /** The raw opponent field, kept so nothing is lost, plus the parts as CueVerse links them. */
  opponent: string
  opponentParts: OpponentPart[]
  /** 'won' | 'lost' | 'draw' — CueVerse's own words, so a caller can colour without re-deriving. */
  result: string
  /** "Won", "Lost", or a placing like "3rd of 8" for a tournament game. */
  resultLabel: string
  /** "8-Ball", "8-Ball (2 vs 2)", … */
  variation: string
  ratingBefore: number | null
  ratingAfter: number | null
  /** ratingAfter - ratingBefore, or null when either is missing. CueVerse's page does the same. */
  ratingChange: number | null
  /** The replay, when there is one. Null renders as a dash rather than a dead link. */
  watchHref: string | null
  rated: boolean
}

export interface CueverseProfile {
  /** The name CueVerse holds, which may differ in casing from the ID we sent. */
  name: string
  /** CueVerse's avatar index. Not rendered yet — no photographs in this pass. */
  avatar: number
  record: CueverseRecord
  /** Formatted "W10" / "L2" / "—". */
  streakLabel: string
  games: CueverseGame[]
  profileHref: string
}

export type CueverseResult =
  | { status: 'ok'; profile: CueverseProfile; fetchedAt: string }
  /** A valid ID that CueVerse does not know. Different from a failure, and says so. */
  | { status: 'not-found'; cueverseId: string }
  /** No usable CueVerse ID stored for this player. */
  | { status: 'no-id' }
  /** CueVerse could not be reached, or answered with something unusable. */
  | { status: 'unavailable'; reason: string }

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : 0
}
const numOrNull = (v: unknown): number | null => {
  if (v == null) return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

/**
 * Turn the endpoint's JSON into our shape, coercing every field.
 *
 * Exported for the tests, which run it over a recorded response rather than over the network — the
 * point of a suite is that it says the same thing on a train.
 */
export function normalizeProfile(raw: unknown, cueverseId: string): CueverseProfile | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>

  const pool = (r.profile ?? {}) as Record<string, unknown>
  const record: CueverseRecord = {
    rating: num(pool.rating),
    wins: num(pool.wins),
    losses: num(pool.losses),
    draws: num(pool.draws),
    total: num(pool.total),
    streak: num(pool.streak),
    provisional: Boolean(pool.provisional),
  }

  const history = Array.isArray(r.history) ? r.history : []
  const games: CueverseGame[] = history.map((h) => {
    const g = (h ?? {}) as Record<string, unknown>
    const before = numOrNull(g.ratingBefore)
    const after = numOrNull(g.ratingAfter)
    const opponent = typeof g.opponent === 'string' ? g.opponent : ''
    const result = typeof g.result === 'string' ? g.result : ''
    const place = numOrNull(g.place)
    const field = numOrNull(g.field)
    /*
      A replay exists only for pool, and only when CueVerse says the game is replayable. Building
      the link from the id regardless would offer "Watch" on games that have nothing to watch.
    */
    const replayable = Boolean(g.replayable)
    const id = num(g.id)
    return {
      id,
      at: num(g.date),
      opponent,
      opponentParts: opponentParts(opponent),
      result,
      resultLabel: resultLabel({ result, place, field }),
      variation: typeof g.variation === 'string' ? g.variation : '',
      ratingBefore: before,
      ratingAfter: after,
      ratingChange: before != null && after != null ? after - before : null,
      watchHref: replayable && id > 0 ? cueverseReplayUrl(id) : null,
      rated: Boolean(g.rated),
    }
  })

  return {
    name: typeof r.name === 'string' && r.name ? r.name : cueverseId,
    avatar: num(r.avatar),
    record,
    streakLabel: formatStreak(record.streak),
    games,
    profileHref: `https://cueverse.gg/profile/?name=${encodeURIComponent(cueverseId)}&game=${CUEVERSE_GAME}`,
  }
}

/**
 * One network read, with a deadline.
 *
 * Separated from the cache wrapper so the timeout is visible and so a test can exercise the parsing
 * without `unstable_cache` needing a request store.
 */
async function fetchProfile(cueverseId: string): Promise<CueverseResult> {
  const url = `https://api.cueverse.gg/api/profile?name=${encodeURIComponent(cueverseId)}`
    + `&game=${CUEVERSE_GAME}&limit=${GAME_LIMIT}`

  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), TIMEOUT_MS)
  const started = Date.now()

  /*
    Say so in the log when this fails.

    The reader is told the panel is unavailable and that is enough for them, but the returned status
    was previously the only trace a failure left anywhere: the error was turned into a message and
    dropped. A read that fails on the live site was therefore invisible — production logs showed the
    request and nothing else, so the only way to explain one was to reason about it from outside.
    The elapsed time is the useful part: it separates a genuine deadline from an instant refusal.
  */
  const failed = (reason: string, detail?: unknown): CueverseResult => {
    console.error('[cueverse] profile read failed', {
      cueverseId, ms: Date.now() - started, reason,
      detail: detail instanceof Error ? `${detail.name}: ${detail.message}` : detail,
    })
    return { status: 'unavailable', reason }
  }

  try {
    const res = await fetch(url, {
      signal: abort.signal,
      headers: { accept: 'application/json' },
      // Our own cache is the one above this; Next's fetch cache would be a second, quieter one.
      cache: 'no-store',
    })
    if (res.status === 404) return { status: 'not-found', cueverseId }
    if (!res.ok) return failed(`CueVerse answered ${res.status}.`)

    const profile = normalizeProfile(await res.json(), cueverseId)
    if (!profile) return failed('CueVerse sent a response we could not read.')
    return { status: 'ok', profile, fetchedAt: new Date().toISOString() }
  } catch (e) {
    return failed(
      e instanceof Error && e.name === 'AbortError'
        ? 'CueVerse did not answer in time.'
        : 'CueVerse could not be reached.',
      e,
    )
  } finally {
    clearTimeout(timer)
  }
}

/** Carries a failure out of the cached read without being stored as its answer. */
class CueverseUnavailable extends Error {
  constructor(readonly detail: string) {
    super(detail)
    this.name = 'CueverseUnavailable'
  }
}

/**
 * The shared read: one answer per ID per minute, across every visitor and instance.
 *
 * A failure leaves here as a throw rather than as a value, which is the whole point. `unstable_cache`
 * stores what the callback RETURNS; a rejection is not written. So a real answer — including an
 * honest 404, which is a stable fact about a player and worth keeping — is cached for the full
 * minute, while a failure never enters the shared cache at all and cannot be served to the next
 * visitor as though CueVerse had been asked.
 */
const readProfile = unstable_cache(
  async (cueverseId: string): Promise<CueverseResult> => {
    const result = await fetchProfile(cueverseId)
    if (result.status === 'unavailable') throw new CueverseUnavailable(result.reason)
    return result
  },
  ['cueverse-profile-v2'],
  { revalidate: CACHE_SECONDS },
)

/**
 * A short hold on failure, kept in this instance's memory rather than in the shared cache.
 *
 * This is the stampede guard the shared cache used to provide, at a tenth of the cost to everyone
 * else: it stops one instance going back to a struggling CueVerse on every render, and it expires
 * on its own long before a visitor would notice. It is deliberately not authoritative — an empty
 * map after a cold start just means the next read tries CueVerse, which is the correct behaviour.
 */
const heldFailures = new Map<string, { until: number; result: CueverseResult }>()

/**
 * A player's CueVerse profile, cached per ID.
 *
 * Keyed by the ID so two visitors on the same profile share one read, and so opening the CueVerse
 * window, closing it and opening it again does not go back to CueVerse each time. One page view of
 * one profile makes at most one request; a minute of traffic on a popular profile makes one too.
 */
export async function getCueverseProfile(cueverseId: string): Promise<CueverseResult> {
  const id = (cueverseId ?? '').trim()
  if (!id) return { status: 'no-id' }

  const held = heldFailures.get(id)
  if (held && held.until > Date.now()) return held.result

  try {
    return await readProfile(id)
  } catch (e) {
    const result: CueverseResult = {
      status: 'unavailable',
      reason: e instanceof CueverseUnavailable ? e.detail : 'CueVerse could not be reached.',
    }
    // Prune while we are here: without this the map would keep an entry per ID seen, for ever.
    const now = Date.now()
    for (const [key, entry] of heldFailures) if (entry.until <= now) heldFailures.delete(key)
    heldFailures.set(id, { until: now + NEGATIVE_CACHE_MS, result })
    return result
  }
}

/** The uncached path, for scripts and tests that must not depend on a Next request store. */
export const fetchCueverseProfileUncached = fetchProfile
