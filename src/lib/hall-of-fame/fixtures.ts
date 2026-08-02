/**
 * Hall of Fame "Top 10 All Time" = most Season championships (group + season play
 * only; cups excluded). DERIVED from the canonical season-stats service — no manual
 * title counts. Same source as the homepage Top 10 and player profiles, so they agree.
 */
import { getSeasonRankings } from '@/lib/stats/season-stats'

export interface HofPlayer {
  slug: string
  name: string
  handle: string
  titles: number
  yearsWon: string[] // season ids, e.g. "2005-s1"
}

function slugify(s: string): string {
  return s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

function computeTop10(): HofPlayer[] {
  const out: HofPlayer[] = []
  const usedSlugs = new Set<string>()
  for (const p of getSeasonRankings()) {
    if (p.championships < 1) continue // Hall of Fame = champions only
    if (out.length >= 10) break
    let slug = slugify(p.name)
    while (usedSlugs.has(slug)) slug = `${slug}-${p.id.toLowerCase()}`
    usedSlugs.add(slug)
    out.push({
      slug,
      name: p.name,
      handle: p.aliases[0] ?? p.name, // canonical primary handle (already scrubbed)
      titles: p.championships,
      yearsWon: [...p.championshipSeasons],
    })
  }
  return out
}

let _top10: HofPlayer[] | null = null

export function getTop10(): HofPlayer[] {
  return (_top10 ??= computeTop10())
}

export function getHofPlayer(slug: string): HofPlayer | undefined {
  return getTop10().find((p) => p.slug === slug)
}

/** "2005-S1" -> "2005 · Season 1" */
export function formatSeasonId(id: string): string {
  const [year, s] = id.split('-')
  const n = s?.replace(/^s/i, '')
  return n ? `${year} · Season ${n}` : id
}
