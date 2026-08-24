/**
 * What a post can be, and how big its parts may get.
 *
 * ── Why these are not in posts.ts ────────────────────────────────────────────────────────────────
 * `posts.ts` is `server-only`: it reaches Prisma, and marking it so is what stops it being pulled
 * into a browser bundle by accident. But a composer and an editor are client components, and they
 * need the type list and the title limit to draw themselves.
 *
 * Importing them from the service dragged the whole server module — Prisma, the audit writer, the
 * vote engine — into the client graph, and the page failed to compile with "you're importing a
 * module that depends on server-only". These few constants describe the SHAPE of a post rather than
 * doing anything with one, so they live here, where both sides may read them.
 */

export const MAX_TITLE = 300
export const MAX_GALLERY_ITEMS = 20
export const MAX_POLL_OPTIONS = 6
export const MIN_POLL_OPTIONS = 2

export type PostType = 'TEXT' | 'IMAGE' | 'GALLERY' | 'GIF' | 'VIDEO' | 'LINK' | 'POLL'

export const POST_TYPES: { key: PostType; label: string; hint: string }[] = [
  { key: 'TEXT', label: 'Text', hint: 'Write something.' },
  { key: 'IMAGE', label: 'Image', hint: 'One picture.' },
  { key: 'GALLERY', label: 'Gallery', hint: 'Several pictures in order.' },
  { key: 'GIF', label: 'GIF', hint: 'Upload one, paste one, or search GIPHY.' },
  { key: 'VIDEO', label: 'Video', hint: 'A clip. MP4 or WebM.' },
  { key: 'LINK', label: 'Link', hint: 'Somewhere else worth reading.' },
  { key: 'POLL', label: 'Poll', hint: 'Ask the room to choose.' },
]
