import type { Metadata } from 'next'
import { redirect } from 'next/navigation'

import { Wide } from '@/components/primitives'
import { newestSeasonId, getSeasonBrowseData, DEFAULT_COMPETITION_SLUG } from '@/lib/seasons/browse'
import { pageMetadata } from '@/lib/site'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const metadata: Metadata = pageMetadata({
  title: 'Seasons',
  description: 'Season Championships at the 8 Ball Registry — groups into a championship playoff bracket.',
  path: '/seasons',
})

/**
 * Seasons opens the SEASON BROWSER on the most recent Season.
 *
 * The browser is the Seasons experience: its Competition, Year and Season pickers cover everything a
 * card grid would, and it lands the reader on real data — group tables, the champion, the playoff
 * bracket — rather than on a page of summaries they then have to click through. A list in front of
 * it is a menu in front of a menu.
 *
 * "Most recent" is competition year descending, then Season number descending, with the Competition
 * name and Season id breaking ties — the same rule the pickers use, so the landing page and the
 * controls can never disagree. A Season under way is by that rule the newest, so it is what opens.
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
  // Visiting Seasons with no Competition in the URL opens 8BRCAM rather than every Competition at
  // once. An explicit ?competition= still wins, so a shared link keeps its scope.
  const competition = one('competition') ?? DEFAULT_COMPETITION_SLUG
  /*
   * Platform and division ride in the URL and are carried into the redirect.
   *
   * Without that, choosing Yahoo would land on a CueVerse Season — the filter would appear to do
   * nothing. There is deliberately no fallback to the other platform when one is empty: an empty
   * CueVerse registry says so, rather than quietly showing the archive and implying it is current.
   */
  const platform = one('platform')?.toUpperCase() === 'YAHOO' ? 'YAHOO' : 'CUEVERSE'
  const division = one('division') || null

  const newest = await newestSeasonId(competition, platform, division)
  if (newest != null) {
    const qs = new URLSearchParams()
    if (competition) qs.set('competition', competition)
    if (platform === 'YAHOO') qs.set('platform', 'yahoo')
    if (division) qs.set('division', division)
    qs.set('view', one('view') === 'playoffs' ? 'playoffs' : 'groups')
    redirect(`/seasons/${newest}?${qs.toString()}`)
  }

  // Nothing to open under this platform — an empty CueVerse registry, or a filter matching nothing.
  const { competitions } = await getSeasonBrowseData(null, platform, division)
  return (
    <Wide name="seasons" className="py-16">
      <div className="mx-auto flex max-w-lg flex-col items-center gap-3 text-center">
        <h1 className="font-display text-2xl font-bold text-foreground">
          {platform === 'YAHOO' ? 'No Yahoo Seasons' : 'No CueVerse Seasons Yet'}
        </h1>
        <p className="text-sm text-muted-foreground">
          {platform === 'CUEVERSE'
            ? 'Nothing has been played on CueVerse yet. The Yahoo archive is under the platform filter.'
            : competition && competitions.length > 0
              ? 'That Competition has no Yahoo Seasons.'
              : 'No Yahoo Seasons match that filter.'}
        </p>
        {/* Never a silent fall-back to the other platform: the way to the archive is a deliberate
            choice, so an empty CueVerse registry cannot be mistaken for a populated one. */}
        {platform === 'CUEVERSE' && (
          <a href="/seasons?platform=yahoo" className="text-sm text-[var(--gold)] hover:underline">
            Browse the Yahoo archive
          </a>
        )}
      </div>
    </Wide>
  )
}
