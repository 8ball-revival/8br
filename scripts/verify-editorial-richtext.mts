/**
 * The article body format: parsing, validation, and the guarantees that make author input safe.
 *
 * The security claim being tested is structural — author input becomes typed nodes, never markup —
 * so these checks care less about "is the dangerous string gone" and more about "did it come out the
 * other side as a text node". A stripped `<script>` and a `<script>` rendered as visible words are
 * both safe; only the second is correct.
 *
 * Run:  npx tsx --tsconfig scripts/tsconfig.verify.json scripts/verify-editorial-richtext.mts
 */
import {
  parseArticleBody, sanitizeDocument, buildDocument, serializeArticleBody, safeHref, isExternalHref,
  documentToPlainText, deriveExcerpt, readingTimeMinutes, isEmptyDocument, referencedMediaIds,
  cleanText, isMediaId, MAX_BLOCKS, MAX_LIST_ITEMS, MAX_LIST_START,
  type RichDocument, type BlockNode, type InlineNode,
} from '../src/lib/editorial/richtext.ts'

let pass = 0, fail = 0
const check = (n: string, c: boolean, d = '') => {
  if (c) { pass++; console.log('  ✓ ' + n) } else { fail++; console.log('  ✗ ' + n + (d ? ` — ${d}` : '')) }
}
const section = (t: string) => console.log(`\n${t}`)

const blocks = (src: string): BlockNode[] => parseArticleBody(src).blocks
const first = (src: string): BlockNode => blocks(src)[0]
const text = (src: string): string => documentToPlainText(parseArticleBody(src))

/** Every string that appears anywhere in a document, so a test can assert nothing leaked. */
function allStrings(doc: RichDocument): string[] {
  const out: string[] = []
  const inline = (nodes: InlineNode[]) => {
    for (const n of nodes) {
      if (n.t === 'text' || n.t === 'code') out.push(n.v)
      else if (n.t === 'link') { out.push(n.href); inline(n.c) }
      else if (n.t === 'strong' || n.t === 'em') inline(n.c)
    }
  }
  for (const b of doc.blocks) {
    if (b.t === 'p' || b.t === 'h' || b.t === 'quote') inline(b.c)
    else if (b.t === 'ul' || b.t === 'ol') b.items.forEach(inline)
    else if (b.t === 'code') out.push(b.v)
    else if (b.t === 'img') { out.push(b.mediaId, b.alt); if (b.caption) out.push(b.caption) }
  }
  return out
}

// =========================================================================== blocks

section('Block parsing')

check('a plain line becomes a paragraph', first('Hello world.').t === 'p')
check('two blank-line-separated lines become two paragraphs', blocks('One.\n\nTwo.').length === 2)
check('a single newline stays inside one paragraph', blocks('One.\nTwo.').length === 1)
{
  const p = first('One.\nTwo.')
  check('...joined by an explicit break', p.t === 'p' && p.c.some((n) => n.t === 'br'))
}

{
  const h = first('## A heading')
  check('## is a level-2 heading', h.t === 'h' && h.level === 2)
}
{
  const h = first('#### Deep')
  check('#### is a level-4 heading', h.t === 'h' && h.level === 4)
}
{
  // The article title is the page's only H1, so a lone # must not produce a second one.
  const h = first('# Top')
  check('# is promoted to H2, never H1', h.t === 'h' && h.level === 2)
}
{
  const h = first('##### Too deep')
  check('##### clamps to H4 rather than being dropped', h.t === 'h' && h.level === 4)
}
check('a # with no space is not a heading', first('#nospace').t === 'p')

{
  const q = first('> Quoted line\n> and another')
  check('consecutive > lines make one quote', q.t === 'quote')
  check('quote keeps both lines', q.t === 'quote' && documentToPlainText({ v: 1, blocks: [q] }).includes('another'))
}

{
  const l = first('- one\n- two\n- three')
  check('- makes a bullet list', l.t === 'ul')
  check('...with one item per line', l.t === 'ul' && l.items.length === 3)
}
check('* also makes a bullet list', first('* one\n* two').t === 'ul')
{
  const l = first('1. one\n2. two')
  check('1. makes an ordered list', l.t === 'ol' && l.items.length === 2)
}
check('a list ends at a blank line', blocks('- one\n\nAfter.').length === 2)

