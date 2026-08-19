import { RATING_BANDS } from '@/lib/stats/rating-tier'

/**
 * What the Rating colours mean, said out loud.
 *
 * Permanently visible, never behind a hover, a tooltip or an information icon. The colours encode
 * six bands and a first-place override; a reader who has to discover that by pointing at things is
 * a reader who never learns it, and one on a touch screen cannot hover at all.
 *
 * It sits where the Competition filter used to, so removing that control did not simply leave a
 * hole in the toolbar.
 *
 * The swatches use the real tier tokens, so the legend cannot drift from the table — if a band's
 * colour changes, this changes with it. They are small squares rather than sample numbers: seven
 * bold neon figures in a corner would compete with the column they are explaining.
 *
 * Colour is never the only carrier. Every row states its threshold in text, so the legend reads
 * correctly in monochrome, to a screen reader, and to anyone who cannot distinguish the two blues.
 */
export function RatingLegend({ className = '' }: { className?: string }) {
  return (
    <div
      className={`rounded-md border border-border bg-card/60 px-2.5 py-1.5 ${className}`}
      role="group"
      aria-label="What the rating colours mean"
    >
      <ul className="grid grid-cols-2 gap-x-3 gap-y-0.5 sm:grid-cols-1">
        {RATING_BANDS.map((b) => (
          <li key={b.id} className="flex items-center gap-1.5 whitespace-nowrap text-[0.68rem] leading-tight">
            <span
              aria-hidden
              className="inline-block size-2 shrink-0 rounded-[2px]"
              style={{ backgroundColor: `var(${b.token})` }}
            />
            <span className="text-muted-foreground">
              {b.label} <span className="text-foreground/70">— {b.colourName}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
