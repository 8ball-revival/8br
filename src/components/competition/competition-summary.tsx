import { Card } from '@/components/ui/card'
import { StatusBadge } from '@/components/status-badge'
import { ConfidenceBadge } from '@/components/confidence-badge'
import type { CompetitionPreview } from '@/lib/preview-competitions'

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="eyebrow text-muted-foreground">{label}</dt>
      <dd className="mt-1.5 text-sm font-medium">{children}</dd>
    </div>
  )
}

const pending = (t: string) => <span className="font-normal text-muted-foreground">{t}</span>

/** Key-facts grid for a competition, with honest pending states. */
export function CompetitionSummary({ competition }: { competition: CompetitionPreview }) {
  const c = competition
  return (
    <Card className="p-6">
      <dl className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3 lg:grid-cols-4">
        <Fact label="Type">{c.type}</Fact>
        <Fact label="Status">
          <StatusBadge status={c.status} />
        </Fact>
        <Fact label="Dates">
          {c.dateLabel
            ? c.datesPending
              ? `${c.dateLabel} (exact dates pending)`
              : c.dateLabel
            : pending('Dates pending verification')}
        </Fact>
        <Fact label="Organizer">{c.organizer}</Fact>
        <Fact label="Format">{c.formatSummary ?? pending('Format pending verification')}</Fact>
        <Fact label="Participants">
          {c.participantsCount && c.participantsCount > 0
            ? c.participantsCount
            : pending('Participant list incomplete')}
        </Fact>
        <Fact label="Champion">
          {c.champion ? (
            <span>
              {c.champion.name}
              {c.champion.inferred && <span className="text-muted-foreground"> (inferred)</span>}
            </span>
          ) : (
            pending('Champion pending verification')
          )}
        </Fact>
        <Fact label="Record confidence">
          <ConfidenceBadge level={c.confidence} />
        </Fact>
      </dl>
    </Card>
  )
}
