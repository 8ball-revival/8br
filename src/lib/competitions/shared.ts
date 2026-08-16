/**
 * Client-safe Competition helpers and types.
 *
 * Deliberately separate from service.ts, which is `server-only` (it reaches Prisma and the audit
 * log). The Season form selector and the badge are client components, so anything they need must
 * live here or the whole server graph gets pulled into the browser bundle.
 */

export interface CompetitionRef {
  id: number
  name: string
  slug: string
  shortName: string
  iconMediaId: string | null
  active: boolean
}

export interface CreateCompetitionInput {
  name: string
  shortName?: string | null
  slug?: string | null
  iconMediaId?: string | null
}

/** URL-safe slug from a name. Mirrors the season slug style: lowercase, hyphenated, trimmed. */
export function slugifyCompetition(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

/**
 * Initials for the fallback badge: up to two characters from the short name (or name). Digits are
 * kept, so "8BRCAM" reads as "8B" rather than losing its leading numeral.
 */
export function competitionInitials(shortName: string, name?: string): string {
  const source = (shortName || name || '').trim()
  if (!source) return '??'
  const words = source.split(/\s+/).filter(Boolean)
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase()
  return source.slice(0, 2).toUpperCase()
}

/** Public URL for a Competition icon, or null when it should fall back to initials. */
export function competitionIconUrl(iconMediaId: string | null | undefined): string | null {
  return iconMediaId ? `/api/media/file/${iconMediaId}` : null
}
