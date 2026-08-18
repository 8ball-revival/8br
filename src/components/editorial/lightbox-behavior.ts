/**
 * The lightbox's decisions, separated from its rendering.
 *
 * These are the rules that are easy to get subtly wrong and impossible to check by looking at JSX: what
 * counts as a backdrop click, where Tab goes at the ends of the dialog, and how the scroll lock is
 * undone. Pulling them out means they can be executed by tests rather than asserted from source, and
 * the component keeps one copy of each rule instead of re-deriving it inline.
 */

/** Zoom levels the viewer steps through. Index 0 is "fit", where the whole image is visible. */
export const ZOOM_STEPS = [1, 1.5, 2, 3, 4] as const

export function nextZoomIndex(current: number, delta: number): number {
  const last = ZOOM_STEPS.length - 1
  if (!Number.isFinite(current)) return 0
  return Math.min(last, Math.max(0, Math.round(current) + delta))
}

/** Fit is the reset state, and the state in which the image is bounded to the viewport. */
export const FIT_INDEX = 0

/**
 * Does this click close the dialog?
 *
 * Only when the backdrop element ITSELF was clicked. Comparing target to currentTarget is the whole
 * rule: a click on the image, the caption or any control has one of those as its target, bubbles up to
 * the backdrop's handler, and must not close. Without this check the dialog would shut whenever the
 * reader clicked the thing they opened it to look at.
 */
export function shouldCloseOnBackdrop(target: unknown, currentTarget: unknown): boolean {
  return target === currentTarget
}

export function isCloseKey(key: string): boolean {
  return key === 'Escape' || key === 'Esc'
}

/**
 * Where Tab should move, or null to let the browser handle it.
 *
 * Focus wraps at both ends so it cannot leave the dialog: forward from the last element goes to the
 * first, backward from the first goes to the last. Anywhere in the middle returns null, because
 * intercepting there would break normal tabbing between the controls.
 */
export function nextFocusTarget<T>({ elements, active, shiftKey }: {
  elements: readonly T[]
  active: T | null
  shiftKey: boolean
}): T | null {
  if (elements.length === 0) return null
  const first = elements[0]
  const last = elements[elements.length - 1]

  if (shiftKey && active === first) return last
  if (!shiftKey && active === last) return first
  // A dialog with a single focusable control has to wrap to itself, or Tab escapes.
  if (elements.length === 1 && active === first) return first
  return null
}

export interface ScrollLockTarget {
  style: { overflow: string; paddingRight: string }
}

/**
 * Lock background scrolling, and return the exact undo.
 *
 * `scrollbarGap` is added back as padding because hiding the overflow removes the scrollbar, and the
 * page behind would visibly jump sideways by its width as the dialog opens. The previous values are
 * captured and restored verbatim rather than reset to empty, so a page that set its own padding keeps
 * it after the dialog closes.
 */
export function lockScroll(body: ScrollLockTarget, scrollbarGap: number): () => void {
  const previousOverflow = body.style.overflow
  const previousPadding = body.style.paddingRight

  body.style.overflow = 'hidden'
  if (scrollbarGap > 0) body.style.paddingRight = `${scrollbarGap}px`

  return () => {
    body.style.overflow = previousOverflow
    body.style.paddingRight = previousPadding
  }
}

/** Selector for the controls a focus trap should cycle through. */
export const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
