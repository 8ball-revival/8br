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

/** CueVerse is a third party on somebody else's schedule. A slow reply must not hold our page. */
const TIMEOUT_MS = 6000

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
  try {
    const res = await fetch(url, {
      signal: abort.signal,
      headers: { accept: 'application/json' },
      // Our own cache is the one above this; Next's fetch cache would be a second, quieter one.
      cache: 'no-store',
    })
    if (res.status === 404) return { status: 'not-found', cueverseId }
    if (!res.ok) return { status: 'unavailable', reason: `CueVerse answered ${res.status}.` }

    const profile = normalizeProfile(await res.json(), cueverseId)
    if (!profile) return { status: 'unavailable', reason: 'CueVerse sent a response we could not read.' }
    return { status: 'ok', profile, fetchedAt: new Date().toISOString() }
  } catch (e) {
    const reason = e instanceof Error && e.name === 'AbortError'
      ? 'CueVerse did not answer in time.'
      : 'CueVerse could not be reached.'
    return { status: 'unavailable', reason }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * A player's CueVerse profile, cached per ID.
 *
 * Keyed by the ID so two visitors on the same profile share one read, and so opening the CueVerse
 * window, closing it and opening it again does not go back to CueVerse each time. One page view of
 * one profile makes at most one request; a minute of traffic on a popular profile makes one too.
 *
 * The whole result is cached, failures included, deliberately: if CueVerse is down, retrying it on
 * every render turns their outage into a stampede from us.
 */
export const getCueverseProfile = unstable_cache(
  async (cueverseId: string): Promise<CueverseResult> => {
    const id = (cueverseId ?? '').trim()
    if (!id) return { status: 'no-id' }
    return fetchProfile(id)
  },
  ['cueverse-profile-v1'],
  { revalidate: CACHE_SECONDS },
)

/** The uncached path, for scripts and tests that must not depend on a Next request store. */
export const fetchCueverseProfileUncached = fetchProfile
