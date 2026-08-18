import { safeHref } from './richtext'

/**
 * Comment formatting rules that both the server and the browser need.
 *
 * Split out of the comments service because that module is `server-only` — the composer has to know
 * the length budget to show it, and the thread has to linkify the same way the server would. Keeping
 * one copy means the counter in the textarea and the limit the server enforces cannot disagree.
 */

export const MAX_COMMENT_LENGTH = 2000
export const MIN_COMMENT_LENGTH = 2

/**
 * Split comment text into plain runs and autolinked URLs.
 *
 * Comments hold plain text, so links are found at render time rather than authored. That is the
 * whole safety property: the visible text of a link is always its own destination, and there is no
 * syntax by which somebody could label a hostile URL as something reassuring.
 */
export function linkifyComment(body: string): { text: string; href: string | null }[] {
  const out: { text: string; href: string | null }[] = []
  const pattern = /https?:\/\/[^\s<>"']+/g
  let last = 0

  for (const match of body.matchAll(pattern)) {
    const at = match.index ?? 0
    if (at > last) out.push({ text: body.slice(last, at), href: null })
    // Trailing punctuation is almost always the sentence's, not the URL's.
    const raw = match[0].replace(/[.,;:!?)\]]+$/, '')
    out.push({ text: raw, href: safeHref(raw) })
    last = at + raw.length
  }

  if (last < body.length) out.push({ text: body.slice(last), href: null })
  return out.filter((p) => p.text.length > 0)
}
