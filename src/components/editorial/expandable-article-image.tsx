'use client'

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Maximize2, Minus, Plus, RotateCcw, X } from 'lucide-react'

import { cn } from '@/lib/utils'
import {
  FIT_INDEX, FOCUSABLE_SELECTOR, ZOOM_STEPS, isCloseKey, lockScroll,
  nextFocusTarget, nextZoomIndex, shouldCloseOnBackdrop,
} from './lightbox-behavior'

/**
 * An article image: a contained preview that opens the original in a lightbox.
 *
 * The preview never crops. Archive material on this site is often a tall portrait graphic, and a
 * cover-cropped thumbnail of one is useless — it shows a slice of sky. So the preview is
 * `object-contain` inside a bounded charcoal box: the whole image is visible at a readable size, and
 * the box, not the image, decides the layout.
 *
 * Opening shows the ORIGINAL file rather than the preview element, so an animated GIF keeps animating
 * and a large archival scan is legible. It is a dialog rather than a new tab: sending a reader to a
 * raw media URL loses the page they were reading, and the browser's own image view has no controls,
 * no theme and no way back.
 */

export interface ExpandableArticleImageProps {
  src: string
  alt: string
  caption?: string | null
  /** Bounds the preview box. The image is contained inside it, never cropped to fill it. */
  previewClassName?: string
  className?: string
  /** Rendered under the preview; the media column uses it for a caption line. */
  showCaption?: boolean
}

export function ExpandableArticleImage({
  src, alt, caption, previewClassName, className, showCaption = true,
}: ExpandableArticleImageProps) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)

  return (
    <figure className={cn('not-prose', className)}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        // The alt text alone would read as "image of X" with no hint that this does anything.
        aria-label={alt ? `Enlarge image: ${alt}` : 'Enlarge image'}
        className={cn(
          'group relative block w-full overflow-hidden rounded-lg border border-border',
          'bg-[color-mix(in_srgb,var(--card)_82%,black)]',
          'transition-colors hover:border-brand/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60',
        )}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- Payload media, not a static asset */}
        <img
          src={src}
          alt={alt}
          loading="lazy"
          decoding="async"
          className={cn('mx-auto block h-auto w-full object-contain', previewClassName)}
        />

        {/* Restrained affordance: a small gold corner badge that fills in on hover, not a bar across
            the image. Decorative only — the button already carries the accessible label. */}
        <span
          aria-hidden
          className={cn(
            'pointer-events-none absolute bottom-2 right-2 inline-flex items-center gap-1 rounded-md',
            'border border-[var(--gold)]/40 bg-black/65 px-1.5 py-1 text-[0.7rem] font-medium',
            'text-[var(--gold)] opacity-80 backdrop-blur-sm transition-opacity group-hover:opacity-100',
          )}
        >
          <Maximize2 className="size-3" />
          <span className="hidden sm:inline">Click to enlarge</span>
        </span>
      </button>

      {showCaption && caption && (
        <figcaption className="mt-2 text-xs leading-relaxed text-muted-foreground">{caption}</figcaption>
      )}

      {open && (
        <Lightbox
          src={src}
          alt={alt}
          caption={caption}
          onClose={() => {
            setOpen(false)
            // Focus goes back to the image that opened it, so keyboard position is not lost.
            triggerRef.current?.focus()
          }}
        />
      )}
    </figure>
  )
}

