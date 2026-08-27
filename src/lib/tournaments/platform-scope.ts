import type { CompetitionPlatform } from '@prisma/client'

/**
 * Which era the Tournament list opens on.
 *
 * ── Why this is not just "CueVerse" ─────────────────────────────────────────────────────────────
 * Platform is a SCOPE, not a filter: a Yahoo Tournament and a CueVerse one are different eras, and
 * listing them together would put them in one ordering as though they ran consecutively. So the list
 * shows one era at a time, and it opened on CueVerse unconditionally.
 *
 * Which was correct right up until CueVerse had nothing in it. Every Tournament on the registry is
 * Yahoo-era, so the page opened on an empty scope and a visitor saw no Tournaments at all — the
 * whole feature, invisible, behind a filter they had no reason to touch. The empty state named the
 * archive, but naming it is not showing it.
 *
 * The scope still never MIXES eras and the URL still wins, so a shared link means what it said. What
 * changes is only where the page starts when nobody has said: the current era if it has anything to
 * show, otherwise the one that does. A CueVerse Tournament created tomorrow moves it back with no
 * further change.
 */
export type PlatformScope = Extract<CompetitionPlatform, 'CUEVERSE' | 'YAHOO'>

export function defaultPlatformScope(
  tournaments: readonly { platform: CompetitionPlatform }[],
  fromUrl?: string | null,
): PlatformScope {
  // An explicit scope is a decision the reader (or a shared link) already made.
  const asked = fromUrl?.toUpperCase()
  if (asked === 'YAHOO') return 'YAHOO'
  if (asked === 'CUEVERSE') return 'CUEVERSE'

  // Prefer the current era, and fall back only when it is genuinely empty — never to hide an era
  // that has records, and never to a scope with nothing in it while another has something.
  if (tournaments.some((t) => t.platform === 'CUEVERSE')) return 'CUEVERSE'
  if (tournaments.some((t) => t.platform === 'YAHOO')) return 'YAHOO'
  return 'CUEVERSE'
}
