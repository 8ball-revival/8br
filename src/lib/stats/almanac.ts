import 'server-only'
import { unstable_cache } from 'next/cache'

import { computeOnThisDay, phoenixParts, type OnThisDayEvent } from './on-this-day'
import { getArchiveFact, type ArchiveFact } from './archive-fact'

/**
 * What the homepage's history card shows today.
 *
 * Three outcomes, and which one applies is decided by the data rather than by configuration:
 *
 *   on-this-day — genuine events fall on today's Arizona date, dated to the DAY. Heading: ON THIS DAY.
 *   archive     — nothing does, so a real fact is shown instead, dated only to the YEAR.
 *                 Heading: FROM THE ARCHIVE.
 *   none        — there is no canonical history at all, and the card is not rendered.
 *
 * The split exists because most of this site's history is imported, and imported rows carry the date
 * they were imported rather than the date they were played. Claiming a day for those would be
 * inventing history; claiming the year is exactly what the data supports. See PLAY_DATE_RULE.
 */

export type AlmanacMode = 'on-this-day' | 'archive' | 'none'

export interface Almanac {
  mode: AlmanacMode
  /** Populated for 'on-this-day'; the carousel shows all of them. */
  events: OnThisDayEvent[]
  /** Populated for 'archive'. */
  fact: ArchiveFact | null
}

export async function computeAlmanac(now = new Date()): Promise<Almanac> {
  const events = await computeOnThisDay(now)
  if (events.length > 0) return { mode: 'on-this-day', events, fact: null }

  const fact = await getArchiveFact(now)
  if (fact) return { mode: 'archive', events: [], fact }

  return { mode: 'none', events: [], fact: null }
}

export const ALMANAC_TAG = 'home-almanac'

/**
 * The cached read used by the homepage.
 *
 * Keyed by the Arizona date so the entry turns over at Arizona midnight rather than the server's, and
 * revalidated hourly so a competition completed today appears without a deploy.
 */
export const getAlmanac = unstable_cache(
  async (_phoenixDateKey: string) => computeAlmanac(),
  ['home-almanac'],
  { tags: [ALMANAC_TAG], revalidate: 3600 },
)

/** The cache key for right now, in Arizona. */
export function phoenixDateKey(now = new Date()): string {
  const { year, month, day } = phoenixParts(now)
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/**
 * Render the card for a supplied date, for development and tests only.
 *
 * Guarded three ways, because a public endpoint that accepts an arbitrary "today" is a way to make the
 * site assert things about dates that have not happened:
 *
 *   - NODE_ENV must not be production, so it cannot be reached on the deployed site at all;
 *   - the date must parse;
 *   - the result is computed fresh rather than served or written through the cache, so a test date can
 *     never poison what real visitors see.
 *
 * Returns null when unavailable, so a caller renders the ordinary card rather than an error.
 */
export async function almanacForTestDate(raw: string | null | undefined): Promise<Almanac | null> {
  if (process.env.NODE_ENV === 'production') return null
  if (!raw) return null

  // Parsed as Arizona noon rather than midnight UTC: midnight would land on the previous day in
  // Phoenix and the override would silently test the wrong date.
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim())
  if (!match) return null
  const at = new Date(`${match[1]}-${match[2]}-${match[3]}T19:00:00Z`)
  if (Number.isNaN(at.getTime())) return null

  return computeAlmanac(at)
}
