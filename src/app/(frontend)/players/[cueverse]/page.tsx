import { BuilderPage } from '@/components/site-builder/edit-mode'
import type { Metadata } from 'next'
import { pageMetadata } from '@/lib/site'

type Params = Promise<{ cueverse: string }>

/**
 * `/players/[cueverse]/page.tsx` -- governed by the `player` template.
 *
 * The body moved to `@/components/system/player-detail-body` and is placed by the template as a system
 * module, so one layout describes every Player profile page: an administrator can put an announcement above
 * every Season at once, or restyle the frame, without touching a single Season's data.
 *
 * `generateMetadata` stays here because Next only reads it from a route file.
 */
export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { cueverse } = await params
  const handle = decodeURIComponent(cueverse)
  return pageMetadata({
    title: handle,
    description: `Public 8 Ball Registry profile for ${handle} — Rating, rank, and competitive record.`,
    path: `/players/${encodeURIComponent(cueverse)}`,
    index: false,
  })
}

export default async function Page({ params, searchParams }: {
  params: Promise<{ cueverse: string }>
  searchParams: Promise<{ platform?: string }>
}) {
  return (
    <BuilderPage
      pageKey="player"
      pageTitle="Player profile"
      routeParams={params as Promise<Record<string, string>>}
      searchParams={searchParams as Promise<Record<string, string | string[] | undefined>>}
      entityId={undefined}
    />
  )
}
