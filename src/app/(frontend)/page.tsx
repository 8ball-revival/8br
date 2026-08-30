import type { Metadata } from 'next'

import { pageMetadata, brandName } from '@/lib/site'
import { BuilderPage } from '@/components/site-builder/edit-mode'

/**
 * `/` — the registry dashboard.
 *
 * ── What changed, and what deliberately did not ──────────────────────────────────────────────────
 * The five rows this file used to lay out by hand — Competition History beside Live Rankings, the
 * competition marquee, The Break beside the archive notice, the achievements carousel, the status
 * rail — are now a published LAYOUT rather than JSX. The rows, the 58/42 and 55/45 proportions and
 * the module order are unchanged: they were transcribed into the factory layout in
 * `lib/site-builder/factory.ts`, which is what the first publish captured. Enabling the builder did
 * not redesign this page.
 *
 * The modules are the same components, called with the same services. `CompetitionHistory` still
 * reads `getHomeNews`, `LiveRankings` still reads `getHomeLeaderboard`. Nothing on this page
 * computes a ranking, a champion or a statistic of its own — that was true before and is enforced
 * now, because a data module's configuration is a set of arguments to an existing service and there
 * is nowhere for a second calculation to live.
 *
 * ── Recovery ─────────────────────────────────────────────────────────────────────────────────────
 * If the published layout is ever unreadable, `getPublishedLayout` falls back a revision at a time
 * and finally to the code-defined factory layout. This page cannot be taken down by an edit.
 */

/*
 * Per-request rather than cached at build.
 *
 * The individual services are each cached with their own revalidation, and the layout is cached
 * under the site-builder tag, so this is not a licence to re-query everything on every hit — it is
 * what lets an admin publish a layout, an article or a closed Season and see it without a redeploy.
 */
export const dynamic = 'force-dynamic'

export const metadata: Metadata = pageMetadata({
  title: brandName,
  description:
    '8 Ball Registry — seasons, tournaments, champions and results from across the competitive '
    + '8-ball community. Every competition. Every result. One permanent record.',
  path: '/',
})

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  return <BuilderPage pageKey="/" pageTitle="Homepage" searchParams={searchParams} />
}
