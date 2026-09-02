/**
 * How far a picture can be zoomed out, and what "the whole picture" is worth in zoom.
 *
 * ── Why zooming out needed more than a wider slider ─────────────────────────────────────────────
 * Zoom is a percentage of FILLING the frame: 100 fills it, higher crops further in. The obvious way
 * to allow less than 100 - widen the slider - does not work, and the reason is worth writing down.
 *
 * `object-fit: cover` crops the picture to the frame BEFORE any transform is applied. Scaling that
 * down does not give back what cover removed; it shrinks the crop and leaves a gap around it. The
 * parts outside the frame were never in the element to reveal.
 *
 * So below 100 the picture is fitted rather than filled - `object-fit: contain`, which keeps all of
 * it - and the zoom is expressed relative to that instead. The conversion is the ratio between the
 * two fits, which for a square frame is simply the picture's long side over its short side:
 *
 *     fill  = long / short  x  fit
 *
 * That makes 100% render exactly what `cover` rendered before, to the pixel, so no existing avatar
 * moves. And it gives the slider a meaningful floor: the zoom at which the whole picture is visible
 * is `100 x short / long` - 100% for a square, 69% for the 730x1060 one, lower the longer it gets.
 *
 * ── Why the dimensions are stored rather than measured ──────────────────────────────────────────
 * They could be read from the image once it has loaded, but the picture would then be drawn at one
 * size and jump to another a moment later. Payload records them when the file is stored, so they
 * are known before anything is rendered.
 */

/** The hard floor. Below this a picture is a speck in a large empty frame, whatever its shape. */
export const MIN_ZOOM = 20
export const MAX_ZOOM = 300

/** Filling the frame, as a multiple of fitting inside it. 1 for a square picture. */
export function fillRatio(width?: number | null, height?: number | null): number {
  if (!width || !height || width <= 0 || height <= 0) return 1
  return Math.max(width, height) / Math.min(width, height)
}

/**
 * The zoom at which the whole picture is visible.
 *
 * 100 for a square picture, which is the honest answer: a square already shows all of itself at the
 * moment it fills a square frame, so there is nothing below 100 to offer.
 */
export function fitZoom(width?: number | null, height?: number | null): number {
  return Math.max(MIN_ZOOM, Math.round(100 / fillRatio(width, height)))
}

/**
 * What to actually draw: how the picture is sized in the frame, and by how much it is scaled.
 *
 * At or above 100 this is `cover` scaled the way it always was, so the common case is unchanged and
 * costs nothing. Below it, the picture is fitted and scaled up towards filling.
 */
export function avatarFit(
  zoom: number,
  width?: number | null,
  height?: number | null,
): { objectFit: 'cover' | 'contain'; scale: number } {
  if (zoom >= 100) return { objectFit: 'cover', scale: zoom / 100 }
  return { objectFit: 'contain', scale: (zoom / 100) * fillRatio(width, height) }
}
