/**
 * The Break — article body format.
 *
 * An article body is a structured document, never a string of HTML. Authors write a small, familiar
 * Markdown subset; the server parses it into the node tree below, and the renderer turns those nodes
 * into React elements. `dangerouslySetInnerHTML` is never involved anywhere in the chain.
 *
 * That is the whole security argument, and it is a structural one rather than a filtering one: there
 * is no code path that can turn author input into markup. If somebody types `<script>alert(1)</script>`
 * it becomes a text node whose value is that sentence, and React escapes it on the way out. A
 * sanitiser that tried to strip dangerous HTML would have to be right about every case forever; this
 * has to be right once.
 *
 * `sanitizeDocument` is the second half of the guarantee. Anything read back out of the database is
 * re-validated against the node schema before it renders, so a body that somehow arrived by another
 * route — a bad import, a direct SQL write, a future bug — still cannot produce anything but these
 * nodes.
 *
 * Deliberately dependency-free and framework-free: this module is imported by server actions, by the
 * feed builders, and by the verify suites, so it must run anywhere.
 */

export type InlineNode =
  | { t: 'text'; v: string }
  | { t: 'strong'; c: InlineNode[] }
  | { t: 'em'; c: InlineNode[] }
  | { t: 'code'; v: string }
  | { t: 'link'; href: string; c: InlineNode[] }
  | { t: 'br' }

export type BlockNode =
  | { t: 'p'; c: InlineNode[] }
  | { t: 'h'; level: 2 | 3 | 4; c: InlineNode[] }
  | { t: 'ul'; items: InlineNode[][] }
  | { t: 'ol'; items: InlineNode[][] }
  | { t: 'quote'; c: InlineNode[] }
  | { t: 'code'; lang: string | null; v: string }
  | { t: 'hr' }
  | { t: 'img'; mediaId: string; alt: string; caption: string | null }

export interface RichDocument {
  v: 1
  blocks: BlockNode[]
}

export const EMPTY_DOCUMENT: RichDocument = { v: 1, blocks: [] }

/** Hard ceilings. Generous for a long feature piece, small enough that no single row can hurt us. */
export const MAX_BLOCKS = 800
export const MAX_TEXT_PER_NODE = 20_000
export const MAX_LIST_ITEMS = 200
export const MAX_BODY_CHARS = 400_000

// --------------------------------------------------------------------------- text hygiene

/**
 * Strip control characters (except tab and newline) and normalise line endings.
 *
 * Zero-width and bidirectional-override characters go too: they are invisible, and they are the
 * standard way to make a link's visible text disagree with where it actually goes.
 */
export function cleanText(input: unknown): string {
  if (typeof input !== 'string') return ''
  return input
    .replace(/\r\n?/g, '\n')
    // eslint-disable-next-line no-control-regex -- deliberately matching control characters
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, '')
    .slice(0, MAX_TEXT_PER_NODE)
}

/** Collapse a document to plain text — used for excerpts, search and reading time. */
export function documentToPlainText(doc: RichDocument): string {
  const out: string[] = []
  const inline = (nodes: InlineNode[]): string =>
    nodes
      .map((n) => {
        switch (n.t) {
          case 'text': return n.v
          case 'code': return n.v
          case 'br': return ' '
          case 'strong':
          case 'em':
          case 'link': return inline(n.c)
          default: return ''
        }
      })
      .join('')

  for (const b of doc.blocks) {
    switch (b.t) {
      case 'p':
      case 'h':
      case 'quote': out.push(inline(b.c)); break
      case 'ul':
      case 'ol': out.push(b.items.map(inline).join(' ')); break
      case 'code': out.push(b.v); break
      case 'img': out.push(b.caption ?? b.alt); break
      case 'hr': break
    }
  }
  return out.join('\n\n').replace(/[ \t]+/g, ' ').trim()
}

