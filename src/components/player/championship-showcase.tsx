import { Award, Trophy } from 'lucide-react'

import { EmptyState } from '@/components/ui/empty-state'
import { VerificationBadge } from '@/components/player/verification-badge'
import {
  championshipSeasons,
  finalsRecord,
  runnerUpSeasons,
} from '@/lib/players/legacy'
import { formatArchiveSeason, formatDivision } from '@/lib/format'
import type { PlayerPreview, PreviewChampionship } from '@/lib/preview-players'

function SummaryTile({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-card/50 p-4">
      <div className="tabular text-2xl font-bold tracking-tight">{value}</div>
      <div className="mt-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</div>
    </div>
  )
}

function ChampionCard({ c }: { c: PreviewChampionship }) {
  return (
    <div className="relative overflow-hidden rounded-xl border border-gold/30 bg-gradient-to-br from-gold/[0.10] to-transparent p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-gold">
            <Trophy className="size-4" aria-hidden />
            <span className="eyebrow">Champion</span>
          </div>
          <div className="mt-2 font-display text-2xl font-bold tracking-tight">
            {formatArchiveSeason(c.seasonId)}
          </div>
          <div className="mt-0.5 text-sm text-muted-foreground">{formatDivision(c.division)}</div>
        </div>
        <Trophy className="size-8 shrink-0 text-gold/25" aria-hidden />
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <VerificationBadge confidence={c.confidence} />
        {c.bracketReconstructed && (
          <span className="text-xs text-muted-foreground">Bracket reconstructed</span>
        )}
      </div>
    </div>
  )
}

/**
 * The visual centrepiece: championship summary, premium champion cards, and a
 * quieter "Other Finals Appearances" list. Dignified empty state when there are
 * no titles — never an oversized blank section.
 */
export function ChampionshipShowcase({ player }: { player: PlayerPreview }) {
  const champs = championshipSeasons(player.championships)
  const runners = runnerUpSeasons(player.championships)
  const record = finalsRecord(player.career)
  const divisions = [
    ...new Set([...champs, ...runners].map((c) => formatDivision(c.division))),
  ].filter(Boolean)

  if (champs.length === 0 && runners.length === 0) {
    return (
      <EmptyState
        icon={Trophy}
        title="No recorded championships"
        description="Championship and finals results will appear here once verified in the archive."
      />
    )
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryTile label="Championships" value={champs.length} />
        <SummaryTile label="Runner-up finishes" value={runners.length} />
        {record && <SummaryTile label="Finals record" value={`${record.wins}–${record.losses}`} />}
        {divisions.length > 0 && (
          <SummaryTile label={divisions.length === 1 ? 'Division' : 'Divisions'} value={divisions.join(', ')} />
        )}
      </div>

      {champs.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {champs.map((c, i) => (
            <ChampionCard key={i} c={c} />
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          No championship wins recorded — see finals appearances below.
        </p>
      )}

      {runners.length > 0 && (
        <div>
          <h3 className="eyebrow mb-3 text-muted-foreground">Other Finals Appearances</h3>
          <div className="flex flex-wrap gap-2">
            {runners.map((r, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1 text-sm"
              >
                <Award className="size-3.5 text-muted-foreground" aria-hidden />
                {formatArchiveSeason(r.seasonId)}
                <span className="text-muted-foreground">· {formatDivision(r.division)}</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
