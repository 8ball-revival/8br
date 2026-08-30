import type { Metadata } from 'next'
import { pageMetadata } from '@/lib/site'
import { BuilderPage } from '@/components/site-builder/edit-mode'

/**
 * `/rankings` -- a builder-managed route.
 *
 * The body lives in `@/components/system/rankings-body` and is placed by the published layout as a system
 * module, so an administrator can position content around it, restyle it and move it while the
 * surface itself stays the real component reading the real services.
 *
 * If the published layout is ever unreadable, `getPublishedLayout` falls back a revision at a time
 * and finally to the code-defined layout, which still places this body. The page cannot be edited
 * into nothing.
 */
export const dynamic = 'force-dynamic' // rankings reflect the latest completed competitions

export const metadata: Metadata = pageMetadata({
  title: 'Rankings',
  description: 'The 8 Ball Registry rankings — a standard Elo rating over every completed competition match, with full career records, championships and head-to-head.',
  path: '/rankings',
})

export default async function Page({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  return <BuilderPage pageKey="/rankings" pageTitle="Rankings" searchParams={searchParams} />
}