/** Reading time in whole minutes, never less than one. 200 words a minute is the usual figure. */
export function readingTimeMinutes(doc: RichDocument): number {
  const words = documentToPlainText(doc).split(/\s+/).filter(Boolean).length
  return Math.max(1, Math.round(words / 200))
}

/** First N characters of prose, cut on a word boundary — the fallback when no excerpt is written. */
export function deriveExcerpt(doc: RichDocument, limit = 200): string {
  const text = documentToPlainText(doc).replace(/\s+/g, ' ').trim()
  if (text.length <= limit) return text
  const cut = text.slice(0, limit)
  const lastSpace = cut.lastIndexOf(' ')
  return `${(lastSpace > limit * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`
}

// --------------------------------------------------------------------------- links

/**
 * The only hrefs allowed to survive.
 *
 * An allow-list, because the set of dangerous schemes is open-ended (`javascript:`, `data:`, `vbscript:`,
 * whatever a browser adds next) while the set of useful ones is three items long. Protocol-relative
 * `//host` URLs are rejected as well: they read like a site-relative path and are not one.
 */
export function safeHref(input: unknown): string | null {
  const raw = cleanText(input).trim()
  if (!raw) return null
  if (raw.length > 2048) return null
  if (/[\u0000-\u0020]/.test(raw)) return null

  // Site-relative. A single leading slash only.
  if (raw.startsWith('/')) return raw.startsWith('//') ? null : raw
  // In-page anchor.
  if (raw.startsWith('#')) return raw

  const scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(raw)
  if (!scheme) return null // bare "example.com" is ambiguous; make the author be explicit
  const proto = scheme[1].toLowerCase()
  if (proto !== 'http' && proto !== 'https' && proto !== 'mailto') return null
  try {
    if (proto === 'mailto') return raw
    const url = new URL(raw)
    return url.toString()
  } catch {
    return null
  }
}

/** True when a link leaves 8 Ball Registry — the renderer marks those with rel/target. */
export function isExternalHref(href: string): boolean {
  return /^https?:/i.test(href)
}

// --------------------------------------------------------------------------- inline parsing

