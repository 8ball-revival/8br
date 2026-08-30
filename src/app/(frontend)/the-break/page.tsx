import type { Metadata } from 'next'
import { pageMetadata } from '@/lib/site'
import { BuilderPage } from '@/components/site-builder/edit-mode'

/**
 * `/the-break` -- a builder-managed route.
 *
 * The body lives in `@/components/system/the-break-body` and is placed by the published layout as a system
 * module, so an administrator can position content around it, restyle it and move it while the
 * surface itself stays the real component reading the real services.
 *
 * If the published layout is ever unreadable, `getPublishedLayout` falls back a revision at a time
 * and finally to the code-defined layout, which still places this body. The page cannot be edited
 * into nothing.
 */
export const dynamic = 'force-dynamic'

export const metadata: Metadata = pageMetadata({
  title: 'The Break',
  description: 'News, predictions, history, memes and community discussion.',
  path: '/the-break',
})

export default async function Page({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  return <BuilderPage pageKey="/the-break" pageTitle="The Break" searchParams={searchParams} />
}
