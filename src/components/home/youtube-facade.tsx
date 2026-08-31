'use client'

import { useState } from 'react'

import { youtubeEmbedUrl, youtubeThumbnails, youtubeWatchUrl } from '@/lib/media/youtube'
import { cn } from '@/lib/utils'

/**
 * A YouTube player that is not a YouTube player until somebody presses Play.
 *
 * ── Why a facade rather than an iframe ──────────────────────────────────────────────────────────
 * An embedded player on the front page costs every visitor several hundred kilobytes of somebody
 * else's JavaScript, a handful of connections, and a set of cookies — before they have shown any
 * interest in watching anything. Until the button is pressed this is one image and one button: no
 * iframe exists in the document, so there is nothing for YouTube to run or record.
 *
 * The iframe is created only on activation, and only then does `autoplay=1` appear — the video
 * starts because it was asked for, which is the one circumstance in which autoplay is not rude. It
 * starts muted regardless; the player's unmute control is right there for anybody who wants sound.
 *
 * ── A supplied poster, or YouTube's ─────────────────────────────────────────────────────────────
 * `poster` is a repository asset chosen for the composition. When it is absent the component falls
 * back to YouTube's own thumbnail chain, which is what it did before any art existed. That fallback
 * has to walk a list rather than trust one URL: `maxresdefault.jpg` exists only for videos uploaded
 * above a certain resolution, and when it does not YouTube serves a 120x90 grey placeholder with a
 * 200 — so `onError` never fires and the poster is silently a smudge. A suspiciously small natural
 * width is therefore treated as a miss, which is the only way to catch it.
 *
 * ── When playback will not start ────────────────────────────────────────────────────────────────
 * A browser may refuse autoplay, or refuse third-party frames entirely. Neither is recoverable from
 * here and neither is worth a spinner: a refused autoplay leaves YouTube's own play button in a
 * loaded player, and a refused frame leaves an empty box. The permanent escape link in the corner
 * covers both, which is why it is rendered in every state rather than only in the poster state.
 */
