import { redirect } from 'next/navigation'

import { newestSeasonId } from '@/lib/seasons/browse'
import { getArchivedSeasons } from '@/lib/competition/surface'
import { Wide } from '@/components/primitives'

/**
 * Archives › Seasons opens the SEASON BROWSER rather than a second listing.
 *
 * The browser already is the Seasons archive: its Competition, Year and Season pickers cover
 * everything a card grid would, and it lands the reader on real data — group tables, the champion,
 * the playoff bracket — instead of on a page of summaries they then have to click through. A card
 * list in front of it would be a menu in front of a menu.
 *
 * The Season detail URLs are untouched, so every existing link still resolves. This page only
 * chooses which Season to open: the newest one, by competition year then Season number, which is
 * the same order the pickers use — so the landing page and the controls can never disagree.
 *
 * `/seasons` keeps its own behaviour and is NOT redirected here, so the two cannot form a loop.
 */
export const dynamic = 'force-dynamic'

export default async function ArchivedSeasonsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const one = (k: string) => { const v = sp[k]; return typeof v === 'string' ? v : Array.isArray(v) ? v[0] : undefined }
  const competition = one('competition') ?? null

  const newest = await newestSeasonId(competition)
  if (newest != null) {
    const qs = new URLSearchParams()
    if (competition) qs.set('competition', competition)
    qs.set('view', one('view') === 'playoffs' ? 'playoffs' : 'groups')
    redirect(`/seasons/${newest}?${qs.toString()}`)
  }

  // Nothing to open. Rather than a bare message, say how many Seasons are archived — which is zero
  // here, and saying so plainly is better than an empty frame.
  const page = await getArchivedSeasons()
  return (
    <Wide name="archives-seasons" className="py-16">
      <div className="mx-auto flex max-w-lg flex-col items-center gap-3 text-center">
        <h1 className="font-display text-2xl font-bold">No Archived Seasons Yet</h1>
        <p className="text-sm text-muted-foreground">
          {page.total === 0
            ? 'Seasons appear here once they have been completed.'
            : 'That Competition has no Seasons yet.'}
        </p>
      </div>
    </Wide>
  )
}
