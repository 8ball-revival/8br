import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'

import { Wide } from '@/components/primitives'
import { mostRecentlyCreatedSeason, getSeasonBrowseData } from '@/lib/seasons/browse'
import { resolveStaffAccess } from '@/lib/competition/staff-auth'
import { pageMetadata } from '@/lib/site'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const metadata: Metadata = pageMetadata({
  title: 'Seasons',
  description: 'Season Championships at the 8 Ball Registry — groups into a championship playoff bracket.',
  path: '/seasons',
})

/**
 * Seasons opens the SEASON BROWSER on the most recently created Season the visitor may see.
 *
 * The browser is the Seasons experience: its Competition, Year and Season pickers cover everything a
 * card grid would, and it lands the reader on real data — group tables, the champion, the playoff
 * bracket — rather than on a page of summaries they then have to click through. A list in front of
 * it is a menu in front of a menu.
 *
 * ── What "most recent" means, and what it used to mean ───────────────────────────────────────────
 * `createdAt` descending, with id descending to break ties. It used to be competition year then
 * Season number, borrowed from the Season picker — which is the right order for a reader scanning a
 * Competition, and the wrong answer to "where should Seasons open". A Season created today for an
 * earlier year, or numbered 1 because its Competition is new, sorts below records made years ago, so
 * the thing you just made is not what opens.
 *
 * Worse, this defaulted the Competition to 8BRCAM whenever the URL named none. A Season created
 * under any OTHER Competition was therefore invisible here: the page said "No CueVerse Seasons Yet"
 * while the Season sat in the database, reachable only by typing its id. A bare request now searches
 * the whole registry and scopes itself to whatever it finds.
 *
 * ── Visibility ──────────────────────────────────────────────────────────────────────────────────
 * An anonymous visitor can only be sent to a publicly visible Season. Staff who may manage
 * competitions can be sent to a private one — the same rule seasons/visibility applies to the detail
 * page, asked here so the landing page cannot offer a door the next page refuses.
 *
 * An explicit competition, platform, division, year, Season, search or view in the URL is respected
 * and carried through, so a shared link keeps its scope.
 *
 * The redirect targets the Season's immutable id, never its display number.
 *
 * Read-only: creating, editing, reopening and completing all live in Creator, and nothing here
 * links into them.
 */
export default async function SeasonsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const one = (k: string) => { const v = sp[k]; return typeof v === 'string' ? v : Array.isArray(v) ? v[0] : undefined }

  /*
   * Only what the URL actually says.
   *
   * A default applied here becomes a filter the visitor never chose, and that was this page's whole
   * failure: an unrequested Competition, quietly excluding everything outside it.
   */
  const askedCompetition = one('competition') || null
  const askedPlatformRaw = one('platform')
  const askedPlatform = askedPlatformRaw
    ? (askedPlatformRaw.toUpperCase() === 'YAHOO' ? 'YAHOO' : 'CUEVERSE')
    : null
  const askedDivision = one('division') || null

  /*
   * Staff may be sent to a private Season; nobody else may. Resolved once here and handed to the
   * query — the rule itself stays in seasons/visibility, which the detail page also asks.
   */
  const access = await resolveStaffAccess()
  const includePrivate = access.status === 'ok' && access.actor.can('manage_competitions')

  const target = await mostRecentlyCreatedSeason({
    competitionSlug: askedCompetition,
    platform: askedPlatform,
    division: askedDivision,
    includePrivate,
  })

  if (target != null) {
    /*
     * Everything that came in is carried through, so a link holding a year, a Season, a search or a
     * view keeps them. Competition and platform are then pinned to the Season actually being opened,
     * so the browser's own pickers show where the reader has landed rather than a scope the page
     * quietly ignored.
     */
    const qs = new URLSearchParams()
    for (const [key, value] of Object.entries(sp)) {
      const v = typeof value === 'string' ? value : Array.isArray(value) ? value[0] : undefined
      if (v != null && v !== '') qs.set(key, v)
    }
    qs.set('competition', askedCompetition ?? target.competitionSlug)
    if ((askedPlatform ?? target.platform) === 'YAHOO') qs.set('platform', 'yahoo')
    else qs.delete('platform')
    if (askedDivision) qs.set('division', askedDivision)
    qs.set('view', one('view') === 'playoffs' ? 'playoffs' : 'groups')
    redirect(`/seasons/${target.id}?${qs.toString()}`)
  }

  /*
   * Nothing this visitor may open: an empty registry, or a filter matching nothing. The empty state
   * describes the scope that was actually asked for rather than assuming CueVerse.
   */
  const platform = askedPlatform ?? 'CUEVERSE'
  const { competitions } = await getSeasonBrowseData(null, platform, askedDivision)
  return (
    <Wide name="seasons" className="py-16">
      <div className="mx-auto flex max-w-lg flex-col items-center gap-3 text-center">
        <h1 className="font-display text-2xl font-bold text-foreground">
          {platform === 'YAHOO' ? 'No Yahoo Seasons' : 'No Seasons Yet'}
        </h1>
        <p className="text-sm text-muted-foreground">
          {askedCompetition && competitions.length > 0
            ? 'That Competition has no Seasons you can open.'
            : askedPlatform || askedDivision
              ? 'No Seasons match that filter.'
              : 'No Seasons have been created yet.'}
        </p>
        {/* Never a silent fall-back to the other platform: the way to the archive is a deliberate
            choice, so an empty CueVerse registry cannot be mistaken for a populated one. */}
        {platform === 'CUEVERSE' && (
          <Link href="/seasons?platform=yahoo" className="text-sm text-[var(--gold)] hover:underline">
            Browse the Yahoo archive
          </Link>
        )}
      </div>
    </Wide>
  )
}
