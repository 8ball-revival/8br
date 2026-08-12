import type { Metadata } from 'next'
import { Suspense } from 'react'

import { Container } from '@/components/ui/container'
import { SectionHeader } from '@/components/section-header'
import { AdminBar } from '@/components/staff/admin-bar'
import { CupList } from '@/components/tournaments/tournament-list'
import { CreateCupWizard } from '@/components/tournaments/create-tournament-wizard'
import { getCupList } from '@/lib/tournaments/list'
import { resolveStaffAccess } from '@/lib/competition/staff-auth'

export const dynamic = 'force-dynamic' // auth/user-specific — must render per-request (reads headers/cookies)

export const metadata: Metadata = {
  title: 'Tournaments',
  description: 'Variety competitions — prize tournaments, doubles, and special formats, separate from league Seasons.',
  alternates: { canonical: "/tournaments" },
}

export default async function CupsPage() {
  const cups = await getCupList()
  const access = await resolveStaffAccess()
  const canManage = access.status === 'ok' && access.actor.can('manage_competitions')

  return (
    <Container className="py-10">
      <SectionHeader
        eyebrow="Competitions"
        title="Cups"
        description="Variety competitions — prize events, 2v2, and special formats — kept separate from league Seasons. Search by player, alias, team, or champion."
      />
      <AdminBar surface="cups" />
      {canManage && <CreateCupWizard />}
      <Suspense fallback={null}>
        <CupList cups={cups} />
      </Suspense>
    </Container>
  )
}