{
  const c = first('```js\nconst x = 1\n```')
  check('a fence makes a code block', c.t === 'code')
  check('...keeping the language', c.t === 'code' && c.lang === 'js')
  check('...and the exact body', c.t === 'code' && c.v === 'const x = 1')
}
{
  const c = first('```\nplain\n```')
  check('a fence with no language has lang null', c.t === 'code' && c.lang === null)
}
{
  // An author who forgets the closing fence should still get their text, not an error.
  const c = first('```\nunterminated\nstill going')
  check('an unterminated fence runs to the end', c.t === 'code' && c.v.includes('still going'))
}
{
  const d = parseArticleBody('```\n## not a heading\n- not a list\n```')
  check('markup inside a fence stays literal', d.blocks.length === 1 && d.blocks[0].t === 'code')
}

check('--- is a horizontal rule', first('---').t === 'hr')
check('*** is a horizontal rule', first('***').t === 'hr')

{
  const img = first('![Break shot](media:abc123 "Frame one")')
  check('an image line becomes an image block', img.t === 'img')
  check('...with its media id', img.t === 'img' && img.mediaId === 'abc123')
  check('...alt text', img.t === 'img' && img.alt === 'Break shot')
  check('...and caption', img.t === 'img' && img.caption === 'Frame one')
}
{
  const img = first('![Alt only](media:xyz)')
  check('an image without a caption has caption null', img.t === 'img' && img.caption === null)
}
check('an http image URL is not an image block', first('![a](https://evil.test/x.png)').t === 'p')
{
  // Payload media ids are filenames, so dots must survive; anything that could climb out of the
  // media route must not.
  const img = first('![a](media:break-shot-2026.jpg)')
  check('a filename media id is accepted', img.t === 'img' && img.mediaId === 'break-shot-2026.jpg')
  check('a traversing media id is not an image', first('![a](media:../../secret.env)').t === 'p')
  check('a media id with a slash is not an image', first('![a](media:sub/dir.png)').t === 'p')
  check('isMediaId accepts a plain filename', isMediaId('photo_01.png'))
  check('isMediaId rejects traversal', !isMediaId('..%2Fx.png') && !isMediaId('../x.png'))
  check('isMediaId rejects a backslash', !isMediaId('a\b.png'))
  check('isMediaId rejects a leading dot', !isMediaId('.env'))
}

check('blank input yields no blocks', parseArticleBody('').blocks.length === 0)
check('whitespace-only input yields no blocks', parseArticleBody('   \n\n  \t ').blocks.length === 0)

// =========================================================================== inline

section('Inline parsing')

{
  const p = first('a **bold** b')
  check('** makes strong', p.t === 'p' && p.c.some((n) => n.t === 'strong'))
}
{
  const p = first('a *slanted* b')
  check('* makes emphasis', p.t === 'p' && p.c.some((n) => n.t === 'em'))
}
{
  const p = first('use `code` here')
  check('backticks make inline code', p.t === 'p' && p.c.some((n) => n.t === 'code'))
}
{
  const p = first('see [the rules](/terms) now')
  const link = p.t === 'p' ? p.c.find((n) => n.t === 'link') : undefined
  check('[]() makes a link', !!link)
  check('...with the href', link?.t === 'link' && link.href === '/terms')
  check('...and the label', link?.t === 'link' && documentToPlainText({ v: 1, blocks: [{ t: 'p', c: link.c }] }) === 'the rules')
}
check('inline code inside a sentence keeps surrounding text', text('use `code` here') === 'use code here')
check('an unmatched * stays literal', text('2 * 3 = 6') === '2 * 3 = 6')
check('an empty ** pair stays literal', text('**') === '**')

{
  // A rack notation like **break** is ambiguous; nesting is what matters for correctness.
  const p = first('***both***')
  check('nested emphasis parses without crashing', p.t === 'p' && p.c.length > 0)
}
{
  const deep = '*'.repeat(400) + 'x' + '*'.repeat(400)
  let ok = true
  try { parseArticleBody(deep) } catch { ok = false }
  check('a pathological run of asterisks does not blow the stack', ok)
}

// =========================================================================== hostile input

section('Hostile input becomes text, not markup')