const INLINE_PATTERN =
  /(\*\*|__)(?=\S)([\s\S]*?\S)\1|(\*|_)(?=\S)([\s\S]*?\S)\3|`([^`\n]+)`|\[([^\]\n]*)\]\(([^)\s]+)\)/

/**
 * Parse the inline span of one block.
 *
 * Recursion is bounded: emphasis may nest inside emphasis a few levels deep and then stops, so a
 * pathological input of ten thousand asterisks cannot blow the stack.
 */
function parseInline(src: string, depth = 0): InlineNode[] {
  const text = cleanText(src)
  if (!text) return []
  if (depth > 4) return [{ t: 'text', v: text }]

  const out: InlineNode[] = []
  let rest = text

  for (;;) {
    const m = INLINE_PATTERN.exec(rest)
    if (!m || m.index === undefined) break

    if (m.index > 0) pushText(out, rest.slice(0, m.index))

    if (m[2] !== undefined) {
      out.push({ t: 'strong', c: parseInline(m[2], depth + 1) })
    } else if (m[4] !== undefined) {
      out.push({ t: 'em', c: parseInline(m[4], depth + 1) })
    } else if (m[5] !== undefined) {
      out.push({ t: 'code', v: cleanText(m[5]) })
    } else {
      const href = safeHref(m[7])
      const label = m[6] || m[7]
      // An unsafe or unparseable target degrades to plain text rather than a dead or hostile link.
      if (href) out.push({ t: 'link', href, c: parseInline(label, depth + 1) })
      else pushText(out, label)
    }
    rest = rest.slice(m.index + m[0].length)
  }

  if (rest) pushText(out, rest)
  return out
}

/** Append text, splitting single newlines into explicit breaks and merging adjacent text nodes. */
function pushText(out: InlineNode[], value: string): void {
  const parts = value.split('\n')
  parts.forEach((part, i) => {
    if (i > 0) out.push({ t: 'br' })
    if (!part) return
    const last = out[out.length - 1]
    if (last && last.t === 'text') last.v = cleanText(last.v + part)
    else out.push({ t: 'text', v: part })
  })
}

// --------------------------------------------------------------------------- block parsing

const IMAGE_LINE = /^!\[([^\]]*)\]\(media:([^)\s]+)(?:\s+"([^"]*)")?\)$/

/**
 * A Payload media reference.
 *
 * The stored value is the uploaded FILENAME — that is what Payload's own file route is keyed on —
 * so dots have to survive. Everything that could climb out of that route does not: no slashes, no
 * backslashes, and no ".." anywhere in the string.
 */
export function isMediaId(value: string): boolean {
  if (!value || value.length > 128) return false
  if (value.includes('..') || value.includes('/') || value.includes('\\')) return false
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)
}

/**
 * Parse the authoring format into a document.
 *
 * A deliberately small Markdown subset — headings, lists, quotes, code, rules, images, and four
 * inline marks. Anything it does not recognise stays literal text, which is the behaviour an author
 * writing about a `**` break-and-run notation actually wants, and which means an unrecognised
 * construct can never become markup.
 */
export function parseArticleBody(source: string): RichDocument {
  const text = cleanText(String(source ?? '')).slice(0, MAX_BODY_CHARS)
  const lines = text.split('\n')
  const blocks: BlockNode[] = []

  let i = 0
  const push = (b: BlockNode) => { if (blocks.length < MAX_BLOCKS) blocks.push(b) }

  while (i < lines.length) {
    const line = lines[i]

    if (!line.trim()) { i += 1; continue }

    // Fenced code. An unterminated fence runs to the end of the document rather than failing.
    const fence = /^```([A-Za-z0-9+#-]{0,20})\s*$/.exec(line.trim())
    if (fence) {
      const lang = fence[1] ? fence[1].toLowerCase() : null
      const body: string[] = []
      i += 1
      while (i < lines.length && !/^```\s*$/.test(lines[i].trim())) { body.push(lines[i]); i += 1 }
      i += 1
      push({ t: 'code', lang, v: cleanText(body.join('\n')) })
      continue
    }

    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line.trim())) { push({ t: 'hr' }); i += 1; continue }

    const image = imageLine(line)
    if (image) {
      push({
        t: 'img',
        mediaId: image[2],
        alt: cleanText(image[1]).slice(0, 300),
        caption: image[3] ? cleanText(image[3]).slice(0, 500) : null,
      })
      i += 1
      continue
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading) {
      // The article title is the page's only H1, so author headings start at H2. A `#` is treated as
      // H2 rather than rejected: it is what an author means, and it keeps the outline valid.
      const level = Math.min(4, Math.max(2, heading[1].length)) as 2 | 3 | 4
      push({ t: 'h', level, c: parseInline(heading[2]) })
      i += 1
      continue
    }

    if (/^>\s?/.test(line)) {
      const body: string[] = []
      while (i < lines.length && /^>\s?/.test(lines[i])) { body.push(lines[i].replace(/^>\s?/, '')); i += 1 }
      push({ t: 'quote', c: parseInline(body.join('\n')) })
      continue
    }

    const bullet = /^[-*+]\s+/
    const ordered = /^\d{1,3}[.)]\s+/
    if (bullet.test(line) || ordered.test(line)) {
      const isOrdered = ordered.test(line)
      const marker = isOrdered ? ordered : bullet
      const items: InlineNode[][] = []
      while (i < lines.length && marker.test(lines[i]) && items.length < MAX_LIST_ITEMS) {
        items.push(parseInline(lines[i].replace(marker, '')))
        i += 1
      }
      push(isOrdered ? { t: 'ol', items } : { t: 'ul', items })
      continue
    }

    // Paragraph: everything up to a blank line or the start of another block.
    const para: string[] = []
    while (i < lines.length && lines[i].trim() && !startsBlock(lines[i])) { para.push(lines[i]); i += 1 }
    if (para.length) push({ t: 'p', c: parseInline(para.join('\n')) })
    else i += 1
  }

  return { v: 1, blocks }
}

