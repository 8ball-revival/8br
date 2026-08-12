/**
 * Public preview search — a straightforward normalized (case-insensitive substring)
 * search across the current frontend preview datasets. No fuzzy-search library is
 * needed at this scale. Alias matches resolve to the canonical player. Everything
 * links to a real, existing detail route.
 */
import { searchPlayers } from './preview-players'
import { searchCompetitions } from './preview-competitions'
import { seasons, news } from './mock-data'
import { formatDate } from './format'

export type SearchType = 'player' | 'competition' | 'season' | 'news'
export type SearchBadge = 'archive' | 'pending' | 'ego' | null

export interface SearchResult {
  type: SearchType
  title: string
  subtitle: string
  href: string
  badge: SearchBadge
  matchedAlias?: string | null
}

export interface SearchResults {
  query: string
  players: SearchResult[]
  competitions: SearchResult[]
  seasons: SearchResult[]
  news: SearchResult[]
  total: number
}

export function searchAll(rawQuery: string): SearchResults {
  const query = (rawQuery ?? '').trim()
  const q = query.toLowerCase()
  if (!q) {
    return { query, players: [], competitions: [], seasons: [], news: [], total: 0 }
  }

  const players: SearchResult[] = searchPlayers(query).map((h) => ({
    type: 'player',
    title: h.primaryName,
    subtitle: `${h.playerId} · ${h.aliasCount} aliases`,
    href: `/players/${h.slug}`,
    badge: 'archive',
    matchedAlias: h.matchedAlias ?? null,
  }))

  const competitions: SearchResult[] = searchCompetitions(query).map((c) => ({
    type: 'competition',
    title: c.name,
    subtitle: `Historical archive · ${c.legacyName}`,
    href: `/competitions/${c.slug}`,
    badge: 'archive',
  }))

  const seasonResults: SearchResult[] = seasons
    .filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        (s.originalName ? s.originalName.toLowerCase().includes(q) : false),
    )
    .map((s) => ({
      type: 'season',
      title: s.name,
      subtitle: s.originalName ? `8 Ball Revival season · originally ${s.originalName}` : `8 Ball Revival season · ${s.year}`,
      href: `/seasons/${s.slug}`,
      badge: s.slug === 'ego-season-1' ? 'pending' : 'ego',
    }))

  const newsResults: SearchResult[] = news
    .filter((n) => n.title.toLowerCase().includes(q) || n.excerpt.toLowerCase().includes(q))
    .map((n) => ({
      type: 'news',
      title: n.title,
      subtitle: `${n.category} · ${formatDate(n.date)}`,
      href: `/news/${n.slug}`,
      badge: null,
    }))

  const total = players.length + competitions.length + seasonResults.length + newsResults.length
  return { query, players, competitions, seasons: seasonResults, news: newsResults, total }
}
