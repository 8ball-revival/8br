'use client'

import { useState } from 'react'
import { Play } from 'lucide-react'

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
 * ── Why the thumbnail falls back rather than erroring ───────────────────────────────────────────
 * `maxresdefault.jpg` exists only for videos uploaded above a certain resolution. When it does not,
 * YouTube serves a 120×90 grey placeholder with a 200 — so an `onError` handler never fires and the
 * poster is silently a grey smudge. This walks the list on error AND treats a suspiciously small
 * natural size as a miss, which is the only way to catch the placeholder.
 */
export function YoutubeFacade({
  videoId,
  playLabel,
  title,
  fill = false,
  className,
}: {
  videoId: string
  /** Read aloud instead of "play": "Play Kevin's 58.7-second record run". */
  playLabel: string
  /** The accessible name of the region, and the iframe's title once it exists. */
  title: string
  /** Fill the height it is given from `lg` up, instead of holding 16:9 and letterboxing. */
  fill?: boolean
  className?: string
}) {
  const posters = youtubeThumbnails(videoId)
  const [posterIndex, setPosterIndex] = useState(0)
  const [playing, setPlaying] = useState(false)

  const poster = posters[posterIndex]

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
        'relative w-full overflow-hidden bg-black',
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
          {poster && (
            // A plain <img>, not next/image: this is a third-party poster that changes when the
            // uploader changes it, and routing it through the optimiser would cache a stale frame
            // and put our server in the middle of a request that does not need us.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={poster}
              alt=""
              aria-hidden
              loading="lazy"
              decoding="async"
              className="absolute inset-0 size-full object-cover"
              onError={() => setPosterIndex((i) => Math.min(i + 1, posters.length - 1))}
              onLoad={(e) => {
                /*
                  The grey-placeholder check.

                  A missing maxres poster comes back as a real 120×90 image with a 200, so the error
                  handler never runs. Anything that small is the placeholder, so step down.
                */
                const img = e.currentTarget
                if (img.naturalWidth > 0 && img.naturalWidth <= danglingPlaceholderWidth) {
                  setPosterIndex((i) => Math.min(i + 1, posters.length - 1))
                }
              }}
            />
          )}

          {/* A wash, so white text and the red button hold their contrast over any frame. */}
          <span aria-hidden className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-black/40" />

          <button
            type="button"
            onClick={() => setPlaying(true)}
            aria-label={playLabel}
            className="group absolute inset-0 flex items-center justify-center focus-visible:outline-none"
          >
            <span
              className={cn(
                'flex size-16 items-center justify-center rounded-xl bg-[#ff0033] text-white shadow-[0_6px_24px_rgba(0,0,0,0.55)] transition',
                'group-hover:scale-105 group-hover:bg-[#ff1a47]',
                'group-focus-visible:ring-4 group-focus-visible:ring-[var(--ring)] group-focus-visible:ring-offset-2 group-focus-visible:ring-offset-black',
                'sm:size-20',
              )}
            >
              <Play className="ml-1 size-7 fill-current sm:size-9" aria-hidden />
            </span>
          </button>
        </>
      )}

      {/*
        The way out.

        A browser or extension that refuses third-party frames shows an empty box and no explanation,
        so there is always a direct link. It sits in the corner rather than under the video because
        the video is the dominant element of this panel and nothing should push it around.
      */}
      <a
        href={youtubeWatchUrl(videoId)}
        target="_blank"
        rel="noopener noreferrer"
        className={cn(
          'absolute bottom-2 right-2 z-10 border border-white/25 bg-black/65 px-2 py-1 text-[0.6rem] font-bold uppercase tracking-wider text-white/85 backdrop-blur-sm transition',
          'hover:border-white/60 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]',
        )}
      >
        Watch on YouTube
      </a>
    </div>
  )
}

/** Anything this narrow is YouTube's grey "no maxres" placeholder rather than a real frame. */
const danglingPlaceholderWidth = 121
