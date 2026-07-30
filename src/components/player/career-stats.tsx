import { StatCard } from '@/components/stat-card'
import { EmptyState } from '@/components/ui/empty-state'
import { BarChart3 } from 'lucide-react'
import type { PreviewCareer } from '@/lib/preview-players'
import { formatPct } from '@/lib/format'

const dash = (v: number | null | undefined) => (v == null ? '—' : String(v))

/** Career aggregate stat tiles (from archive career stats). */
export function CareerStats({ career }: { career: PreviewCareer | null }) {
  if (!career) {
    return (
      <EmptyState
        icon={BarChart3}
        title="Career statistics pending verification"
        description="Career totals will appear here once imported and verified."
      />
    )
  }

  const tiles = [
    { label: 'Matches', value: dash(career.totalMatches) },
    { label: 'Wins', value: dash(career.totalWins) },
    { label: 'Losses', value: dash(career.totalLosses) },
    {
      label: 'Win rate',
      value: career.totalWinPct != null ? formatPct(career.totalWinPct / 100) : '—',
    },
    { label: 'Championships', value: dash(career.championships) },
    { label: 'Runner-ups', value: dash(career.runnerUps) },
    { label: 'Finals', value: dash(career.finals) },
    { label: 'Semifinals', value: dash(career.semifinals) },
    { label: 'Playoff appearances', value: dash(career.playoffAppearances) },
    { label: 'Longest title streak', value: dash(career.longestTitleStreak) },
    { label: 'Longest playoff run', value: dash(career.longestPlayoffRun) },
    { label: 'Seasons played', value: dash(career.seasonsPlayed) },
  ]

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
      {tiles.map((t) => (
        <StatCard key={t.label} stat={t} />
      ))}
    </div>
  )
}
