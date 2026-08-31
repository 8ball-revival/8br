import Link from 'next/link'

import { YoutubeFacade } from './youtube-facade'
import type { RecordHolder } from '@/lib/home/record-holder'
import { cn } from '@/lib/utils'

/**
 * The Table Clear Challenge record.
 *
 * ── What this panel is ──────────────────────────────────────────────────────────────────────────
 * One number and one video. The time is the largest thing on the homepage after the marquee, because
 * the whole point of a record is the figure — everything else on the panel is a caption for it.
 *
 * ── Why the video is the dominant half ──────────────────────────────────────────────────────────
 * A claimed record with no footage is a claim. The run is the evidence, so it takes the space, and
 * the numbers sit beside it rather than above it. The player does not load until somebody asks for
 * it — see `YoutubeFacade`.
 *
 * ── Identity ────────────────────────────────────────────────────────────────────────────────────
 * The holder is rendered the way players are rendered everywhere else on this site: the CueVerse ID
 * leads and the display name follows beneath it. When the panel names a real player the lines come
 * from that Player row, so a CueVerse ID change reaches this panel like it reaches everything else.
 */
export function RecordFeature({
  eyebrowLead,
  eyebrowTrail,
  time,
  unit,
  status,
  holderLabel,
  holder,
  description,
  videoId,
  playLabel,
  poster,
  posterAlt,
  posterFocal,
  scoreboard,
}: {
  /** "TABLE CLEAR" — steel, so the red lands on the second half alone. */
  eyebrowLead: string
  /** "CHALLENGE" — rendered in red, so the eyebrow carries both accents as the design intends. */
  eyebrowTrail: string
  time: string
  unit: string
  status: string
  holderLabel: string
  holder: RecordHolder | null
  description?: string
  videoId: string | null
  playLabel: string
  /** A supplied still for the video region. Empty falls back to YouTube's own thumbnail. */
  poster?: string
  posterAlt?: string
  posterFocal?: string
  /** The branded strip across the top of the poster. Empty draws nothing. */
  scoreboard?: string
}) {
  return (
    <section
      aria-labelledby="record-feature-heading"
      className={cn(
        // The video half of this panel carries a photograph, and the strip over it is on-media
        // text — so the panel grounds itself on the scrim tint for the same reason the hero does.
        'dl-surface cyber-clip relative overflow-hidden border border-[var(--line-strong)] bg-[var(--scrim-tint)]',
        /*
          Fills the row rather than sitting at its own height.

          The three columns of this row are different lengths -- the reading column carries a news
          panel and three plaques -- and a panel that stopped at its content left a third of a
          screen of empty page beneath it. `h-full` with the video set to fill means the frame grows
          into the space instead, which is also what keeps the three columns ending on one line.
        */
        'h-full',
        /*
          The two halves. Below `lg` they stack, numbers first, which is the reading order that
          makes sense on a phone: the record, then the proof.

          40/60 rather than an even split: the figure needs enough width not to wrap and no more,
          and everything after that belongs to the video, which is the evidence.
        */
        'grid gap-0 lg:grid-cols-[minmax(0,40fr)_minmax(0,60fr)]',
      )}
    >
      {/*
        The grid and the scanlines.

        Two stacked repeating gradients at very low opacity — a technical surface rather than a
        texture. `pointer-events-none` so nothing here can intercept the play button beneath it.
      */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.18]"
        style={{
          backgroundImage:
            'repeating-linear-gradient(0deg, color-mix(in oklab, var(--steel-dim) 26%, transparent) 0 1px, transparent 1px 3px),'
            + 'linear-gradient(color-mix(in oklab, var(--steel-dim) 14%, transparent) 1px, transparent 1px),'
            + 'linear-gradient(90deg, color-mix(in oklab, var(--steel-dim) 14%, transparent) 1px, transparent 1px)',
          backgroundSize: '100% 3px, 44px 44px, 44px 44px',
        }}
      />

      {/* Angular corner details, matching the marquee above. */}
      <span aria-hidden className="pointer-events-none absolute left-0 top-0 z-10 size-4 border-l-2 border-t-2 border-[var(--signal)]" />
      <span aria-hidden className="pointer-events-none absolute bottom-0 right-0 z-10 size-4 border-b-2 border-r-2 border-[var(--steel-dim)]" />

      <div className="relative z-[1] flex min-w-0 flex-col justify-center gap-1 p-5 sm:p-6 lg:p-7">
        <p className="font-condensed text-[0.72rem] font-semibold uppercase tracking-[0.3em] text-[var(--steel-bright)]">
          {eyebrowLead}{' '}
          <span className="text-[var(--signal)]">{eyebrowTrail}</span>
        </p>

        <h2 id="record-feature-heading" className="sr-only">
          {eyebrowLead} {eyebrowTrail} — {status}
        </h2>

        {/*
          The figure.

          `clamp` rather than breakpoints: the time has to be as large as the panel allows and must
          never wrap or clip, and the panel's width changes continuously with the column beside it.
          `tabular-nums` keeps "58.7" from shifting as digits change.
        */}
        {/*
          The figure appears HERE and nowhere else.

          An earlier draft put it over the poster as well, which is one number too many for a page
          to state twice. The poster is a photograph of a table and asserts nothing; the record is
          written once, in HTML, where it can be edited, selected, translated and read aloud.
        */}
        <p
          className="font-condensed font-extrabold leading-[0.84] tracking-[-0.01em] text-[var(--text-primary)] [font-variant-numeric:tabular-nums]"
          style={{ fontSize: 'clamp(3.5rem, 8.5vw, 7rem)' }}
        >
          {time}
        </p>
        <p
          className="font-condensed font-bold uppercase leading-none tracking-[0.02em] text-[var(--text-primary)]"
          style={{ fontSize: 'clamp(1.4rem, 3vw, 2.5rem)' }}
        >
          {unit}
        </p>

        <p className="mt-3 font-condensed text-sm font-bold uppercase tracking-[0.2em] text-[var(--signal)] sm:text-base">
          {status}
        </p>

        {description && (
          <p className="mt-3 max-w-sm text-sm leading-relaxed text-[var(--text-secondary)]">{description}</p>
        )}

        {holder && (
          <div className="mt-5 min-w-0">
            <p className="font-condensed text-[0.7rem] font-semibold uppercase tracking-[0.28em] text-[var(--steel-bright)]">
              {holderLabel}
            </p>
            {/*
              Handle and name on ONE line, divided by a slash.

              Two stacked lines made the holder look like a row from a ranking table, in a panel
              that is not a ranking. One line reads as an attribution, which is what it is. It still
              truncates and still carries the full text in `title`, so a long CueVerse ID cannot
              push the name out of the panel.
            */}
            <p className="mt-1 flex min-w-0 items-baseline gap-2 font-condensed text-xl font-bold sm:text-2xl">
              {holder.href ? (
                <Link
                  href={holder.href}
                  className="min-w-0 truncate text-[var(--text-primary)] underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                  title={holder.primary}
                >
                  {holder.primary}
                </Link>
              ) : (
                <span className="min-w-0 truncate text-[var(--text-primary)]" title={holder.primary}>
                  {holder.primary}
                </span>
              )}
              {holder.secondary && (
                <>
                  {/* --steel, not --steel-dim: this is a glyph somebody reads, not a rule. */}
                  <span aria-hidden className="shrink-0 text-[var(--steel)]">/</span>
                  <span className="min-w-0 truncate font-medium italic text-[var(--steel-bright)]" title={holder.secondary}>
                    {holder.secondary}
                  </span>
                </>
              )}
            </p>
          </div>
        )}
      </div>

      <div className="relative z-[1] min-w-0 self-stretch">
        {videoId ? (
          <YoutubeFacade
            videoId={videoId}
            playLabel={playLabel}
            title={`${eyebrowLead} ${eyebrowTrail} — ${time} ${unit}`}
            poster={poster}
            posterAlt={posterAlt}
            posterFocal={posterFocal}
            scoreboard={scoreboard}
            fill
            className="h-full"
          />
        ) : (
          /*
            No video configured. The panel still says what the record is rather than collapsing:
            the number is the point and it does not depend on the footage existing.
          */
          <div className="flex aspect-video w-full items-center justify-center border-l border-[var(--line-strong)] bg-[var(--surface-inset)] p-6 text-center">
            <p className="text-sm text-[var(--text-muted)]">
              No video is set for this record yet.
            </p>
          </div>
        )}
      </div>
    </section>
  )
}
