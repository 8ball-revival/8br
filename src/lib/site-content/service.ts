import 'server-only'
import { cache } from 'react'
import { getPayload } from 'payload'
import config from '@payload-config'

import { safeHref } from './link'
import { APPROVED_SITE_CONTENT } from './defaults'

/**
 * Read side of the admin-managed site content.
 *
 * Every read here is PUBLISHED-ONLY (`draft: false`). Payload keeps the published document in the
 * global's own row and stages unpublished edits in `_versions`, so a Save Draft in the admin never
 * reaches the public site through this path.
 *
 * Reads are wrapped in React `cache()` so the header and the page share one query per request, and
 * every accessor falls back to a hardcoded default: a fresh database with no published content, or
 * a transient database error, must still render a complete page rather than a broken one.
 */

export interface SiteBrandingContent {
  siteName: string
  logoUrl: string | null
  logoWidth: number | null
  logoHeight: number | null
  logoAlt: string
}

export interface HomepageHeroContent {
  bannerUrl: string | null
  bannerAlt: string
  welcomeLine: string
  headlineLine1: string
  headlineLine2: string
  description: string
  supportingSentence: string
  primaryButtonLabel: string
  primaryButtonHref: string
  secondaryButtonLabel: string
  secondaryButtonHref: string
}

/**
 * Fallbacks used when nothing is published yet. These mirror the approved launch wording, so an
 * uninitialised database renders the intended page instead of empty space.
 */
export const HERO_FALLBACK: HomepageHeroContent = {
  bannerUrl: `/${APPROVED_SITE_CONTENT.bannerFile.replace(/^public\//, '')}`,
  bannerAlt: APPROVED_SITE_CONTENT.bannerAlt,
  welcomeLine: APPROVED_SITE_CONTENT.welcomeLine,
  headlineLine1: APPROVED_SITE_CONTENT.headlineLine1,
  headlineLine2: APPROVED_SITE_CONTENT.headlineLine2,
  description: APPROVED_SITE_CONTENT.description,
  supportingSentence: APPROVED_SITE_CONTENT.supportingSentence,
  primaryButtonLabel: APPROVED_SITE_CONTENT.primaryButtonLabel,
  primaryButtonHref: APPROVED_SITE_CONTENT.primaryButtonHref,
  secondaryButtonLabel: APPROVED_SITE_CONTENT.secondaryButtonLabel,
  secondaryButtonHref: APPROVED_SITE_CONTENT.secondaryButtonHref,
}

export const BRANDING_FALLBACK: SiteBrandingContent = {
  siteName: APPROVED_SITE_CONTENT.siteName,
  logoUrl: `/${APPROVED_SITE_CONTENT.logoFile.replace(/^public\//, '')}`,
  logoWidth: 1536,
  logoHeight: 1024,
  logoAlt: APPROVED_SITE_CONTENT.logoAlt,
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const str = (v: any, fallback: string): string =>
  typeof v === 'string' && v.trim() ? v.trim() : fallback

/** A populated `upload` field comes back as the media doc; an unpopulated one as a bare id. */
const media = (v: any): { url: string | null; width: number | null; height: number | null } => {
  if (!v || typeof v !== 'object') return { url: null, width: null, height: null }
  return {
    url: typeof v.url === 'string' && v.url ? v.url : null,
    width: typeof v.width === 'number' ? v.width : null,
    height: typeof v.height === 'number' ? v.height : null,
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

async function payload() {
  return getPayload({ config: await config })
}

export const getSiteBranding = cache(async (): Promise<SiteBrandingContent> => {
  try {
    const p = await payload()
    const doc = await p.findGlobal({ slug: 'site-branding', draft: false, depth: 1 })
    const logo = media(doc?.logo)
    return {
      siteName: str(doc?.siteName, BRANDING_FALLBACK.siteName),
      logoUrl: logo.url ?? BRANDING_FALLBACK.logoUrl,
      logoWidth: logo.url ? logo.width : BRANDING_FALLBACK.logoWidth,
      logoHeight: logo.url ? logo.height : BRANDING_FALLBACK.logoHeight,
      logoAlt: str(doc?.logoAlt, BRANDING_FALLBACK.logoAlt),
    }
  } catch {
    return BRANDING_FALLBACK
  }
})

export const getHomepageHero = cache(async (): Promise<HomepageHeroContent> => {
  try {
    const p = await payload()
    const doc = await p.findGlobal({ slug: 'homepage-hero', draft: false, depth: 1 })
    const banner = media(doc?.bannerImage)
    return {
      bannerUrl: banner.url ?? HERO_FALLBACK.bannerUrl,
      bannerAlt: str(doc?.bannerAlt, HERO_FALLBACK.bannerAlt),
      welcomeLine: str(doc?.welcomeLine, HERO_FALLBACK.welcomeLine),
      headlineLine1: str(doc?.headlineLine1, HERO_FALLBACK.headlineLine1),
      headlineLine2: str(doc?.headlineLine2, HERO_FALLBACK.headlineLine2),
      description: str(doc?.description, HERO_FALLBACK.description),
      supportingSentence: str(doc?.supportingSentence, HERO_FALLBACK.supportingSentence),
      primaryButtonLabel: str(doc?.primaryButtonLabel, HERO_FALLBACK.primaryButtonLabel),
      // Never trust a stored href: re-validate at render time (see link.ts).
      primaryButtonHref: safeHref(doc?.primaryButtonHref, HERO_FALLBACK.primaryButtonHref),
      secondaryButtonLabel: str(doc?.secondaryButtonLabel, HERO_FALLBACK.secondaryButtonLabel),
      secondaryButtonHref: safeHref(doc?.secondaryButtonHref, HERO_FALLBACK.secondaryButtonHref),
    }
  } catch {
    return HERO_FALLBACK
  }
})
