import type { Metadata } from 'next'
import { pageMetadata } from '@/lib/site'
import { BuilderPage } from '@/components/site-builder/edit-mode'

/**
 * `/tournaments` -- a builder-managed route.
 *
 * The body lives in `@/components/system/tournaments-body` and is placed by the published layout as a system
 * module, so an administrator can position content around it, restyle it and move it while the
 * surface itself stays the real component reading the real services.
 *
 * If the published layout is ever unreadable, `getPublishedLayout` falls back a revision at a time
 * and finally to the code-defined layout, which still places this body. The page cannot be edited
 * into nothing.
 */
export const dynamic = 'force-dynamic'

export const revalidate = 0

export const metadata: Metadata = pageMetadata({
  title: 'Tournaments',
  description: '8BR tournaments — bracket and group-stage events. Browse live and completed tournaments.',
  path: '/tournaments',
})

export default async function Page({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  return <BuilderPage pageKey="/tournaments" pageTitle="Tournaments listing" searchParams={searchParams} />
}