function startsBlock(line: string): boolean {
  const t = line.trim()
  return (
    /^#{1,6}\s/.test(line) ||
    /^>\s?/.test(line) ||
    /^[-*+]\s+/.test(line) ||
    /^\d{1,3}[.)]\s+/.test(line) ||
    /^```/.test(t) ||
    /^(-{3,}|\*{3,}|_{3,})$/.test(t) ||
    imageLine(t) != null
  )
}

/**
 * An image line, if this line is one.
 *
 * A line that looks like an image but names an unusable media id is NOT an image line — it stays
 * ordinary text, the same as any other construct the parser does not recognise. Block detection and
 * block parsing share this function so the two can never disagree about what a line is; when they
 * did, a rejected image vanished instead of degrading to text.
 */
function imageLine(line: string): RegExpExecArray | null {
  const m = IMAGE_LINE.exec(line.trim())
  return m && isMediaId(m[2]) ? m : null
}

// --------------------------------------------------------------------------- serialising back

/** Render a document back to the authoring format, so editing an existing article round-trips. */
export function serializeArticleBody(doc: RichDocument): string {
  const inline = (nodes: InlineNode[]): string =>
    nodes
      .map((n) => {
        switch (n.t) {
          case 'text': return n.v
          case 'strong': return `**${inline(n.c)}**`
          case 'em': return `*${inline(n.c)}*`
          case 'code': return `\`${n.v}\``
          case 'link': return `[${inline(n.c)}](${n.href})`
          case 'br': return '\n'
          default: return ''
        }
      })
      .join('')

  return doc.blocks
    .map((b) => {
      switch (b.t) {
        case 'p': return inline(b.c)
        case 'h': return `${'#'.repeat(b.level)} ${inline(b.c)}`
        case 'quote': return inline(b.c).split('\n').map((l) => `> ${l}`).join('\n')
        case 'ul': return b.items.map((it) => `- ${inline(it)}`).join('\n')
        case 'ol': return b.items.map((it, n) => `${n + 1}. ${inline(it)}`).join('\n')
        case 'code': return ['```' + (b.lang ?? ''), b.v, '```'].join('\n')
        case 'hr': return '---'
        case 'img': return `![${b.alt}](media:${b.mediaId}${b.caption ? ` "${b.caption}"` : ''})`
        default: return ''
      }
    })
    .join('\n\n')
}

// --------------------------------------------------------------------------- validation

/**
 * Re-validate a document read from storage.
 *
 * Everything unrecognised is dropped rather than repaired: a node this function does not understand
 * has no business rendering, and silently keeping it "just in case" is how an escape hatch appears.
 * Always returns a usable document, so a damaged row degrades to a short article instead of a 500.
 */
export function sanitizeDocument(input: unknown): RichDocument {
  const raw = input as { blocks?: unknown } | null
  const list = raw && Array.isArray(raw.blocks) ? raw.blocks : Array.isArray(input) ? (input as unknown[]) : []
  const blocks: BlockNode[] = []

  for (const item of list.slice(0, MAX_BLOCKS)) {
    const node = sanitizeBlock(item)
    if (node) blocks.push(node)
  }
  return { v: 1, blocks }
}

