import { MatchBox } from '@/components/cups/bracket'
import { cn } from '@/lib/utils'
import type { BracketRound } from '@/lib/cups/service'

/**
 * Responsive playoff bracket for the season dashboard. Round columns flex to fill
 * the available width (see `.bkt-*` in globals.css), so on normal desktops the whole
 * bracket is visible without horizontal scrolling; cards shrink toward a readable
 * min before scroll is used as a last resort. Subtle gold elbow connectors are drawn
 * only between rounds that halve cleanly (standard single-elim), so they never imply
 * a wrong progression in irregular rounds (byes, double-elim drop-downs).
 */
export function SeasonBracket({ rounds, currentRound }: { rounds: BracketRound[]; currentRound?: string }) {
  if (rounds.length === 0) {
    return <p className="text-sm text-muted-foreground">No playoff bracket recorded.</p>
  }
  return (
    <div className="scrollbar-gold overflow-x-auto pb-2">
      <div className="bkt-tree">
        {rounds.map((round, i) => {
          const active = currentRound && round.name.toLowerCase() === currentRound.toLowerCase()
          const feeds = i < rounds.length - 1 && round.matches.length === 2 * rounds[i + 1].matches.length
          const receives = i > 0 && rounds[i - 1].matches.length === 2 * round.matches.length
          return (
            <div key={i} className="bkt-round">
              <p className={cn('eyebrow mb-3 text-center', active ? 'text-gold' : 'text-muted-foreground')}>
                {round.name}
              </p>
              <div className={cn('bkt-body', feeds && 'bkt-feeds', receives && 'bkt-receives')}>
                {round.matches.map((m, mi) => (
                  <div key={mi} className="bkt-cell">
                    <MatchBox match={m} />
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