{
  const d = parseArticleBody('<script>alert(1)</script>')
  const only = d.blocks.length === 1 && d.blocks[0].t === 'p'
  check('a script tag is one paragraph', only)
  check('...whose content is the literal characters', text('<script>alert(1)</script>') === '<script>alert(1)</script>')
  check('...and produces no node type but text', allStrings(d).length === 1)
}
check('an img onerror payload stays text', text('<img src=x onerror=alert(1)>') === '<img src=x onerror=alert(1)>')
check('an iframe stays text', text('<iframe src="//evil.test"></iframe>').startsWith('<iframe'))
check('an HTML comment stays text', text('<!-- hi -->') === '<!-- hi -->')
check('an entity is not decoded', text('&lt;script&gt;') === '&lt;script&gt;')

{
  const p = first('[click](javascript:alert(1))')
  const hasLink = p.t === 'p' && p.c.some((n) => n.t === 'link')
  check('a javascript: link produces no link node', !hasLink)
  check('...but keeps the words', text('[click](javascript:alert(1))').includes('click'))
}
check('a data: link produces no link node', !(first('[x](data:text/html;base64,PHN2Zz4=)') as { c?: InlineNode[] }).c?.some((n) => n.t === 'link'))
check('a vbscript: link produces no link node', !(first('[x](vbscript:msgbox)') as { c?: InlineNode[] }).c?.some((n) => n.t === 'link'))
check('a protocol-relative link produces no link node', !(first('[x](//evil.test)') as { c?: InlineNode[] }).c?.some((n) => n.t === 'link'))

{
  // Case and padding are the two classic filter bypasses.
  check('JaVaScRiPt: is rejected', safeHref('JaVaScRiPt:alert(1)') === null)
  check('leading whitespace does not smuggle a scheme', safeHref('  javascript:alert(1)') === null)
  check('an embedded tab does not smuggle a scheme', safeHref('java\tscript:alert(1)') === null)
  check('an embedded newline does not smuggle a scheme', safeHref('java\nscript:alert(1)') === null)
  check('a NUL byte does not smuggle a scheme', safeHref('java\u0000script:alert(1)') === null)
}

check('a zero-width space is stripped', cleanText('a\u200Bb') === 'ab')
check('a right-to-left override is stripped', cleanText('a\u202Eb') === 'ab')
check('a BOM is stripped', cleanText('\uFEFFtitle') === 'title')
check('a NUL byte is stripped', cleanText('a\u0000b') === 'ab')
check('a tab survives', cleanText('a\tb') === 'a\tb')
check('a newline survives', cleanText('a\nb') === 'a\nb')
check('CRLF is normalised to LF', cleanText('a\r\nb') === 'a\nb')

// =========================================================================== safeHref

section('Link targets')

check('https is allowed', safeHref('https://example.com/x') === 'https://example.com/x')
check('http is allowed', !!safeHref('http://example.com'))
check('mailto is allowed', safeHref('mailto:a@b.test') === 'mailto:a@b.test')
check('a site-relative path is allowed', safeHref('/news/hello') === '/news/hello')
check('an anchor is allowed', safeHref('#top') === '#top')
check('a bare host is rejected as ambiguous', safeHref('example.com') === null)
check('file: is rejected', safeHref('file:///c:/windows') === null)
check('an empty string is rejected', safeHref('') === null)
check('a non-string is rejected', safeHref(null) === null)
check('an absurdly long URL is rejected', safeHref('https://a.test/' + 'x'.repeat(4000)) === null)
check('an external link is recognised', isExternalHref('https://example.com'))
check('a site-relative link is not external', !isExternalHref('/news'))

// =========================================================================== sanitizeDocument

section('Validation of stored documents')

