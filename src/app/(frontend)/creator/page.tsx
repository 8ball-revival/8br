import type { Metadata } from 'next'

import { Wide } from '@/components/primitives'
import { requireCreator } from '@/lib/creator/access'
import { creatorCounts } from '@/lib/creator/landing'
import { CreatorColumn, CARD_ICONS, type ActionCard } from '@/components/creator/landing-cards'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Creator', robots: { index: false } }

/**
 * Creator.
 *
 * Every administrative action for a Season or Tournament begins here, because the record is
 * controlled in exactly one place. The public pages show what a competition IS; this is where it is
 * decided.
 *
 * Authorisation is re-checked here rather than left to a layout: a layout gate is a rendering gate
 * and does not run for the data this page loads.
 */
export default async function CreatorLanding() {
  await requireCreator()
  const counts = await creatorCounts()

  const seasons: ActionCard[] = [
    {
      href: '/creator/seasons/new',
      label: 'Create New Season',
      hint: 'Competition, year, number and structure',
      icon: CARD_ICONS.create,
      primary: true,
    },
    {
      href: '/creator/seasons',
      label: 'Manage Open Seasons',
      hint: 'Resume at the stage each one has reached',
      icon: CARD_ICONS.manage,
      count: counts.seasonsOpen,
    },
    {
      href: '/creator/seasons/completed',
      label: 'Modify Completed Seasons',
      hint: 'Review a finished Season, or reopen it to correct',
      icon: CARD_ICONS.modify,
      count: counts.seasonsCompleted,
    },
  ]

  const tournaments: ActionCard[] = [
    {
      href: '/creator/tournaments/new',
      label: 'Create New Tournament',
      hint: 'Single, double, groups or Swiss',
      icon: CARD_ICONS.create,
      primary: true,
    },
    {
      href: '/creator/tournaments',
      label: 'Manage Open Tournaments',
      hint: 'Resume at the stage each one has reached',
      icon: CARD_ICONS.manage,
      count: counts.tournamentsOpen,
    },
    {
      href: '/creator/tournaments/completed',
      label: 'Modify Completed Tournaments',
      hint: 'Review a finished Tournament, or reopen it to correct',
      icon: CARD_ICONS.modify,
      count: counts.tournamentsCompleted,
    },
  ]

  return (
    <Wide name="creator" className="py-6">
      <h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">Creator</h1>
      <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
        Create and run every Season and Tournament.
      </p>

      {/* Two columns where there is room for two, one honest stack where there is not. */}
      <div className="mt-6 grid gap-8 lg:grid-cols-2">
        <CreatorColumn
          heading="Seasons"
          blurb="Group stage into a playoff bracket."
          actions={seasons}
        />
        <CreatorColumn
          heading="Tournaments"
          blurb="Standalone events, individual or teams."
          actions={tournaments}
        />
      </div>
    </Wide>
  )
}
