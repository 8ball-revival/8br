import type { Metadata } from 'next'

import { pageMetadata } from '@/lib/site'
import { Container } from '@/components/ui/container'
import { PageHeader } from '@/components/page-header'
import { SectionHeader } from '@/components/section-header'
import { TitleLeaders } from '@/components/title-leaders'
import { Badge } from '@/components/ui/badge'

export const metadata: Metadata = pageMetadata({
  title: 'Rankings',
  description: 'Historical title leaders and rankings from the CueVerse archive.',
  path: '/rankings',
})

export default function RankingsPage() {
  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Home', href: '/' }, { label: 'Rankings' }]}
        title="Rankings"
        description="Official 8 Ball Revival rankings are pending. In the meantime, historical title leaders from the 8BRCAM archive are shown for reference."
        actions={<Badge variant="muted">8 Ball Revival rankings pending</Badge>}
      />
      <Container className="py-12">
        <div className="mb-6 flex flex-wrap items-center gap-3 rounded-lg border border-dashed border-border bg-card/40 px-4 py-3 text-sm text-muted-foreground">
          <Badge variant="muted">Pending</Badge>
          Official 8 Ball Revival rankings pending — the ranking system (points, rating, recency,
          participation) is not yet defined. The table below is a historical archive record, not a
          current competitive ranking.
        </div>

        <SectionHeader
          eyebrow="8BRCAM archive"
          title="Historical Title Leaders"
          description="All-time championship counts from the archive. Preview · pending verification."
          sample
        />
        <TitleLeaders />
      </Container>
    </>
  )
}
