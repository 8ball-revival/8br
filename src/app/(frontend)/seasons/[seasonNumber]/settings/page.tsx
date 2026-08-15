import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import Link from 'next/link'

import { Container } from '@/components/ui/container'
import { SectionHeader } from '@/components/section-header'
import { getSeasonView } from '@/lib/seasons/service'
import { SeasonSettingsForm } from '@/components/seasons/season-settings-form'
import { resolveStaffAccess } from '@/lib/competition/staff-auth'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Season Settings', robots: { index: false } }

export default async function SeasonSettingsPage({ params }: { params: Promise<{ seasonNumber: string }> }) {
  const { seasonNumber } = await params
  const view = await getSeasonView(Number(seasonNumber))
  if (!view) notFound()
  const access = await resolveStaffAccess()
  if (access.status !== 'ok' || !access.actor.can('manage_competitions')) notFound()
  const season = await prisma.season.findUnique({ where: { id: view.id }, select: { id: true } })
  if (!season) notFound()

  return (
    <Container className="py-10">
      <Link href={`/seasons/${view.number}`} className="text-sm text-muted-foreground hover:text-foreground">← {view.title}</Link>
      <SectionHeader eyebrow="Season Settings" title={view.title} description={view.subtitle ?? undefined} />
      <SeasonSettingsForm seasonId={view.id} view={view} isHeadAdmin={access.actor.isHeadAdmin} />
    </Container>
  )
}
