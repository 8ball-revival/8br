import { prisma } from '@/lib/prisma'

/**
 * Whether the whole site is behind the login wall, as a setting rather than a fact of the code.
 *
 * ── Why this is stored and not compiled in ───────────────────────────────────────────────────────
 * The wall used to be unconditional: every guard, every header and both of robots.txt and
 * sitemap.xml assumed private, so opening the site again meant a deploy. It is a decision the owner
 * makes, sometimes at short notice, so it belongs in `site_setting` beside `registrationMode` — the
 * same key/value table the Site Settings screen already writes, which is why this needs no
 * migration.
 *
 * ── Which way it fails ───────────────────────────────────────────────────────────────────────────
 * Not the same way as most settings. A privacy control that fails OPEN publishes a site that
 * somebody deliberately closed, and there is no undoing that for whoever was watching; failing
 * CLOSED shows a login page to people who should not have seen one, which is embarrassing and
 * completely recoverable. So an unreadable setting is treated as PRIVATE.
 *
 * The in-process cache below softens that: a blip reuses the last value this instance actually read,
 * and only a process that has never managed a read at all falls back to PRIVATE.
 *
 * ── Why the cache is short ───────────────────────────────────────────────────────────────────────
 * This is consulted on every request that reaches the proxy, so reading the row each time would add
 * a query to every page load on a public site. Ten seconds is long enough to remove that cost and
 * short enough that flipping the toggle takes effect while the owner is still looking at the screen.
 * `invalidateSiteVisibility()` clears it immediately in the process that made the change.
 */

export type SiteVisibility = 'PUBLIC' | 'PRIVATE'

export const SITE_VISIBILITY_KEY = 'siteVisibility'

/** Public unless somebody says otherwise: this is what a fresh database means. */
export const DEFAULT_SITE_VISIBILITY: SiteVisibility = 'PUBLIC'

const CACHE_MS = 10_000
let cached: { value: SiteVisibility; at: number } | null = null

export function parseSiteVisibility(raw: string | null | undefined): SiteVisibility {
  return raw === 'PRIVATE' ? 'PRIVATE' : 'PUBLIC'
}

/** Drop the cached value in this process. Called by the action that writes the setting. */
export function invalidateSiteVisibility(): void {
  cached = null
}

export async function getSiteVisibility(): Promise<SiteVisibility> {
  const now = Date.now()
  if (cached && now - cached.at < CACHE_MS) return cached.value
  try {
    const rows = await prisma.$queryRawUnsafe<{ value: string }[]>(
      'SELECT value FROM public.site_setting WHERE key = $1 LIMIT 1', SITE_VISIBILITY_KEY,
    )
    /* No row at all is not an error: it means nobody has ever set this, which is public. */
    const value = rows.length ? parseSiteVisibility(rows[0].value) : DEFAULT_SITE_VISIBILITY
    cached = { value, at: now }
    return value
  } catch {
    /*
      Unreadable. Reuse what this process last saw, and close the site only if it has never seen
      anything — see the note above on which direction is recoverable.
    */
    if (cached) return cached.value
    return 'PRIVATE'
  }
}

/** Convenience for the many callers that only care whether the wall is up. */
export async function isSitePrivate(): Promise<boolean> {
  return (await getSiteVisibility()) === 'PRIVATE'
}

/** Write the setting. The caller is responsible for checking that it may. */
export async function setSiteVisibility(value: SiteVisibility): Promise<void> {
  await prisma.siteSetting.upsert({
    where: { key: SITE_VISIBILITY_KEY },
    create: { key: SITE_VISIBILITY_KEY, value },
    update: { value },
  })
  invalidateSiteVisibility()
}
