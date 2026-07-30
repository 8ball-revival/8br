import { HistoricalNote } from '@/components/historical-note'

/** Renders archive-sourced historical/identity annotations (merges, splits, etc.). */
export function HistoricalNotes({ notes }: { notes: string[] }) {
  if (notes.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">No historical notes recorded for this identity.</p>
    )
  }
  return (
    <div className="space-y-3">
      {notes.map((n, i) => (
        <HistoricalNote key={i} title="Identity note">
          {n}
        </HistoricalNote>
      ))}
    </div>
  )
}
