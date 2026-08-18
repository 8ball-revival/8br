import 'server-only'

/**
 * The CueVerse leaderboard provider.
 *
 * Everything that knows the shape of somebody else's service lives in this one file. If CueVerse
 * changes its endpoint or its payload, this is the only place that needs repairing — the sync, the
 * storage and the homepage all speak in `LeaderboardEntry` and never see a CueVerse-specific field.
 *
 * The endpoint is the same public one the CueVerse site itself uses to fill its leaderboard
 * (`/api/stats?game=pool` on their API host, which their own page comments describe as CORS-open).
 * Preferring it to reading their HTML means we depend on a structured contract rather than on their
 * markup, and it is the interface they already expose to any browser that loads their page.
 *
 * Nothing here authenticates, retries aggressively, or works around any restriction: it is one
 * timed GET a day.
 */

/** Where the data comes from. Overridable so a test can point at a local fixture. */
export const CUEVERSE_STATS_URL = process.env.CUEVERSE_STATS_URL
  ?? 'https://api.cueverse.gg/api/stats?game=pool'

/** The public leaderboard page, for the "view full leaderboard" link. */
export const CUEVERSE_LEADERBOARD_URL = 'https://cueverse.gg/#leaderboard'
export const CUEVERSE_HOME_URL = 'https://cueverse.gg/'

/** How many rows the homepage card shows, and therefore how many are kept. */
export const TOP_N = 5

/** A single request is given this long before it is abandoned. */
export const FETCH_TIMEOUT_MS = 8_000
/** Attempts per sync, including the first. Small on purpose: this runs daily, not per request. */
export const MAX_ATTEMPTS = 3

export interface LeaderboardEntry {
  rank: number
  name: string
  rating: number
  wins: number | null
  losses: number | null
  provisional: boolean
}

export interface LeaderboardPayload {
  entries: LeaderboardEntry[]
  playersOnline: number | null
  tablesActive: number | null
  /** Bounded copy of the response, for diagnosing a shape change later. */
  raw: unknown
}

export class ProviderError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProviderError'
  }
}

// --------------------------------------------------------------------------- sanitising

/**
 * Clean a display name that came from outside.
 *
 * Control characters, zero-width and bidirectional-override characters go: they are invisible, and
 * a right-to-left override in a leaderboard row can make a name render as something else entirely.
 * The result is plain text and is rendered as plain text, so there is no markup path here — but a
 * name is still not allowed to be a thousand characters long.
 */
export function sanitiseName(input: unknown): string {
  if (typeof input !== 'string') return ''
  return input
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 64)
}

/** A rating or record that is a whole number inside a believable range, or null. */
function intOrNull(value: unknown, { min, max }: { min: number; max: number }): number | null {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n) || !Number.isInteger(n)) return null
  if (n < min || n > max) return null
  return n
}

// --------------------------------------------------------------------------- parsing

/**
 * Turn a response body into entries, or refuse it.
 *
 * Deliberately strict. A malformed or surprising payload must fail loudly here so the caller keeps
 * the previous good snapshot, rather than being half-accepted and overwriting real data with
 * nonsense. Every rule below is a way the data could be wrong in a way that would show on the page.
 */
export function parseStatsPayload(body: unknown): LeaderboardPayload {
  if (!body || typeof body !== 'object') throw new ProviderError('Response was not an object.')
  const root = body as Record<string, unknown>

  const list = root.leaderboard
  if (!Array.isArray(list)) throw new ProviderError('Response had no leaderboard array.')
  if (list.length === 0) throw new ProviderError('Leaderboard was empty.')

  const entries: LeaderboardEntry[] = []
  // The source's own order IS the ranking. Rank comes from position, never from re-sorting by
  // rating: if CueVerse ranks by something we cannot see, re-sorting would silently disagree with
  // the page we are mirroring.
  for (const item of list.slice(0, TOP_N)) {
    if (!item || typeof item !== 'object') throw new ProviderError('A leaderboard row was not an object.')
    const row = item as Record<string, unknown>

    const name = sanitiseName(row.name)
    if (!name) throw new ProviderError('A leaderboard row had no usable name.')

    const rating = intOrNull(row.rating, { min: 0, max: 10_000 })
    if (rating == null) throw new ProviderError(`Row "${name}" had an unusable rating.`)

    entries.push({
      rank: entries.length + 1,
      name,
      rating,
      wins: intOrNull(row.wins, { min: 0, max: 1_000_000 }),
      losses: intOrNull(row.losses, { min: 0, max: 1_000_000 }),
      provisional: row.provisional === true,
    })
  }

  if (entries.length < TOP_N) {
    throw new ProviderError(`Expected ${TOP_N} leaderboard rows, got ${entries.length}.`)
  }

  return {
    entries,
    playersOnline: intOrNull(root.online, { min: 0, max: 1_000_000 }),
    tablesActive: intOrNull(root.tables, { min: 0, max: 1_000_000 }),
    // Bounded: a diagnostic copy is worth keeping, an unbounded one is a liability.
    raw: JSON.parse(JSON.stringify(body).slice(0, 20_000) || '{}'),
  }
}

/** A stable digest of the entries, so an unchanged fetch can be recognised as unchanged. */
export function checksumOf(entries: LeaderboardEntry[]): string {
  const canonical = entries.map((e) => `${e.rank}:${e.name}:${e.rating}:${e.wins ?? ''}:${e.losses ?? ''}`).join('|')
  // FNV-1a. Not a security hash — this only has to notice that two payloads differ.
  let h = 0x811c9dc5
  for (let i = 0; i < canonical.length; i += 1) {
    h ^= canonical.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

// --------------------------------------------------------------------------- fetching

/**
 * Fetch the leaderboard, with a hard timeout and a small number of attempts.
 *
 * Retries are spaced and few. This runs once a day; hammering somebody else's service because our
 * first attempt failed would be rude and would not make the data arrive any sooner.
 */
export async function fetchLeaderboard(
  { url = CUEVERSE_STATS_URL, attempts = MAX_ATTEMPTS, timeoutMs = FETCH_TIMEOUT_MS } = {},
): Promise<LeaderboardPayload> {
  let lastError: unknown = null

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { accept: 'application/json', 'user-agent': '8BallRegistry/1.0 (+https://8br.gg)' },
        cache: 'no-store',
      })
      if (!res.ok) throw new ProviderError(`Source returned ${res.status}.`)
      return parseStatsPayload(await res.json())
    } catch (err) {
      lastError = err
      // A payload we understood and rejected will not become valid by asking again.
      if (err instanceof ProviderError) break
      if (attempt < attempts) await new Promise((r) => setTimeout(r, 500 * attempt))
    } finally {
      clearTimeout(timer)
    }
  }

  const detail = lastError instanceof Error ? lastError.message : String(lastError)
  throw new ProviderError(`Could not read the CueVerse leaderboard: ${detail}`)
}
