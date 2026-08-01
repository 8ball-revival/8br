import { HistoricalNote } from '@/components/historical-note'
import { cn } from '@/lib/utils'
import { careerSummary } from '@/lib/players/legacy'
import type { PlayerPreview } from '@/lib/preview-players'

/**
 * One-to-two sentence, non-hyperbolic career summary built from structured data
 * (or the honest fallback), followed by any archive identity notes.
 */
export function LegacySnapshot({ player }: { player: PlayerPreview }) {
  const summary = careerSummary(player)
  const verified = summary !== 'No verified career summary has been added.'
  return (
    <div className="space-y-5">
      <p
        className={cn(
          'max-w-3xl font-display text-lg leading-relaxed sm:text-xl',
          verified ? 'text-foreground' : 'text-muted-foreground',
        )}
      >
        {summary}
      </p>
      {player.historicalNotes.length > 0 && (
        <div className="space-y-3">
          {player.historicalNotes.map((n, i) => (
            <HistoricalNote key={i} title="Archive note">
              {n}
            </HistoricalNote>
          ))}
        </div>
      )}
    </div>
  )
}
