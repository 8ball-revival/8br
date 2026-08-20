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

  const newest = await newestSeasonId(competition)
  if (newest != null) {
    const qs = new URLSearchParams()
    if (competition) qs.set('competition', competition)
    qs.set('view', one('view') === 'playoffs' ? 'playoffs' : 'groups')
    redirect(`/seasons/${newest}?${qs.toString()}`)
  }

  // Nothing to open — a brand-new registry, or a Competition filter matching no Season.
  const { competitions } = await getSeasonBrowseData(null)
  return (
    <Wide name="seasons" className="py-16">
      <div className="mx-auto flex max-w-lg flex-col items-center gap-3 text-center">
        <h1 className="font-display text-2xl font-bold text-foreground">No Seasons Yet</h1>
        <p className="text-sm text-muted-foreground">
          {competition && competitions.length > 0
            ? 'That Competition has no Seasons yet. Seasons appear here as soon as one is created.'
            : 'Seasons appear here as soon as one is created.'}
        </p>
      </div>
    </Wide>
  )
}
