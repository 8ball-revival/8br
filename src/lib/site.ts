/**
 * Site-wide brand + SEO constants. The production origin comes from
 * NEXT_PUBLIC_SITE_URL at deploy time; the localhost fallback keeps dev + build
 * working without it. Set NEXT_PUBLIC_SITE_URL before launch so canonical +
 * OpenGraph URLs resolve to the real domain.
 */

// --- Brand identity (single source of truth) ---
export const brandName = '8 Ball Revival'
export const brandTagline = 'Formerly known as 8BRCAM'
export const organizationName = '8 Ball Revival'

/** Default document title (home / root). */
export const SITE_TITLE_DEFAULT = '8 Ball Revival | Formerly 8BRCAM'
export const SITE_DESCRIPTION =
  'The next chapter of competitive online 8-ball. Formerly known as 8BRCAM. Register for Season 2, follow the group stage and playoffs, and explore the archive.'

// Back-compat aliases (metadata helpers reference these).
export const SITE_NAME = brandName
export const SITE_SHORT = brandName
export const SITE_TAGLINE = brandTagline

export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000').replace(/\/$/, '')

/** Absolute URL for a site-relative path (for canonical/OG). */
export function absoluteUrl(path = '/'): string {
  return `${SITE_URL}${path.startsWith('/') ? path : `/${path}`}`
}

/**
 * Standard per-page metadata helper: sets a canonical URL and mirrors title/description
 * into OpenGraph + Twitter so every public page ships complete social metadata.
 */
export function pageMetadata({
  title,
  description,
  path,
  index = true,
}: {
  title: string
  description: string
  path: string
  index?: boolean
}) {
  return {
    title,
    description,
    alternates: { canonical: path },
    robots: index ? undefined : { index: false, follow: false },
    openGraph: {
      title,
      description,
      url: absoluteUrl(path),
      siteName: brandName,
      type: 'website' as const,
    },
    twitter: {
      card: 'summary_large_image' as const,
      title,
      description,
    },
  }
}