function Lightbox({ src, alt, caption, onClose }: {
  src: string
  alt: string
  caption?: string | null
  onClose: () => void
}) {
  const titleId = useId()
  const dialogRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const [zoomIndex, setZoomIndex] = useState<number>(FIT_INDEX)
  const zoom = ZOOM_STEPS[zoomIndex]

  /**
   * Lock background scrolling.
   *
   * The scrollbar's width is added back as padding, because simply setting `overflow: hidden` removes
   * the scrollbar and the page behind visibly jumps sideways by its width as the dialog opens.
   * Both values are restored exactly, so a page that had its own inline padding keeps it.
   */
  useEffect(
    () => lockScroll(document.body, window.innerWidth - document.documentElement.clientWidth),
    [],
  )

  // Move focus into the dialog on open.
  useEffect(() => { closeRef.current?.focus() }, [])

  /** Escape closes; Tab is confined to the dialog. */
  const onKeyDown = useCallback((event: React.KeyboardEvent) => {
    if (isCloseKey(event.key)) {
      event.stopPropagation()
      onClose()
      return
    }
    if (event.key !== 'Tab') return

    const elements = Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) ?? [],
    )
    const target = nextFocusTarget({
      elements,
      active: document.activeElement as HTMLElement | null,
      shiftKey: event.shiftKey,
    })

    // Null means the browser's own Tab handling is correct here.
    if (target) {
      event.preventDefault()
      target.focus()
    }
  }, [onClose])

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={alt ? `Image: ${alt}` : 'Expanded image'}
      aria-labelledby={caption ? titleId : undefined}
      onKeyDown={onKeyDown}
      // The backdrop closes, but only when the backdrop ITSELF is the target. Without this check a
      // click that starts on the image and drifts would close the dialog underneath the reader.
      onClick={(e) => { if (shouldCloseOnBackdrop(e.target, e.currentTarget)) onClose() }}
      className="fixed inset-0 z-[100] overflow-auto bg-black/92 backdrop-blur-sm"
    >
      {/* Controls sit above the image and stop their own clicks reaching the backdrop. */}
      <div
        className="sticky top-0 z-10 flex items-center justify-end gap-1 border-b border-white/10 bg-black/70 px-3 py-2 backdrop-blur"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="mr-auto pl-1 text-xs tabular text-white/60">{Math.round(zoom * 100)}%</span>

        <LightboxButton
          label="Zoom out"
          disabled={zoomIndex === FIT_INDEX}
          onClick={() => setZoomIndex((i) => nextZoomIndex(i, -1))}
        >
          <Minus className="size-4" />
        </LightboxButton>
        <LightboxButton
          label="Zoom in"
          disabled={zoomIndex === ZOOM_STEPS.length - 1}
          onClick={() => setZoomIndex((i) => nextZoomIndex(i, 1))}
        >
          <Plus className="size-4" />
        </LightboxButton>
        <LightboxButton label="Reset to fit" disabled={zoomIndex === FIT_INDEX} onClick={() => setZoomIndex(FIT_INDEX)}>
          <RotateCcw className="size-4" />
        </LightboxButton>
        <LightboxButton label="Close image" onClick={onClose} ref={closeRef}>
          <X className="size-4" />
        </LightboxButton>
      </div>

      <div className="flex min-h-[calc(100%-3rem)] w-full items-start justify-center p-4">
        {/*
          At fit (zoom 1) the image is bounded so the whole of it is visible. Zoomed in it is allowed
          to exceed the viewport and the dialog scrolls — which is what makes a tall archival scan
          readable rather than shrunk to nothing.

          The original file is used at every zoom level, so a GIF keeps animating.
        */}
        {/* eslint-disable-next-line @next/next/no-img-element -- Payload media, not a static asset */}
        <img
          src={src}
          alt={alt}
          onClick={(e) => e.stopPropagation()}
          className={cn(
            'h-auto rounded-md',
            zoomIndex === FIT_INDEX ? 'max-h-[calc(100vh-6rem)] w-auto max-w-full object-contain' : 'max-w-none',
          )}
          style={zoomIndex === FIT_INDEX ? undefined : { width: `${zoom * 100}%` }}
        />
      </div>

      {caption && (
        <p
          id={titleId}
          onClick={(e) => e.stopPropagation()}
          className="mx-auto max-w-3xl px-4 pb-6 text-center text-sm text-white/70"
        >
          {caption}
        </p>
      )}
    </div>
  )
}

const LightboxButton = function LightboxButton({
  label, onClick, disabled, children, ref,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  children: React.ReactNode
  ref?: React.Ref<HTMLButtonElement>
}) {
  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={cn(
        'rounded-md border border-white/15 p-1.5 text-white/85 transition-colors',
        'hover:border-[var(--gold)]/50 hover:text-[var(--gold)]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]/70',
        'disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:border-white/15 disabled:hover:text-white/85',
      )}
    >
      {children}
    </button>
  )
}
