import { BuilderPage } from '@/components/site-builder/edit-mode'
import type { Metadata } from 'next'
import { getSeasonView } from '@/lib/seasons/service'
import { seasonAccess, HIDDEN_SEASON_METADATA } from '@/lib/seasons/visibility'


/**
 * `/seasons/[seasonId]/page.tsx` -- governed by the `season` template.
 *
 * The body moved to `@/components/system/season-detail-body` and is placed by the template as a system
 * module, so one layout describes every Season page: an administrator can put an announcement above
 * every Season at once, or restyle the frame, without touching a single Season's data.
 *
 * `generateMetadata` stays here because Next only reads it from a route file.
 */
export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ seasonId: string }> }): Promise<Metadata> {
  const { seasonId } = await params
  const id = Number(seasonId)

  /*
   * The metadata is guarded before the page is.
   *
   * `generateMetadata` runs even when the page body calls notFound(), so guarding only the body
   * still puts a private Season's real title in the browser tab and in the head of the not-found
   * response. Same rule, same function, applied here first.
   */
  const access = await seasonAccess(id)
  if (!access.allowed) return HIDDEN_SEASON_METADATA

  const view = await getSeasonView(id)
  return view ? { title: view.title, description: view.description ?? '8BR Season Championship.' } : { title: 'Season' }
}

export default async function Page({ params, searchParams }: {
  params: Promise<{ seasonId: string }>
  searchParams: Promise<{ view?: string; competition?: string; division?: string; platform?: string }>
}) {
  return (
    <BuilderPage
      pageKey="season"
      pageTitle="Season"
      routeParams={params as Promise<Record<string, string>>}
      searchParams={searchParams as Promise<Record<string, string | string[] | undefined>>}
      entityId={Number((await params).seasonId) || undefined}
    />
  )
}
