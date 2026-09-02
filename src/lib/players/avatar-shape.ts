/**
 * The shape of a player's avatar frame.
 *
 * ── Why a stored preference and not a stylesheet decision ───────────────────────────────────────
 * A circle suits a photograph of a face. It does not suit artwork with a border, a logo, or anything
 * composed as a rectangle — a circle crops the corners off and there is no framing that recovers
 * them. So this is the player's call, kept beside their colours rather than decided for everyone.
 *
 * ── One radius, read by everything ──────────────────────────────────────────────────────────────
 * The choice becomes a single custom property on the avatar's own element, and the picture, its
 * clip, the rotating ring and the halo beneath all take their corner from it. That is what keeps
 * them agreeing: a ring that stayed round behind a rounded square would look like a mistake, and
 * four separate rules that each remember to switch would eventually disagree.
 *
 * The rounded value is a PERCENTAGE, so the corner stays in proportion at every size the avatar is
 * drawn — 40px in a list, 160px in the identity header — rather than turning into a nearly-square
 * box when small and a nearly-round one when large.
 */

export const AVATAR_SHAPES = ['CIRCLE', 'ROUNDED'] as const
export type AvatarShape = (typeof AVATAR_SHAPES)[number]

export const DEFAULT_AVATAR_SHAPE: AvatarShape = 'CIRCLE'

/** What each shape means as a corner radius. */
export function avatarRadius(shape: AvatarShape): string {
  return shape === 'ROUNDED' ? '24%' : '999px'
}

/** How to say it in the editor. */
export const AVATAR_SHAPE_LABELS: Record<AvatarShape, string> = {
  CIRCLE: 'Circle',
  ROUNDED: 'Rounded square',
}

/** Anything that is not one of the two is the default, so stored rubbish cannot break a profile. */
export function asAvatarShape(value: unknown): AvatarShape {
  return AVATAR_SHAPES.includes(value as AvatarShape) ? (value as AvatarShape) : DEFAULT_AVATAR_SHAPE
}
