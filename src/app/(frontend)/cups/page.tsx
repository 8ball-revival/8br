import type { Metadata } from 'next'
import { Suspense } from 'react'

import { Container } from '@/components/ui/container'
import { SectionHeader } from '@/components/section-header'
import { AdminBar } from '@/components/staff/admin-bar'
import { CupList } from '@/components/cups/cup-list'
import { CreateCupWizard } from '@/components/cups/create-cup-wizard'
import { getCupList } from '@/lib/cups/list'
import { resolveStaffAccess } from '@/lib/competition/staff-auth'

export const metadata: Metadata = {
  title: 'Cups',
  description: 'Variety competitions — prize tournaments, doubles, and special formats, separate from league Seasons.',
  alternates: { canonical: '/cups' },
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
