import type { Metadata } from 'next'
import Link from 'next/link'
import { CalendarClock } from 'lucide-react'

import { Container } from '@/components/ui/container'
import { PageHeader } from '@/components/page-header'
import { pageMetadata } from '@/lib/site'
import { SectionHeader } from '@/components/section-header'
import { EmptyState } from '@/components/ui/empty-state'
import { Button } from '@/components/ui/button'
import { CompetitionCard } from '@/components/competition-card'
import { getArchiveCompetitionIndex } from '@/lib/preview-competitions'

export const metadata: Metadata = pageMetadata({
  title: 'Competitions',
  description: 'Browse the archive of CueVerse competitions preserved in the 8 Ball Revival records.',
  path: '/competitions',
})

export default function CompetitionsPage() {
  const archive = getArchiveCompetitionIndex()

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Home', href: '/' }, { label: 'Competitions' }]}
        title="Competitions"
        description="Seasons, cups, and tournaments — one shared model, many formats. 8 Ball Revival competitions are listed separately from preserved historical archive competitions."
      />
      <Container className="py-12">
        {/* 8 Ball Revival competitions — the new chronology (none with data yet). */}
        <SectionHeader
          eyebrow="8 Ball Revival chronology"
          title="8 Ball Revival competitions"
          description="Native 8 Ball Revival competitions will appear here as the new chronology begins."
        />
        <EmptyState
          icon={CalendarClock}
          title="8 Ball Revival competitions coming soon"
          description="8 Ball Revival Season 1 opens the new public chronology. It is currently pending source verification."
          action={
            <Button asChild variant="secondary">
              <Link href="/seasons/ego-season-1">View 8 Ball Revival Season 1</Link>
            </Button>
          }
        />

        {/* Historical archive competitions — 8BRCAM, NOT part of the 8 Ball Revival chronology. */}
        <div className="mt-14">
          <SectionHeader
            eyebrow="8BRCAM"
            title="Historical archive competitions"
            description="Preserved competitions from the 8BRCAM archive. Preview · pending verification — these are historical records and are not 8 Ball Revival chronology seasons."
          />
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {archive.map((c) => (
              <CompetitionCard key={c.slug} competition={c} />
            ))}
          </div>
        </div>
      </Container>
    </>
  )
}
