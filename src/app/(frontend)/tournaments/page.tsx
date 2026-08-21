import type { Metadata } from 'next'
import { Suspense } from 'react'
import Link from 'next/link'
import { Plus } from 'lucide-react'

import { Wide } from '@/components/primitives'
import { SectionHeader } from '@/components/section-header'
import { Button } from '@/components/ui/button'
import { TournamentList } from '@/components/tournaments/tournament-list'
import { getTournamentList } from '@/lib/tournaments/list'
import { resolveStaffAccess } from '@/lib/competition/staff-auth'
import { pageMetadata } from '@/lib/site'

/*
 * A running Tournament has to leave the Active section the moment it completes, not when a cache
 * happens to expire, and the Create control depends on who is asking — so this renders per request.
 */
export const dynamic = 'force-dynamic'
export const revalidate = 0

export const metadata: Metadata = pageMetadata({
  title: 'Tournaments',
  description: '8BR tournaments — bracket and group-stage events. Browse live and completed tournaments.',
  path: '/tournaments',
})

/**
 * Tournaments — one page for every Tournament, running or finished.
 *
 * ── Why the list component rather than the archive browser ───────────────────────────────────────
 * This page briefly became a generic archive browser during the Cups rename, which cost it the two
 * things that make it worth visiting: a search that reaches PEOPLE — champion, runner-up, entrant,
 * alias, team member — and the administrator's way in. `TournamentList` does both, splits Active &
 * Upcoming from Archive, and keeps its filters in the URL so a filtered view can be linked.
 *
 * Creating a Tournament starts HERE rather than in Creator. Creator owns Seasons and their
 * historical reconstruction; sending an administrator somewhere else to make the thing this page is
 * about was a detour with nothing at the end of it.
 */
export default async function TournamentsPage() {
  const [tournaments, access] = await Promise.all([getTournamentList(), resolveStaffAccess()])
  // Drawn only for the capability that actually governs the action. Every route and every mutation
  // behind this button re-checks for itself — a hidden button is not an authorisation check.
  const canManage = access.status === 'ok' && access.actor.can('manage_competitions')

  return (
    <Wide name="tournaments" className="py-10">
      <SectionHeader
        eyebrow="Competitions"
        title="Tournaments"
        description="8BR tournaments — bracket and group-stage events. Search by player, alias, team, or champion."
      />
      {canManage && (
        <div className="mb-6">
          <Button asChild>
            <Link href="/tournaments/new"><Plus className="size-4" /> Create Tournament</Link>
          </Button>
        </div>
      )}
      <Suspense fallback={null}>
        <TournamentList cups={tournaments} />
      </Suspense>
    </Wide>
  )
}
