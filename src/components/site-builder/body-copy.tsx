/**
 * Body copy with any complete URL in it turned into a link.
 *
 * The splitting is done by `linkify`, which never produces HTML — this only turns its segments into
 * elements. Text becomes a text child (React escapes it) and a link becomes a real `<a>` with an
 * href the URL parser has already vetted, so nothing an author types can be parsed as markup.
 *
 * `white-space: pre-line` on the wrapper is what preserves the line breaks the author typed. The
 * segments carry the original whitespace verbatim; this is what stops CSS from collapsing it.
 */

import { linkify } from '@/lib/site-builder/autolink'
import { cn } from '@/lib/utils'

export function BodyCopy({ text, className }: { text: string; className?: string }) {
  const segments = linkify(text)
  if (segments.length === 0) return null

  return (
    <p className={cn('whitespace-pre-line', className)}>
      {segments.map((s, i) => (s.kind === 'text' ? (
        <span key={i}>{s.value}</span>
      ) : (
        <a
          key={i}
          href={s.href}
          /*
            External by definition — this only ever links a complete http(s) URL, which is somewhere
            else. New tab so the reader does not lose the page they were on, and the rel pair
            because `target="_blank"` otherwise hands the opened page a `window.opener` handle back
            to this one. Modern browsers imply it; it is written out because the guarantee should not
            depend on which browser the reader brought.
          */
          target="_blank"
          rel="noopener noreferrer"
          className="sb-body-link"
        >
          {s.label}
        </a>
      )))}
    </p>
  )
}