check('null becomes an empty document', sanitizeDocument(null).blocks.length === 0)
check('a string becomes an empty document', sanitizeDocument('hello').blocks.length === 0)
check('a number becomes an empty document', sanitizeDocument(42).blocks.length === 0)
check('a bare array of blocks is accepted', sanitizeDocument([{ t: 'p', c: [{ t: 'text', v: 'x' }] }]).blocks.length === 1)
check('an unknown block type is dropped', sanitizeDocument({ blocks: [{ t: 'iframe', src: 'x' }] }).blocks.length === 0)
{
  const d = sanitizeDocument({ blocks: [{ t: 'p', c: [{ t: 'html', v: '<b>' }, { t: 'text', v: 'ok' }] }] })
  check('an unknown inline type is dropped',
    d.blocks.length === 1 && d.blocks[0].t === 'p' && d.blocks[0].c.length === 1)
}
check('an empty paragraph is dropped', sanitizeDocument({ blocks: [{ t: 'p', c: [] }] }).blocks.length === 0)
{
  const d = sanitizeDocument({ blocks: [{ t: 'p', c: [{ t: 'link', href: 'javascript:x', c: [{ t: 'text', v: 'click' }] }] }] })
  const p = d.blocks[0]
  check('a stored javascript: link loses its href', p?.t === 'p' && !p.c.some((n) => n.t === 'link'))
  check('...but keeps its words', documentToPlainText(d) === 'click')
}
{
  const d = sanitizeDocument({ blocks: [{ t: 'link', href: 'https://ok.test' }] })
  check('an inline node at block level is dropped', d.blocks.length === 0)
}
{
  const d = sanitizeDocument({ blocks: [{ t: 'img', mediaId: '../../etc/passwd', alt: 'x' }] })
  check('an image with a path-traversal media id is dropped', d.blocks.length === 0)
}
{
  const d = sanitizeDocument({ blocks: [{ t: 'code', v: 'x', lang: '"><script>' }] })
  check('a hostile code language is nulled, not kept', d.blocks[0]?.t === 'code' && d.blocks[0].lang === null)
}
{
  const many = Array.from({ length: MAX_BLOCKS + 200 }, () => ({ t: 'p', c: [{ t: 'text', v: 'x' }] }))
  check('block count is capped', sanitizeDocument({ blocks: many }).blocks.length === MAX_BLOCKS)
}
{
  const items = Array.from({ length: MAX_LIST_ITEMS + 50 }, () => [{ t: 'text', v: 'x' }])
  const d = sanitizeDocument({ blocks: [{ t: 'ul', items }] })
  check('list length is capped', d.blocks[0]?.t === 'ul' && d.blocks[0].items.length === MAX_LIST_ITEMS)
}
{
  // A deeply nested structure must terminate rather than recurse forever.
  let node: unknown = { t: 'text', v: 'deep' }
  for (let i = 0; i < 200; i += 1) node = { t: 'strong', c: [node] }
  let ok = true
  try { sanitizeDocument({ blocks: [{ t: 'p', c: [node] }] }) } catch { ok = false }
  check('deep inline nesting terminates', ok)
}
{
  const parsed = parseArticleBody('## Title\n\nBody **text**.\n\n- a\n- b')
  const round = sanitizeDocument(JSON.parse(JSON.stringify(parsed)))
  check('a parsed document survives validation unchanged', JSON.stringify(round) === JSON.stringify(parsed))
}
check('buildDocument parses and validates in one step', buildDocument('## Hi').blocks[0].t === 'h')

// =========================================================================== round trip

section('Round trip')

const SAMPLE = [
  '## The break',
  '',
  'A paragraph with **bold**, *italic*, `code` and a [link](/news).',
  '',
  '- first',
  '- second',
  '',
  '1. one',
  '2. two',
  '',
  '> A quotation.',
  '',
  '```sql',
  'select 1',
  '```',
  '',
  '---',
  '',
  '![Alt](media:m1 "Caption")',
].join('\n')

{
  const once = parseArticleBody(SAMPLE)
  const twice = parseArticleBody(serializeArticleBody(once))
  check('parse → serialise → parse is stable', JSON.stringify(once) === JSON.stringify(twice))
  check('the round trip keeps every block', once.blocks.length === twice.blocks.length)
  check('the sample produced all eight block kinds', new Set(once.blocks.map((b) => b.t)).size === 8,
    [...new Set(once.blocks.map((b) => b.t))].join(','))
}

// =========================================================================== derived values

section('Derived values')

