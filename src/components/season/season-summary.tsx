import { Card } from '@/components/ui/card'
import { StatusBadge } from '@/components/status-badge'
import type { SeasonDetail } from '@/lib/mock-data'
import { formatDate } from '@/lib/format'

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="eyebrow text-muted-foreground">{label}</dt>
      <dd className="mt-1.5 text-sm font-medium">{children}</dd>
    </div>
  )
}

const pending = (text: string) => <span className="font-normal text-muted-foreground">{text}</span>

/** Key-facts summary block for a season. Uses honest pending states where unverified. */
export function SeasonSummary({ season }: { season: SeasonDetail }) {
  const dates =
    season.startDate && season.endDate
      ? `${formatDate(season.startDate)} – ${formatDate(season.endDate)}`
      : season.startDate
        ? `${formatDate(season.startDate)} – present`
        : null

  return (
    <Card className="p-6">
      <dl className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3 lg:grid-cols-4">
        <Fact label="Status">
          <StatusBadge status={season.status} />
        </Fact>
        <Fact label="Dates">{dates ?? pending('Dates pending source verification')}</Fact>
        <Fact label="Format">{season.formatSummary ?? pending('Format pending verification')}</Fact>
        <Fact label="Participants">
          {season.participants != null && season.participants > 0
            ? season.participants
            : pending('Count pending')}
        </Fact>
        <Fact label="Divisions">{season.divisions}</Fact>
        <Fact label="Current phase">{season.currentPhase}</Fact>
        <Fact label="Champion">
          {season.champion.state === 'known' && season.champion.handle
            ? season.champion.handle
            : pending('Champion pending verification')}
        </Fact>
      </dl>
    </Card>
  )
}
