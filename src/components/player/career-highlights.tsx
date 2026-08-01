import { Crown, Sparkles, TrendingUp } from 'lucide-react'

import { EmptyState } from '@/components/ui/empty-state'
import { prettyCategory, topRankings } from '@/lib/players/legacy'
import type { PlayerPreview } from '@/lib/preview-players'

/**
 * A visually varied set of the player's most meaningful, data-backed achievements:
 * one featured all-time standing plus a few supporting milestones. Nothing is
 * shown that the archive can't support; hero numbers aren't simply repeated.
 */
export function CareerHighlights({ player }: { player: PlayerPreview }) {
  const ranks = topRankings(player.hof)
  const featured = ranks[0] ?? null
  const c = player.career

  const milestones: { value: string; label: string }[] = []
  for (const r of ranks.slice(1, 4)) {
    if (r.rank != null) {
      milestones.push({ value: `${r.value} ${prettyCategory(r.category)}`, label: `#${r.rank} all-time` })
    }
  }
  if (milestones.length < 3 && c?.longestPlayoffRun != null) {
    milestones.push({ value: `${c.longestPlayoffRun}`, label: 'Longest playoff run' })
  }
  if (milestones.length < 3 && c?.playoffAppearances != null) {
    milestones.push({ value: `${c.playoffAppearances}`, label: 'Playoff appearances' })
  }
  if (milestones.length < 3 && c?.seasonsPlayed != null) {
    milestones.push({ value: `${c.seasonsPlayed}`, label: 'Seasons played' })
  }

  if ((!featured || featured.rank == null) && milestones.length === 0) {
    return (
      <EmptyState
        icon={Sparkles}
        title="No career highlights recorded yet"
        description="Notable achievements will appear here as the archive is verified."
      />
    )
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
      {featured && featured.rank != null && (
        <div className="relative overflow-hidden rounded-xl border border-gold/30 bg-gradient-to-br from-gold/[0.12] to-transparent p-6">
          <div className="flex items-center gap-2 text-gold">
            <Crown className="size-4" aria-hidden />
            <span className="eyebrow">Signature achievement</span>
          </div>
          <div className="mt-3 font-display text-4xl font-bold tracking-tight text-gold">
            #{featured.rank}
            <span className="ml-2 align-middle text-base font-medium text-muted-foreground">all-time</span>
          </div>
          <div className="mt-1 text-lg font-medium">
            {featured.value} {prettyCategory(featured.category)}
          </div>
        </div>
      )}
      {milestones.length > 0 && (
        <div className="grid content-start gap-3">
          {milestones.map((m, i) => (
            <div key={i} className="flex items-center gap-3 rounded-lg border border-border bg-card/50 p-4">
              <TrendingUp className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold">{m.value}</div>
                <div className="text-xs text-muted-foreground">{m.label}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
