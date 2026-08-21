/**
 * The approved launch content for the admin-managed site settings.
 *
 * Single source of truth, deliberately free of framework imports so three very different callers
 * can share it:
 *   · `service.ts` — fallbacks, so an uninitialised database still renders the intended page
 *   · `scripts/seed-site-content.mts` — what gets published on first seed
 *   · `scripts/verify-site-content.mts` — what the test suite restores when it finishes
 *
 * Keeping one copy means a wording change cannot drift between the seed and the fallback.
 */
export const APPROVED_SITE_CONTENT = {
  siteName: '8 Ball Registry',

  logoFile: 'public/assets/branding/8br-logo.png',
  logoAlt: '',
  logoUploadAlt: '8 Ball Registry crest',

  bannerFile: 'public/assets/branding/8br-banner2.png',
  bannerAlt:
    'The 8 Ball Registry hall — an eight ball mounted in a brass orrery, ringed by record displays',

  welcomeLine: 'WELCOME TO 8 BALL REGISTRY',
  headlineLine1: 'COMPETITION',
  headlineLine2: 'HISTORY',
  description:
    'Explore seasons, Tournaments, champions, and results from across the competitive 8-ball community.',
  supportingSentence: 'Every competition. Every result. One permanent record.',
  primaryButtonLabel: 'Seasons',
  primaryButtonHref: '/seasons',
  secondaryButtonLabel: 'Tournaments',
  secondaryButtonHref: '/tournaments',
} as const