export function YoutubeFacade({
  videoId,
  playLabel,
  title,
  poster,
  posterAlt,
  posterFocal,
  scoreboard,
  fill = false,
  className,
}: {
  videoId: string
  /** Read aloud instead of "play": "Play Kevin's 58.7-second record run". */
  playLabel: string
  /** The accessible name of the region, and the iframe's title once it exists. */
  title: string
  /** A supplied still. Empty falls back to YouTube's own thumbnail. */
  poster?: string
  posterAlt?: string
  posterFocal?: string
  /** The branded strip across the top. Empty draws nothing. */
  scoreboard?: string
  /** Fill the height it is given from `lg` up, instead of holding 16:9 and letterboxing. */
  fill?: boolean
  className?: string
}) {
  const fallbacks = youtubeThumbnails(videoId)
  const [posterIndex, setPosterIndex] = useState(0)
  const [playing, setPlaying] = useState(false)

  const supplied = poster?.trim() ? poster.trim() : null
  const src = supplied ?? fallbacks[posterIndex]

  return (
    <div
      className={cn(
        /*
          16:9 by default, and the caller may let it fill instead.

          Stacked — on a phone, or anywhere this is the whole width — the ratio is what keeps the
          frame the shape of the video. Beside a column of text it FILLS that column's height
          instead, because a fixed ratio there leaves black bars above and below the picture while
          the panel beside it is taller. The poster is `object-cover`, so filling crops rather than
          distorts.
        */
        // This frame holds a photograph, so it grounds on the scrim rather than on a page
        // surface -- everything drawn over it is on-media text, which is light whatever the theme.
        'relative w-full overflow-hidden bg-[var(--scrim-tint)]',
        fill ? 'aspect-video lg:aspect-auto lg:h-full' : 'aspect-video',
        className,
      )}
    >
      {playing ? (
        /*
          Once it is playing the frame is 16:9, whatever shape the box around it is.

          The POSTER may crop to fill the column — a still frame loses nothing by being cropped, and
          filling is what keeps the panel from having a hole in it. The VIDEO may not: cropping it
          would cut the table off, and stretching it is worse. So the iframe holds the ratio and is
          centred in the space, which puts the panel's own dark ground above and below it rather than
          YouTube's black bars. The outer box does not change size, so nothing moves when it starts.

          Nothing of the poster survives this branch — it is not hidden behind the player, it is not
          rendered at all.
        */
        <span className="absolute inset-0 flex items-center justify-center">
          <iframe
            // Created on activation, never before. See the note above.
            src={youtubeEmbedUrl(videoId, { autoplay: true })}
            title={title}
            className="aspect-video max-h-full w-full"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            referrerPolicy="strict-origin-when-cross-origin"
            allowFullScreen
          />
        </span>
      ) : (
        <>
          {src && (
            // A plain <img>, not next/image: the supplied poster is already an optimised WebP at
            // the size this frame needs, and the YouTube fallback is a third-party file that
            // changes when the uploader changes it — routing either through the optimiser would
            // spend a round trip to produce what is already on disk, or cache a stale frame.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={src}
              alt={supplied ? (posterAlt ?? '') : ''}
              aria-hidden={supplied && posterAlt ? undefined : true}
              width={1600}
              height={900}
              decoding="async"
              className="absolute inset-0 size-full object-cover"
              style={{ objectPosition: posterFocal ?? '50% 50%' }}
              onError={() => { if (!supplied) setPosterIndex((i) => Math.min(i + 1, fallbacks.length - 1)) }}
              onLoad={(e) => {
                /*
                  The grey-placeholder check, for YouTube's chain only.

                  A missing maxres poster comes back as a real 120x90 image with a 200, so the error
                  handler never runs. Anything that small is the placeholder, so step down. A
                  supplied asset is never second-guessed this way.
                */
                if (supplied) return
                const img = e.currentTarget
                if (img.naturalWidth > 0 && img.naturalWidth <= danglingPlaceholderWidth) {
                  setPosterIndex((i) => Math.min(i + 1, fallbacks.length - 1))
                }
              }}
            />
          )}

          {/* A wash, so the white strip and the red button hold their contrast over any frame. */}
          <span aria-hidden className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/70 via-black/15 to-black/45" />

          {scoreboard && <Scoreboard text={scoreboard} />}

          {/*
            The whole frame is the button.

            A small target over a large picture is a target people miss, and on a phone the picture
            IS the affordance. `aria-label` carries the whole sentence because the visible control is
            a triangle, and a triangle is not a label.
          */}
          <button
            type="button"
            onClick={() => setPlaying(true)}
            aria-label={playLabel}
            className={cn(
              'group absolute inset-0 flex cursor-pointer items-center justify-center',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--ring)]',
            )}
          >
            <span
              className={cn(
                /*
                  The red here is YouTube's, and it is deliberately NOT a token.

                  It is the mark of the service the video is hosted on, and a reader recognises it
                  before they read anything. Recolouring it to match a theme would be claiming
                  somebody else's affordance for this site. An intentional exception, recorded in
                  docs/theme-tokens.md alongside the WCC and 8BRCAM palettes.
                */
                'flex h-12 w-[4.6rem] items-center justify-center rounded-[0.7rem] bg-[#ff0033] text-white',
                'shadow-[0_6px_24px_color-mix(in_oklab,var(--shadow-color)_55%,transparent)]',
                'transition-transform duration-150 group-hover:scale-105 group-hover:bg-[#ff1a47]',
                /*
                  Reduced motion removes the transform, not the feedback: the colour change stays,
                  so a reader who has asked for less movement still sees the control respond.
                */
                'motion-reduce:transition-none motion-reduce:group-hover:scale-100',
                'sm:h-[3.6rem] sm:w-[5.6rem]',
              )}
            >
              {/* The triangle, drawn rather than iconised, so it keeps YouTube's proportions. */}
              <svg aria-hidden viewBox="0 0 24 24" className="ml-0.5 size-7 sm:size-8" focusable="false">
                <path d="M8 5.5 L18 12 L8 18.5 Z" fill="currentColor" />
              </svg>
            </span>
          </button>
        </>
      )}

      {/*
        The way out, in every state.

        A browser or extension that refuses third-party frames shows an empty box and no explanation,
        and a browser that refuses autoplay shows a player that has not started. This link covers
        both. It sits in the corner rather than under the video because the video is the dominant
        element of this panel and nothing should push it around.
      */}
      <a
        href={youtubeWatchUrl(videoId)}
        target="_blank"
        rel="noopener noreferrer"
        className={cn(
          /*
            This sits over a PHOTOGRAPH, so it is treated as text on media rather than as text on a
            surface. A light theme must not make it dark: what is behind it is still a photograph,
            and the theme has no idea what colour that photograph is.
          */
          'absolute bottom-2 right-2 z-10 border px-2 py-1',
          'border-[color-mix(in_oklab,var(--text-on-media)_25%,transparent)]',
          'bg-[color-mix(in_oklab,var(--scrim-tint)_72%,transparent)]',
          'font-condensed text-[0.62rem] font-bold uppercase tracking-wider text-[var(--text-on-media)] backdrop-blur-sm transition',
          'hover:border-[color-mix(in_oklab,var(--text-on-media)_60%,transparent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]',
        )}
      >
        Watch on YouTube
      </a>
    </div>
  )
}

/**
 * The branded strip across the top of the poster.
 *
 * Drawn here rather than baked into the photograph, so it stays sharp at every width, follows the
 * theme, and can be edited. The X marks either side are the scoring notation from a paper
 * scoresheet — decoration, and hidden from screen readers along with the rest of the strip, because
 * the record it decorates is stated properly in the panel beside it.
 */
function Scoreboard({ text }: { text: string }) {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-x-0 top-0 flex items-center gap-3 border-b border-[color-mix(in_oklab,var(--accent-on-media)_45%,transparent)] bg-[color-mix(in_oklab,var(--scrim-tint)_78%,transparent)] px-3 py-1.5 backdrop-blur-[2px]"
    >
      <Marks />
      <span className="min-w-0 flex-1 truncate text-center font-condensed text-[0.62rem] font-bold uppercase tracking-[0.3em] text-[var(--text-on-media)] sm:text-[0.7rem]">
        {text}
      </span>
      <Marks />
    </div>
  )
}

function Marks() {
  return (
    <span className="flex shrink-0 items-center gap-1 text-[var(--accent-on-media)]">
      {[0, 1, 2].map((i) => (
        <svg key={i} viewBox="0 0 10 10" className="size-2" focusable="false">
          <path d="M1 1 L9 9 M9 1 L1 9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      ))}
    </span>
  )
}

/** Anything this narrow is YouTube's grey "no maxres" placeholder rather than a real frame. */
const danglingPlaceholderWidth = 121
