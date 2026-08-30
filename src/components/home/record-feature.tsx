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
}: {
  /** "TABLE CLEAR" — rendered in cyan. */
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
}) {
  return (
    <section
      aria-labelledby="record-feature-heading"
      className={cn(
        'dl-surface cyber-clip relative overflow-hidden border border-[var(--line-strong)] bg-[var(--void)]',
        // The two halves. Below `lg` they stack, numbers first, which is the reading order that
        // makes sense on a phone: the record, then the proof.
        'grid gap-0 lg:grid-cols-[minmax(0,44fr)_minmax(0,56fr)]',
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
            'repeating-linear-gradient(0deg, rgba(0,229,255,0.10) 0 1px, transparent 1px 3px),'
            + 'linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px),'
            + 'linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)',
          backgroundSize: '100% 3px, 44px 44px, 44px 44px',
        }}
      />

      {/* Angular corner details, matching the marquee above. */}
      <span aria-hidden className="pointer-events-none absolute left-0 top-0 z-10 size-4 border-l-2 border-t-2 border-[var(--neon-cyan)]" />
      <span aria-hidden className="pointer-events-none absolute bottom-0 right-0 z-10 size-4 border-b-2 border-r-2 border-[var(--hot-red)]" />

      <div className="relative z-[1] flex min-w-0 flex-col justify-center gap-1 p-5 sm:p-6 lg:p-7">
        <p className="eyebrow text-[var(--neon-cyan)]">
          {eyebrowLead}{' '}
          <span className="text-[var(--hot-red)]">{eyebrowTrail}</span>
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
        <p
          className="font-display font-black leading-[0.86] tracking-tight text-[var(--clean-white)] [font-variant-numeric:tabular-nums]"
          style={{ fontSize: 'clamp(3.25rem, 8vw, 6.5rem)' }}
        >
          {time}
        </p>
        <p
          className="font-display font-black uppercase leading-none tracking-tight text-[var(--clean-white)]"
          style={{ fontSize: 'clamp(1.35rem, 3vw, 2.4rem)' }}
        >
          {unit}
        </p>

        <p className="mt-3 font-display text-sm font-bold uppercase tracking-[0.14em] text-[var(--hot-red)] sm:text-base">
          {status}
        </p>

        {description && (
          <p className="mt-3 max-w-sm text-sm leading-relaxed text-[var(--clean-white)]/70">{description}</p>
        )}

        {holder && (
          <div className="mt-5">
            <p className="eyebrow text-[var(--neon-cyan)]">{holderLabel}</p>
            <div className="mt-1 min-w-0">
              {holder.href ? (
                <Link
                  href={holder.href}
                  className="block truncate font-display text-xl font-bold text-[var(--clean-white)] underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] sm:text-2xl"
                  title={holder.primary}
                >
                  {holder.primary}
                </Link>
              ) : (
                <p className="truncate font-display text-xl font-bold text-[var(--clean-white)] sm:text-2xl" title={holder.primary}>
                  {holder.primary}
                </p>
              )}
              {holder.secondary && (
                <p className="truncate text-sm text-[var(--clean-white)]/60" title={holder.secondary}>
                  {holder.secondary}
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="relative z-[1] min-w-0 self-stretch">
        {videoId ? (
          <YoutubeFacade
            videoId={videoId}
            playLabel={playLabel}
            title={`${eyebrowLead} ${eyebrowTrail} — ${time} ${unit}`}
            fill
            className="h-full"
          />
        ) : (
          /*
            No video configured. The panel still says what the record is rather than collapsing:
            the number is the point and it does not depend on the footage existing.
          */
          <div className="flex aspect-video w-full items-center justify-center border-l border-[var(--line-strong)] bg-black/60 p-6 text-center">
            <p className="text-sm text-[var(--clean-white)]/55">
              No video is set for this record yet.
            </p>
          </div>
        )}
      </div>
    </section>
  )
}