function sanitizeBlock(input: unknown): BlockNode | null {
  if (!input || typeof input !== 'object') return null
  const n = input as Record<string, unknown>

  switch (n.t) {
    case 'p': {
      const c = sanitizeInlineList(n.c)
      return c.length ? { t: 'p', c } : null
    }
    case 'h': {
      const level = n.level === 3 ? 3 : n.level === 4 ? 4 : 2
      const c = sanitizeInlineList(n.c)
      return c.length ? { t: 'h', level, c } : null
    }
    case 'quote': {
      const c = sanitizeInlineList(n.c)
      return c.length ? { t: 'quote', c } : null
    }
    case 'ul':
    case 'ol': {
      const src = Array.isArray(n.items) ? n.items : []
      // Called with an explicit single argument: `.map(sanitizeInlineList)` would pass the item
      // index as `depth` and silently drop everything past the sixth item.
      const items = src.slice(0, MAX_LIST_ITEMS)
        .map((it) => sanitizeInlineList(it))
        .filter((it) => it.length > 0)
      return items.length ? { t: n.t as 'ul' | 'ol', items } : null
    }
    case 'code': {
      const v = cleanText(n.v)
      const lang = typeof n.lang === 'string' && /^[a-z0-9+#-]{1,20}$/i.test(n.lang) ? n.lang.toLowerCase() : null
      return v ? { t: 'code', lang, v } : null
    }
    case 'hr':
      return { t: 'hr' }
    case 'img': {
      const mediaId = typeof n.mediaId === 'string' && isMediaId(n.mediaId) ? n.mediaId : null
      if (!mediaId) return null
      return {
        t: 'img',
        mediaId,
        alt: cleanText(n.alt).slice(0, 300),
        caption: n.caption ? cleanText(n.caption).slice(0, 500) : null,
      }
    }
    default:
      return null
  }
}

function sanitizeInlineList(input: unknown, depth = 0): InlineNode[] {
  if (!Array.isArray(input) || depth > 5) return []
  const out: InlineNode[] = []
  for (const item of input.slice(0, 2000)) {
    const node = sanitizeInline(item, depth)
    if (node) out.push(node)
  }
  return out
}

function sanitizeInline(input: unknown, depth: number): InlineNode | null {
  if (!input || typeof input !== 'object') return null
  const n = input as Record<string, unknown>

  switch (n.t) {
    case 'text': {
      const v = cleanText(n.v)
      return v ? { t: 'text', v } : null
    }
    case 'code': {
      const v = cleanText(n.v)
      return v ? { t: 'code', v } : null
    }
    case 'br':
      return { t: 'br' }
    case 'strong':
    case 'em': {
      const c = sanitizeInlineList(n.c, depth + 1)
      return c.length ? { t: n.t as 'strong' | 'em', c } : null
    }
    case 'link': {
      const href = safeHref(n.href)
      if (!href) {
        // Keep the words, drop the destination.
        const c = sanitizeInlineList(n.c, depth + 1)
        const text = c.length ? inlineToText(c) : ''
        return text ? { t: 'text', v: text } : null
      }
      const c = sanitizeInlineList(n.c, depth + 1)
      return { t: 'link', href, c: c.length ? c : [{ t: 'text', v: href }] }
    }
    default:
      return null
  }
}

function inlineToText(nodes: InlineNode[]): string {
  return nodes
    .map((n) => (n.t === 'text' || n.t === 'code' ? n.v : n.t === 'br' ? ' ' : 'c' in n ? inlineToText(n.c) : ''))
    .join('')
}

/** Convenience: parse authoring text and validate the result in one step. */
export function buildDocument(source: string): RichDocument {
  return sanitizeDocument(parseArticleBody(source))
}

/** True when a document has no renderable content. */
export function isEmptyDocument(doc: RichDocument): boolean {
  return documentToPlainText(doc).trim().length === 0 && !doc.blocks.some((b) => b.t === 'img')
}

/** Media ids referenced by a body — used to keep an article's images from being orphaned. */
export function referencedMediaIds(doc: RichDocument): string[] {
  return Array.from(new Set(doc.blocks.filter((b): b is Extract<BlockNode, { t: 'img' }> => b.t === 'img').map((b) => b.mediaId)))
}
