import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Plus } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { newestSeasonNumber, getSeasonBrowseData } from '@/lib/seasons/browse'
import { resolveStaffAccess } from '@/lib/competition/staff-auth'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Seasons',
  description: '8BR Season Championships — groups into a championship playoff bracket.',
  alternates: { canonical: '/seasons' },
}

/**
 * /seasons opens the newest Season rather than listing them.
 *
 * The Season browser IS the Seasons experience — its Competition, Year and Season pickers cover
 * everything the old card list did, and landing straight on the current Season is what a reader
 * almost always wants. The canonical per-Season URLs are untouched, so every existing link still
 * resolves; this page simply chooses which one to open.
 *
 * "Newest" is Competition Year descending, then Season number descending — the same rule the
 * pickers use, so the landing page and the controls can never disagree.
 */
export default async function SeasonsPage({
  searchParams,
}: {
  searchParams: Promise<{ competition?: string; view?: string }>
}) {
  const sp = await searchParams
  const competition = sp.competition ?? null

  const newest = await newestSeasonNumber(competition)
  if (newest != null) {
    const qs = new URLSearchParams()
    if (competition) qs.set('competition', competition)
    qs.set('view', sp.view === 'playoffs' ? 'playoffs' : 'groups')
    redirect(`/seasons/${newest}?${qs.toString()}`)
  }

  // Nothing to open — a brand-new registry, or a Competition filter that matches no Season.
  const { competitions } = await getSeasonBrowseData(null)
  const access = await resolveStaffAccess()
  const canManage = access.status === 'ok' && access.actor.can('manage_competitions')

  return (
    <div className="mx-auto w-full max-w-[120rem] px-4 py-16 sm:px-6">
      <div className="mx-auto flex max-w-lg flex-col items-center gap-3 text-center">
        <h1 className="font-display text-2xl font-bold text-foreground">No Seasons Yet</h1>
        <p className="text-sm text-muted-foreground">
          {competition && competitions.length > 0
            ? 'That Competition has no Seasons yet. Seasons appear here as soon as one is created.'
            : 'Seasons appear here as soon as one is created.'}
        </p>
        {canManage && (
          <Button asChild className="mt-2">
            <Link href="/seasons/new"><Plus className="size-4" /> Create Season</Link>
          </Button>
        )}
      </div>
    </div>
  )
}
