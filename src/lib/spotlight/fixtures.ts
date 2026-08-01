/**
 * Selectable "who are you" spotlight players (dev fixture). Built from the real
 * registrant list, enriched with honestly-derived stats (season titles + all-time
 * rank from the Top 10, cup titles from Cups). Unknown stats are simply 0/absent —
 * nothing is fabricated. Swap for a Payload/Prisma query later.
 */
import { getTop10 } from '@/lib/hall-of-fame/fixtures'
import { getHomeData } from '@/lib/home/fixtures'
import { getCups } from '@/lib/cups/fixtures'

export interface SpotlightPlayer {
  slug: string
  name: string
  handle: string
  timezone: string
  seasonTitles: number
  cupTitles: number
  allTimeRank: number | null
}

function slugify(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, '-')
}

export function getSpotlightPlayers(): SpotlightPlayer[] {
  const top10 = getTop10()
  const cups = getCups()
  const registrations = getHomeData().registrations

  return registrations.map((r) => {
    const hofIndex = top10.findIndex(
      (t) => t.name.toLowerCase() === r.name.toLowerCase() || t.handle.toLowerCase() === r.handle.toLowerCase(),
    )
    const hof = hofIndex >= 0 ? top10[hofIndex] : null

    const cupTitles = cups.filter(
      (c) =>
        c.champion &&
        (c.champion.name.toLowerCase() === r.name.toLowerCase() ||
          (c.champion.handle && c.champion.handle.toLowerCase() === r.handle.toLowerCase())),
    ).length

    return {
      slug: slugify(r.name),
      name: r.name,
      handle: r.handle,
      timezone: r.timezone,
      seasonTitles: hof?.titles ?? 0,
      cupTitles,
      allTimeRank: hof ? hofIndex + 1 : null,
    }
  })
}
