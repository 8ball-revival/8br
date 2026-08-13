import type { Metadata } from 'next'
import { Suspense } from 'react'
import Link from 'next/link'
import { Plus } from 'lucide-react'

import { Container } from '@/components/ui/container'
import { SectionHeader } from '@/components/section-header'
import { AdminBar } from '@/components/staff/admin-bar'
import { Button } from '@/components/ui/button'
import { TournamentList } from '@/components/tournaments/tournament-list'
import { getTournamentList } from '@/lib/tournaments/list'
import { resolveStaffAccess } from '@/lib/competition/staff-auth'

export const dynamic = 'force-dynamic' // auth/user-specific — must render per-request (reads headers/cookies)

export const metadata: Metadata = {
  title: 'Tournaments',
  description: 'WCC tournaments — bracket and group-stage events. Browse live and completed tournaments.',
  alternates: { canonical: "/tournaments" },
}

export default async function TournamentsPage() {
  const cups = await getTournamentList()
  const access = await resolveStaffAccess()
  const canManage = access.status === 'ok' && access.actor.can('manage_competitions')

  return (
    <Container className="py-10">
      <SectionHeader
        eyebrow="Competitions"
        title="Tournaments"
        description="WCC tournaments — bracket and group-stage events. Search by player, alias, team, or champion."
      />
      <AdminBar surface="cups" />
      {canManage && (
        <div className="mb-6">
          <Button asChild>
            <Link href="/tournaments/new"><Plus className="size-4" /> Create tournament</Link>
          </Button>
        </div>
      )}
      <Suspense fallback={null}>
        <TournamentList cups={cups} />
      </Suspense>
    </Container>
  )
}
