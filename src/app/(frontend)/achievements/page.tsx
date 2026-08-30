import type { Metadata } from 'next'
import { BuilderPage } from '@/components/site-builder/edit-mode'

/**
 * `/achievements` -- a builder-managed route.
 *
 * The body lives in `@/components/system/achievements-body` and is placed by the published layout as a system
 * module, so an administrator can position content around it, restyle it and move it while the
 * surface itself stays the real component reading the real services.
 *
 * If the published layout is ever unreadable, `getPublishedLayout` falls back a revision at a time
 * and finally to the code-defined layout, which still places this body. The page cannot be edited
 * into nothing.
 */
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Achievements',
  description: 'Every award in the 8 Ball Registry, computed from the archive.',
  alternates: { canonical: '/achievements' },
}

export default async function Page({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  return <BuilderPage pageKey="/achievements" pageTitle="Achievements" searchParams={searchParams} />
}
