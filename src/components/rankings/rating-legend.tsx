import { RATING_BANDS } from '@/lib/stats/rating-tier'

/**
 * What the Rating colours mean, said out loud.
 *
 * Permanently visible, never behind a hover, a tooltip or an information icon. The colours encode
 * four bands, a floor and a first-place override; a reader who has to discover that by pointing at
 * things never learns it, and one on a touch screen cannot point at all.
 *
 * Laid out as a single horizontal strip beside the search box, where the Competition filter used to
 * sit — so removing that control did not leave a hole, and the table still starts near the top of
 * the page. It wraps to a second line rather than scrolling, because a legend you have to scroll is
 * a legend you have to interact with.
 *
 * The swatches read the real tier tokens, so this cannot drift from the table: if a band's colour
 * changes, the legend changes with it. Colour is never the only carrier — every entry states its
 * threshold, and names its colour to a screen reader without printing a word the swatch already
 * says — so it survives monochrome, assistive technology, and anyone who cannot separate the two
 * blues.
 */
export function RatingLegend({ className = '' }: { className?: string }) {
  return (
    <div
      className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded-none border border-border bg-card/60 px-3 py-2 ${className}`}
      role="group"
      aria-label="What the rating colours mean"
    >
      {RATING_BANDS.map((b) => (
        <span key={b.id} className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs">
          <span
            aria-hidden
            className="inline-block size-2 shrink-0 rounded-[2px]"
            style={{ backgroundColor: `var(${b.token})` }}
          />
          <span className="text-muted-foreground">
            {b.label}
            {/*
              The colour NAME is carried for a screen reader but never printed.
              Writing "Gold" beside a gold square tells a sighted reader something they can already
              see, and six such words turned the strip into a paragraph. The threshold is what
              identifies the band; the name only has to exist for anyone who cannot see the swatch,
              which is exactly what sr-only is for.
            */}
            <span className="sr-only">{b.id === 'top' ? ' — ' : ' '}{b.colourName}</span>
          </span>
        </span>
      ))}
    </div>
  )
}
