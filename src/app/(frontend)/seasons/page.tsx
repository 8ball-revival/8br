import type { Metadata } from 'next'
import Link from 'next/link'
import { Plus } from 'lucide-react'

import { Container } from '@/components/ui/container'
import { SectionHeader } from '@/components/section-header'
import { Button } from '@/components/ui/button'
import { SeasonsList } from '@/components/seasons/seasons-list'
import { listSeasons } from '@/lib/seasons/service'
import { resolveStaffAccess } from '@/lib/competition/staff-auth'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Seasons',
  description: 'WCC Season Championships — the premier competition. Current, upcoming, and past Season champions.',
  alternates: { canonical: '/seasons' },
}

export default async function SeasonsPage() {
  const seasons = await listSeasons()
  const access = await resolveStaffAccess()
  const canManage = access.status === 'ok' && access.actor.can('manage_competitions')

  return (
    <Container className="py-10">
      <SectionHeader
        eyebrow="Premier Competition"
        title="Season Championships"
        description="WCC's flagship competition: round-robin groups into a championship playoff bracket, crowning a Season Champion."
      />
      {canManage && (
        <div className="mb-6">
          <Button asChild>
            <Link href="/seasons/new"><Plus className="size-4" /> Create Season</Link>
          </Button>
        </div>
      )}
      <SeasonsList seasons={seasons} />
    </Container>
  )
}
