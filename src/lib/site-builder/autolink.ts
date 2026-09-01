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
/*
  A link that carries its own words: [The official 8BRCAM website](https://8brcam.ai.studio/)

  Bare-URL autolinking can only ever produce a link whose text IS the address, which is fine for a
  reference and poor for a sentence - "The official 8BRCAM website" reads better than the URL, and
  the URL then has to be visible for it to be clickable at all.

  Markdown's syntax rather than an invented one: an author who has typed a link anywhere else on the
  internet already knows it, and it costs nothing to support the shape they will try first.

  Deliberately narrow. The label is plain text and stays plain text - `[` and `]` inside it are not
  parsed, no nesting, no emphasis, no images. This is a link, not a markup language: everything the
  label contains is rendered as characters, so it cannot become markup any more than a bare URL can.
*/
const LABELLED = /\[([^\]\n]+)\]\((\S+?)\)/g

export function linkify(text: string): Segment[] {
  if (!text) return []
  const out: Segment[] = []
  let cursor = 0

  /*
    Labelled links are taken first, and the bare-URL pass then runs over the gaps between them.

    Order matters: the URL inside `](...)` is a bare URL too, so scanning for those first would
    linkify the address and leave the brackets as literal text around it.
  */
  const claimed: { start: number; end: number; href: string; label: string }[] = []
  LABELLED.lastIndex = 0
  for (let m = LABELLED.exec(text); m; m = LABELLED.exec(text)) {
    const href = safeHttpUrl(m[2].trim())
    const label = m[1].trim()
    // An unusable address leaves the whole thing as the text the author typed, rather than
    // rendering a link that goes nowhere or dropping their words silently.
    if (!href || !label) continue
    claimed.push({ start: m.index, end: m.index + m[0].length, href, label })
  }

  if (claimed.length > 0) {
    let at = 0
    for (const c of claimed) {
      if (c.start > at) out.push(...linkifyBare(text.slice(at, c.start)))
      out.push({ kind: 'link', href: c.href, label: c.label })
      at = c.end
    }
    if (at < text.length) out.push(...linkifyBare(text.slice(at)))
    return out
  }

  return linkifyBare(text)
}

/** Bare http(s) URLs, linked with the address as their own text. */
function linkifyBare(text: string): Segment[] {
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
