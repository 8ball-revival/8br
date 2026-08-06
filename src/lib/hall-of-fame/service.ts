/**
 * Hall of Fame service — the archive-derived source for the public Hall of Fame.
 *
 * Champions = every player with at least one Season championship (group + season play
 * only; cups excluded). DERIVED from the canonical season-stats service
 * (`getSeasonRankings`, the SAME historical archive that feeds the restored Rankings) —
 * no manual title counts, no mock/preview data, no new calculations. Because it reads
 * the archive at call time, it agrees with the homepage Top 10, player profiles, and
 * Rankings. Per-champion group/playoff win records come from the career-stats service.
 */
import { getSeasonRankings } from '@/lib/stats/season-stats'

export interface HofPlayer {
  id: string // canonical player id (keys into career-stats / season-stats)
  slug: string
  name: string
  handle: string
  titles: number
  yearsWon: string[] // season ids, e.g. "2005-s1"
}

function slugify(s: string): string {
  return s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

/** Every champion, most Season titles first (season-stats order), no cap. */
function computeChampions(): HofPlayer[] {
  const out: HofPlayer[] = []
  const usedSlugs = new Set<string>()
  for (const p of getSeasonRankings()) {
    if (p.championships < 1) continue // Hall of Fame = champions only
    let slug = slugify(p.name)
    while (usedSlugs.has(slug)) slug = `${slug}-${p.id.toLowerCase()}`
    usedSlugs.add(slug)
    out.push({
      id: p.id,
      slug,
      name: p.name,
      handle: p.aliases[0] ?? p.name, // canonical primary handle (already scrubbed)
      titles: p.championships,
      yearsWon: [...p.championshipSeasons],
    })
  }
  // Owner-preferred Hall of Fame ordering (isolated to this list — Rankings/season-stats are
  // NOT affected): among champions with the SAME number of titles, Sid then Neo sort to the top
  // of that group; everyone else keeps their archive-derived order. Array.sort is stable, so
  // equal keys preserve their existing relative order and title tiers stay intact.
  const PINNED_FIRST = new Map<string, number>([['P1262', 0], ['neo', 1]]) // Sid, then Neo
  out.sort((a, b) => b.titles - a.titles || (PINNED_FIRST.get(a.id) ?? 99) - (PINNED_FIRST.get(b.id) ?? 99))
  return out
}

let _champions: HofPlayer[] | null = null

/** All Hall of Fame champions (uncapped) — powers the public Hall of Fame list. */
export function getAllChampions(): HofPlayer[] {
  return (_champions ??= computeChampions())
}

/** Top 10 champions — retained for the homepage Top 10 / spotlight. */
export function getTop10(): HofPlayer[] {
  return getAllChampions().slice(0, 10)
}

export function getHofPlayer(slug: string): HofPlayer | undefined {
  return getAllChampions().find((p) => p.slug === slug)
}

/** "2005-S1" -> "2005 · Season 1" */
export function formatSeasonId(id: string): string {
  const [year, s] = id.split('-')
  const n = s?.replace(/^s/i, '')
  return n ? `${year} · Season ${n}` : id
}
