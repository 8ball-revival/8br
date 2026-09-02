'use client'

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { cn } from '@/lib/utils'

/**
 * A player's picture, or the monogram they had before they uploaded one.
 *
 * ── The crop is presentation ────────────────────────────────────────────────────────────────────
 * The stored file is never cropped. `object-fit: cover` with an `object-position` and a scale does
 * the framing at display time, which is the only way an animated GIF or WebP can be framed at all:
 * cropping it server-side would decode it to a first frame and throw the animation away.
 *
 * ── Reduced motion ──────────────────────────────────────────────────────────────────────────────
 * There is no CSS that pauses an animated GIF. So when the visitor has asked for reduced motion, the
 * first frame is drawn once to a canvas and shown instead of the image — a still, from the same
 * file, with nothing moving. The animated file is not even requested in that case.
 */

/*
  The preference, read as an external store rather than mirrored into state.

  A media query IS an external source that changes on its own, which is exactly what
  `useSyncExternalStore` is for: subscribing and copying it into state with an effect causes a
  second render on every mount and gets the server snapshot wrong. The server snapshot is `false` —
  it cannot know — so the first client render agrees with the HTML and the swap happens as part of
  hydration.
*/
const MOTION_QUERY = '(prefers-reduced-motion: reduce)'

function subscribeToMotion(onChange: () => void): () => void {
  const mq = window.matchMedia(MOTION_QUERY)
  mq.addEventListener('change', onChange)
  return () => mq.removeEventListener('change', onChange)
}

function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeToMotion,
    () => window.matchMedia(MOTION_QUERY).matches,
    () => false,
  )
}

export interface AvatarFraming {
  focalX: number
  focalY: number
  /** Percentage of `cover`. 100 fills the slot; higher crops further in. */
  zoom: number
}

export function ProfileAvatar({
  name, src, framing, size = 'lg', className,
}: {
  /** Used for the monogram when there is no picture, and for the alt text when there is. */
  name: string
  src: string | null
  framing: AvatarFraming
  size?: 'sm' | 'lg' | 'xl'
  className?: string
}) {
  const reduced = usePrefersReducedMotion()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [stillReady, setStillReady] = useState(false)

  /*
    Draw the first frame.

    An <img> pointed at an animated GIF animates, full stop — there is no attribute or style that
    stops it. Drawing it to a canvas captures whatever frame has decoded, which for a freshly
    created element is the first, and that canvas is then a still image of the same picture.
  */
  useEffect(() => {
    if (!reduced || !src) return
    let cancelled = false
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      if (cancelled) return
      const canvas = canvasRef.current
      if (!canvas) return
      const side = 256
      canvas.width = side
      canvas.height = side
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      // Reproduce `object-fit: cover` by hand: scale to the larger ratio and centre on the focal point.
      const scale = Math.max(side / img.width, side / img.height) * (framing.zoom / 100)
      const w = img.width * scale
      const h = img.height * scale
      const dx = (side - w) * (framing.focalX / 100)
      const dy = (side - h) * (framing.focalY / 100)
      ctx.clearRect(0, 0, side, side)
      ctx.drawImage(img, dx, dy, w, h)
      setStillReady(true)
    }
    img.src = src
    return () => { cancelled = true }
  }, [reduced, src, framing.focalX, framing.focalY, framing.zoom])

  const box = size === 'xl'
    // The identity header's avatar: the largest thing on the page after the handle itself.
    // Steps down on a phone, where a 10rem portrait would leave the handle nowhere to go.
    ? 'size-20 text-xl sm:size-28 sm:text-3xl lg:size-40 lg:text-4xl'
    : size === 'lg'
      ? 'size-16 text-lg sm:size-20 sm:text-xl'
      : 'size-10 text-xs'

  /*
    The ring is a sibling, not a border on the picture.

    It rotates, and rotating the avatar itself would spin the player's own photograph — and would
    fight an animated GIF. Drawn behind, `aria-hidden`, and stopped entirely under reduced motion by
    the stylesheet rather than by a second code path here.
  */
  const ring = <span aria-hidden className="pf-avatar-ring" />

  if (!src) {
    return (
      <span className={cn('pf-avatar pf-avatar-slot grid place-items-center font-display font-bold', box, className)}>
        {ring}
        <span aria-hidden style={{ color: 'var(--pf-accent)' }}>{monogram(name)}</span>
      </span>
    )
  }

  return (
    <span className={cn('pf-avatar pf-avatar-slot relative block', box, className)}>
      {ring}
      {reduced ? (
        <>
          {/* The still. Until it is drawn, the monogram holds the space rather than the animation. */}
          <canvas ref={canvasRef} className="size-full" aria-label={`${name}'s avatar`} role="img" />
          {!stillReady && (
            <span aria-hidden className="absolute inset-0 grid place-items-center font-display font-bold" style={{ color: 'var(--pf-accent)' }}>
              {monogram(name)}
            </span>
          )}
        </>
      ) : (
        /*
          A plain <img>, deliberately. An animated GIF or WebP put through the image optimiser comes
          back as a single frame, which is the one thing this avatar must not do.
        */
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={`${name}'s avatar`}
          loading="lazy"
          decoding="async"
          style={{
            objectPosition: `${framing.focalX}% ${framing.focalY}%`,
            transform: framing.zoom !== 100 ? `scale(${framing.zoom / 100})` : undefined,
          }}
        />
      )}
    </span>
  )
}

/**
 * Two letters from a name.
 *
 * "Starkiller" gives ST, matching what the profile showed before avatars existed, so a player who
 * never uploads one sees no change.
 */
export function monogram(name: string): string {
  const clean = (name ?? '').trim()
  if (!clean) return '?'
  const words = clean.split(/\s+/).filter(Boolean)
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase()
  return clean.slice(0, 2).toUpperCase()
}
