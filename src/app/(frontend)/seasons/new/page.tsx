import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { Container } from '@/components/ui/container'
import { SectionHeader } from '@/components/section-header'
import { CreateSeasonForm } from '@/components/seasons/create-season-form'
import { listActiveCompetitions } from '@/lib/competitions/service'
import { resolveStaffAccess } from '@/lib/competition/staff-auth'
import { suggestSeasonNumber } from '@/lib/seasons/numbering'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'Create Season', robots: { index: false } }

export default async function NewSeasonPage() {
  const access = await resolveStaffAccess()
  if (access.status !== 'ok' || !access.actor.can('manage_competitions')) notFound()

  const year = new Date().getFullYear()
  const competitions = await listActiveCompetitions()
  // The opening suggestion is scoped to the Competition the form will preselect and the current
  // year — not a global sequence. The form re-asks whenever either changes.
  const preselected = competitions.length === 1 ? competitions[0].id : null
  const nextNumber = preselected == null ? 1 : await suggestSeasonNumber(preselected, year)

  return (
    <Container className="py-10">
      <SectionHeader eyebrow="Premier Competition" title="Create Season" description="Set up a new 8BR Season Championship. Groups, qualifiers and the playoff bracket type are decided later in the Season lifecycle." />
      <CreateSeasonForm nextNumber={nextNumber} year={year} competitions={competitions} />
    </Container>
  )
}
