import { ShieldQuestion } from 'lucide-react'

import { Container } from '@/components/ui/container'
import { Badge } from '@/components/ui/badge'
import { Breadcrumbs } from '@/components/ui/breadcrumb'
import { StatusBadge } from '@/components/status-badge'
import { ConfidenceBadge } from '@/components/confidence-badge'
import type { CompetitionPreview } from '@/lib/preview-competitions'

/** Competition identity header: title, legacy title, type, status, confidence. */
export function CompetitionHero({ competition }: { competition: CompetitionPreview }) {
  const isArchive = competition.chronology === 'archive'
  return (
    <div className="border-b border-border bg-card/30">
      <Container className="py-10">
        <Breadcrumbs
          items={[
            { label: 'Home', href: '/' },
            { label: 'Competitions', href: '/competitions' },
            { label: competition.name },
          ]}
          className="mb-6"
        />
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <Badge variant="outline">{competition.type}</Badge>
              {isArchive && <Badge variant="muted">Historical archive</Badge>}
            </div>
            <h1 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">
              {competition.name}
            </h1>
            {competition.legacyName && (
              <p className="mt-1 text-sm text-muted-foreground">
                Archive record: {competition.legacyName}
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={competition.status} />
            <ConfidenceBadge level={competition.confidence} />
          </div>
        </div>
        {isArchive && (
          <div className="mt-4">
            <Badge variant="muted">
              <ShieldQuestion className="size-3" aria-hidden /> Archive preview · pending verification
            </Badge>
          </div>
        )}
      </Container>
    </div>
  )
}
