import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { Container } from '@/components/ui/container'
import { SectionHeader } from '@/components/section-header'
import { CreateSeasonForm } from '@/components/seasons/create-season-form'
import { resolveStaffAccess } from '@/lib/competition/staff-auth'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'Create Season', robots: { index: false } }

export default async function NewSeasonPage() {
  const access = await resolveStaffAccess()
  if (access.status !== 'ok' || !access.actor.can('manage_competitions')) notFound()

  const last = await prisma.season.findFirst({ orderBy: { number: 'desc' }, select: { number: true } })
  const nextNumber = (last?.number ?? 0) + 1
  const year = new Date().getFullYear()

  return (
    <Container className="py-10">
      <SectionHeader eyebrow="Premier Competition" title="Create Season" description="Set up a new WCC Season Championship. Groups, qualifiers and the playoff bracket type are decided later in the Season lifecycle." />
      <CreateSeasonForm nextNumber={nextNumber} year={year} />
    </Container>
  )
}