check('plain text drops formatting marks', text('**bold** and *italic*') === 'bold and italic')
check('an excerpt of short prose is the prose', deriveExcerpt(buildDocument('Short.')) === 'Short.')
{
  const long = buildDocument('word '.repeat(200))
  const ex = deriveExcerpt(long, 100)
  check('a long excerpt is capped', ex.length <= 101)
  check('...and ends with an ellipsis', ex.endsWith('…'))
  check('...cutting on a word boundary', !/\sw?$/.test(ex.replace('…', '')) || ex.replace('…', '').endsWith('word'))
}
check('reading time is at least one minute', readingTimeMinutes(buildDocument('Hi.')) === 1)
check('reading time scales with length', readingTimeMinutes(buildDocument('word '.repeat(1000))) >= 4)
check('an empty document is empty', isEmptyDocument(buildDocument('')))
check('a document with only an image is not empty', !isEmptyDocument(buildDocument('![a](media:m1)')))
check('a document with prose is not empty', !isEmptyDocument(buildDocument('Words.')))
{
  const ids = referencedMediaIds(buildDocument('![a](media:m1)\n\n![b](media:m2)\n\n![c](media:m1)'))
  check('referenced media ids are collected', ids.length === 2 && ids.includes('m1') && ids.includes('m2'))
}

// =========================================================================== ordered-list start

section('An ordered list can say which number it starts at')
{
  /*
   * Why this exists: a ranking written as one list per item, with commentary between, is many lists
   * to HTML and every one of them restarts at 1. A migrated "Top 10" post read "1." ten times.
   */
  const one = blocks('1. First')[0] as Extract<BlockNode, { t: 'ol' }>
  check('a list starting at one stores no start', one.t === 'ol' && one.start === undefined)

  const seven = blocks('7. Seventh')[0] as Extract<BlockNode, { t: 'ol' }>
  check('a list written from seven starts at seven', seven.t === 'ol' && seven.start === 7, String(seven.start))

  const run = blocks(['3. Third', '4. Fourth'].join(String.fromCharCode(10)))[0] as Extract<BlockNode, { t: 'ol' }>
  check('only the first marker decides the start', run.start === 3 && run.items.length === 2)

  // It survives a round trip, which is what makes it editable rather than merely renderable.
  const back = serializeArticleBody({ v: 1, blocks: [{ t: 'ol', items: [[{ t: 'text', v: 'Seventh' }]], start: 7 }] })
  check('it serialises back to a numbered marker', back.trim() === '7. Seventh', back.trim())
  check('and parses again to the same start',
    (blocks(back)[0] as Extract<BlockNode, { t: 'ol' }>).start === 7)

  // The sanitizer is the boundary, so it decides what a start may be.
  const keep = sanitizeDocument({ v: 1, blocks: [{ t: 'ol', items: [[{ t: 'text', v: 'x' }]], start: 5 }] })
  check('a valid start survives sanitising', (keep.blocks[0] as Extract<BlockNode, { t: 'ol' }>).start === 5)

  const bad = (start: unknown) => sanitizeDocument({
    v: 1, blocks: [{ t: 'ol', items: [[{ t: 'text', v: 'x' }]], start } as unknown as BlockNode],
  }).blocks[0] as Extract<BlockNode, { t: 'ol' }>
  check('a start of one is dropped as the default', bad(1).start === undefined)
  check('zero is dropped', bad(0).start === undefined)
  check('a negative is dropped', bad(-3).start === undefined)
  check('a fraction is dropped', bad(2.5).start === undefined)
  check('a string is dropped', bad('7').start === undefined)
  check('an absurd number is dropped', bad(1_000_000).start === undefined)
  check('the ceiling itself is allowed', bad(MAX_LIST_START).start === MAX_LIST_START)
  check('one past the ceiling is not', bad(MAX_LIST_START + 1).start === undefined)

  // An unordered list has no numbering to start.
  const ul = sanitizeDocument({
    v: 1, blocks: [{ t: 'ul', items: [[{ t: 'text', v: 'x' }]], start: 4 } as unknown as BlockNode],
  }).blocks[0] as Extract<BlockNode, { t: 'ul' }>
  check('a bullet list never carries a start', !('start' in ul))

  // Plain text has no markers at all, so a start cannot leak into an excerpt or the search index.
  check('the start does not appear in plain text',
    !documentToPlainText({ v: 1, blocks: [{ t: 'ol', items: [[{ t: 'text', v: 'Seventh' }]], start: 7 }] }).includes('7.'))
}

// =========================================================================== summary

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} — ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
