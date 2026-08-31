/**
 * Turning plain body copy into text and links, without ever handling HTML.
 *
 * ── Why this returns segments rather than markup ────────────────────────────────────────────────
 * The obvious implementation writes `<a href="…">` into a string and hands it to
 * `dangerouslySetInnerHTML`. That is also how a body-copy field becomes an XSS hole: the field is
 * editable in the builder, and anything that renders it as HTML renders whatever was typed into it.
 *
 * So no HTML is produced anywhere in this file. It returns a list of SEGMENTS — runs of text and
 * runs that happen to be links — and the component turns those into React elements. Text becomes a
 * text child, which React escapes; a link's href is a validated string on a real `<a>`. There is no
 * point in the pipeline where author-supplied characters are parsed as markup, so `<script>` typed
 * into the field is displayed as the five characters it is.
 *
 * ── What counts as a link ───────────────────────────────────────────────────────────────────────
 * A complete http:// or https:// URL, and nothing else. No bare `example.com`, no `www.`, no
 * mailto:. Guessing at incomplete text produces links the author did not ask for and cannot see the
 * boundaries of; a scheme is an unambiguous statement of intent. Every candidate is then parsed
 * with the URL constructor and re-checked, so `javascript:` smuggled through a lookalike string
 * cannot become an href.
 */

export type Segment =
  | { kind: 'text'; value: string }
  | { kind: 'link'; href: string; label: string }

/*
  Candidates: a scheme, then everything up to whitespace or a character that cannot be in a URL.

  Deliberately greedy and then trimmed, rather than clever. A precise URL grammar in a regex is
  famously unreadable and still wrong at the edges; matching broadly and validating with the URL
  parser afterwards puts the decision in the one place that actually knows.
*/
const CANDIDATE = /https?:\/\/[^\s<>"'`]+/gi

/** Punctuation that ends a sentence rather than a URL. */
const TRAILING = new Set(['.', ',', ';', ':', '!', '?', '"', "'"])
const CLOSERS: Record<string, string> = { ')': '(', ']': '[', '}': '{' }

/**
 * Trim punctuation that belongs to the sentence, not the address.
 *
 * "See https://example.com." ends with a full stop that is not part of the link, and a closing
 * bracket in "(see https://example.com)" closes the aside rather than the URL — unless the URL
 * opened one itself, which is common enough in wiki-style paths to be worth counting.
 */
function trimTrailing(raw: string): string {
  let end = raw.length
  for (;;) {
    const ch = raw[end - 1]
    if (!ch) break
    if (TRAILING.has(ch)) { end -= 1; continue }
    const opener = CLOSERS[ch]
    if (opener) {
      const slice = raw.slice(0, end)
      const opens = slice.split(opener).length - 1
      const closes = slice.split(ch).length - 1
      if (closes > opens) { end -= 1; continue }
    }
    break
  }
  return raw.slice(0, end)
}

/**
 * Whether a candidate is a URL this will link, and its normalised form.
 *
 * The scheme is re-checked AFTER parsing rather than trusted from the match. `https:/\/evil` and
 * other lookalikes are what the regex sees; what the browser will follow is what the URL parser
 * says, so that is what gets checked.
 */
export function safeHttpUrl(raw: string): string | null {
  let parsed: URL
  try { parsed = new URL(raw) } catch { return null }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
  if (!parsed.hostname) return null
  return parsed.toString()
}

/**
 * Split body copy into text and links.
 *
 * Every character of the input appears in exactly one segment, in order, so line breaks and the
 * spacing around a link survive untouched — the caller renders whitespace, this does not consume it.
 */
export function linkify(text: string): Segment[] {
  if (!text) return []
  const out: Segment[] = []
  let cursor = 0

  CANDIDATE.lastIndex = 0
  for (let m = CANDIDATE.exec(text); m; m = CANDIDATE.exec(text)) {
    const matched = m[0]
    const trimmed = trimTrailing(matched)
    const href = safeHttpUrl(trimmed)

    // Not a URL after all: leave it in the text and carry on from the end of the match, so a
    // rejected candidate cannot be re-scanned into an overlapping one.
    if (!href || trimmed.length === 0) continue

    if (m.index > cursor) out.push({ kind: 'text', value: text.slice(cursor, m.index) })
    out.push({ kind: 'link', href, label: trimmed })
    cursor = m.index + trimmed.length
    CANDIDATE.lastIndex = cursor
  }

  if (cursor < text.length) out.push({ kind: 'text', value: text.slice(cursor) })
  return out
}

/** Whether body copy contains anything this would linkify. Cheap enough to call while typing. */
export function hasLink(text: string): boolean {
  return linkify(text).some((s) => s.kind === 'link')
}
