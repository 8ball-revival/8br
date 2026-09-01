/**
 * Body-copy autolinking on the marquee panels, and the panel button it has to coexist with.
 *
 * The two links are independent by construction, and that construction is the fragile part: the
 * panel used to BE the anchor, so a link in its body copy would have been an `<a>` inside an `<a>`.
 * Most of what is checked here is that they stayed separate — and that nothing an author types into
 * the body-copy field can become markup.
 *
 * Run:  npx tsx --tsconfig tsconfig.scripts.json scripts/verify-marquee-autolink.mts
 */
import { readFileSync } from 'node:fs'
import { linkify, safeHttpUrl, hasLink } from '../src/lib/site-builder/autolink.ts'

let pass = 0, fail = 0
const check = (label: string, ok: boolean, detail?: string) => {
  if (ok) { pass++; console.log(`  ✓ ${label}`) }
  else { fail++; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`) }
}
const section = (t: string) => console.log(`\n--- ${t} ---`)

const links = (t: string) => linkify(t).filter((s) => s.kind === 'link') as { kind: 'link'; href: string; label: string }[]
const rebuilt = (t: string) => linkify(t).map((s) => (s.kind === 'text' ? s.value : s.label)).join('')

// ── The link that has to work ─────────────────────────────────────────────────────────────────
section('A complete URL becomes a link')
{
  const real = 'Watch the archive at https://8brcam.ai.studio/ for the full history.'
  const l = links(real)
  check('the 8BRCAM URL is found', l.length === 1, String(l.length))
  check('...with the URL as its address', l[0]?.href === 'https://8brcam.ai.studio/', l[0]?.href)
  check('...and as its visible text', l[0]?.label === 'https://8brcam.ai.studio/', l[0]?.label)

  check('http is linked too', links('see http://example.com now').length === 1)
  check('a URL with a path and query survives whole',
    links('go to https://example.com/a/b?c=1&d=2 today')[0]?.label === 'https://example.com/a/b?c=1&d=2')
  check('two URLs in one paragraph both link',
    links('https://a.example.com and https://b.example.com').length === 2)
}

// ── The text around it ────────────────────────────────────────────────────────────────────────
section('The surrounding text and line breaks survive')
{
  const multi = 'Season 2 starts soon.\n\nArchive: https://8brcam.ai.studio/\nSee you there.'
  check('every character comes back in order', rebuilt(multi) === multi)
  check('the line breaks are still in the text',
    linkify(multi).filter((s) => s.kind === 'text').some((s) => s.kind === 'text' && s.value.includes('\n')))

  check('text with no URL is one plain segment',
    linkify('Just words.').every((s) => s.kind === 'text'))
  check('empty copy produces nothing', linkify('').length === 0)
  check('a URL alone is a single link segment',
    linkify('https://example.com').length === 1 && links('https://example.com').length === 1)

  // A sentence's punctuation is not part of the address.
  check('a trailing full stop is left in the sentence',
    links('See https://example.com.')[0]?.href === 'https://example.com/', links('See https://example.com.')[0]?.href)
  check('...and stays in the rebuilt text', rebuilt('See https://example.com.') === 'See https://example.com.')
  check('a closing bracket that closes an aside is not swallowed',
    links('(see https://example.com)')[0]?.label === 'https://example.com')
  check('...but a bracket the URL opened is kept',
    links('https://example.com/a_(b)')[0]?.label === 'https://example.com/a_(b)',
    links('https://example.com/a_(b)')[0]?.label)
  check('a comma between two URLs belongs to the sentence',
    links('https://a.example.com, https://b.example.com').every((l) => !l.label.endsWith(',')))
}

// ── Labelled links ────────────────────────────────────────────────────────────────────────────
section('A link can carry its own words')
{
  const real = 'The official 8BRCAM website: [The official 8BRCAM website](https://8brcam.ai.studio/)'
  const l = links(real)
  check('the label becomes the link text', l[0]?.label === 'The official 8BRCAM website', l[0]?.label)
  check('...pointing at the address in brackets', l[0]?.href === 'https://8brcam.ai.studio/', l[0]?.href)
  check('the address itself is not shown as well',
    !linkify(real).some((s) => s.kind === 'text' && s.value.includes('8brcam.ai.studio')))
  check('the surrounding sentence survives',
    linkify(real).some((s) => s.kind === 'text' && s.value.includes('The official 8BRCAM website: ')))

  check('a labelled and a bare link can share one paragraph',
    links('see [here](https://a.example.com) or https://b.example.com').length === 2)
  check('...the labelled one keeps its words',
    links('see [here](https://a.example.com) or https://b.example.com')[0]?.label === 'here')
  check('...and the bare one keeps its address',
    links('see [here](https://a.example.com) or https://b.example.com')[1]?.label === 'https://b.example.com')

  check('line breaks around a labelled link survive',
    rebuilt('one\n[two](https://x.example.com)\nthree').includes('\n'))
  check('a label is plain text, not markup',
    links('[a <b> c](https://x.example.com)')[0]?.label === 'a <b> c')

  /*
    A labelled link is where somebody would try to hide a bad address behind friendly words, so an
    unusable one must not become a link at all - and must not silently swallow the author's text.
  */
  check('a javascript: address is refused', links('[click](javascript:alert(1))').length === 0)
  check('...and the text the author typed is still there',
    rebuilt('[click](javascript:alert(1))') === '[click](javascript:alert(1))')
  check('a data: address is refused', links('[x](data:text/html,<script>alert(1)</script>)').length === 0)
  check('a relative path is refused', links('[x](/seasons)').length === 0)
  /*
    An empty label is not a labelled link, and the address inside it is then just a bare URL in the
    text - which is exactly what the reader sees - so it links as one. The author's brackets stay
    put rather than being quietly eaten.
  */
  check('an empty label falls back to linking the bare address',
    links('[](https://x.example.com)')[0]?.label === 'https://x.example.com')
  check('...leaving the brackets the author typed visible',
    rebuilt('[](https://x.example.com)') === '[](https://x.example.com)')
  check('an empty address is refused', links('[x]()').length === 0)
}

// ── What must NOT become a link ───────────────────────────────────────────────────────────────
section('Only complete http(s) URLs are linked')
{
  check('a bare domain is not linked', links('visit example.com today').length === 0)
  check('a www prefix is not linked', links('visit www.example.com').length === 0)
  check('mailto is not linked', links('mail me at mailto:a@b.com').length === 0)
  check('a scheme with no host is not linked', links('https:// is a scheme').length === 0)
  check('a relative path is not linked', links('go to /seasons/2 now').length === 0)
}

// ── Injection ─────────────────────────────────────────────────────────────────────────────────
section('Nothing an author types can become markup or a dangerous href')
{
  check('javascript: is refused', safeHttpUrl('javascript:alert(1)') === null)
  check('data: is refused', safeHttpUrl('data:text/html,<script>alert(1)</script>') === null)
  check('vbscript: is refused', safeHttpUrl('vbscript:msgbox(1)') === null)
  check('file: is refused', safeHttpUrl('file:///etc/passwd') === null)
  check('a javascript URL in body copy is not linked',
    links('click javascript:alert(1) here').length === 0)

  const nasty = '<script>alert(1)</script> and <img src=x onerror=alert(1)>'
  check('HTML in body copy stays text', linkify(nasty).every((s) => s.kind === 'text'))
  check('...and comes back byte for byte', rebuilt(nasty) === nasty)

  // A tag wrapped around a URL must not extend the href into the markup.
  const wrapped = '<a href="https://evil.example.com">x</a>'
  const w = links(wrapped)
  check('a URL inside a tag does not absorb the quote or bracket',
    w.every((l) => !l.label.includes('"') && !l.label.includes('>') && !l.label.includes('<')),
    w.map((l) => l.label).join(' | '))

  // The renderer must never hand author text to the HTML parser.
  const body = readFileSync('src/components/site-builder/body-copy.tsx', 'utf8')
  check('the renderer never uses dangerouslySetInnerHTML', !body.includes('dangerouslySetInnerHTML'))
  /*
   * Comments are stripped first: this file explains at length what it deliberately does NOT do, and
   * that prose quotes the very markup being banned. Matching the words would fail on the
   * explanation while the code stayed clean, which is the wrong way round.
   */
  const auto = readFileSync('src/lib/site-builder/autolink.ts', 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
  check('the linkifier produces no markup at all', !/<a\s|innerHTML/.test(auto))
  check('every href is validated by the URL parser', auto.includes('new URL('))
}

// ── New tab, and the rel that has to come with it ─────────────────────────────────────────────
section('Body-copy links open in a new tab, safely')
{
  const body = readFileSync('src/components/site-builder/body-copy.tsx', 'utf8')
  check('a body link opens in a new tab', /target="_blank"/.test(body))
  check('...with noopener noreferrer', /rel="noopener noreferrer"/.test(body))
  check('...and carries the styling hook', /className="sb-body-link"/.test(body))
}

// ── The two links are separate ────────────────────────────────────────────────────────────────
section('The panel button and the body link are independent')
{
  const mq = readFileSync('src/components/site-builder/modules/marquee.tsx', 'utf8')

  check('the panel is no longer an anchor wrapping everything',
    !/return external \? \(\s*<a/.test(mq) && /<div key=\{i\} className=\{className\}/.test(mq))
  check('the panel button is a real link', /<a\s+href=\{external \? panel\.ctaHref/.test(mq))
  check('...stretched back over the panel', mq.includes('sb-panel-link'))
  check('the body copy is rendered by the linkifying component', mq.includes('<BodyCopy text={panel.body}'))
  check('no raw body copy is printed any more', !mq.includes('{panel.body}</p>'))

  // The destination and label fields are untouched.
  check('the Button label field is unchanged',
    /ctaLabel: \{ kind: 'text', label: 'Button label', default: 'Find out more', maxLength: 60 \}/.test(mq))
  check('the Button destination field is unchanged',
    /ctaHref: \{ kind: 'url', label: 'Button destination', default: '\/' \}/.test(mq))
  /*
    The body-copy field keeps its type and its limits.

    Pinned as the parts that decide what an author can store - not the literal line, which now also
    carries help text explaining the link syntax. A change to `maxLength` or `multiline` would
    silently alter or truncate copy somebody has already written; a sentence of help cannot.
  */
  check('the body-copy field keeps its type and limits',
    /body: \{[\s\S]{0,400}?kind: 'text'/.test(mq)
    && /label: 'Body copy'/.test(mq)
    && /maxLength: 300/.test(mq)
    && /multiline: true/.test(mq))
  check('...and tells the author how to write a labelled link',
    /\[the words\]\(https:\/\/example\.com\)/.test(mq))

  // An internal destination must not have gained a new tab or a rel.
  check('an internal button still opens in the same tab',
    mq.includes("target={external && panel.newTab ? '_blank' : undefined}"))
  check('...and carries no rel', mq.includes("rel={external ? 'noopener noreferrer' : undefined}"))

  const css = readFileSync('src/app/(frontend)/globals.css', 'utf8')
  check('the panel link is stretched over the whole panel',
    /\.sb-panel-link \{[\s\S]*?position: absolute;[\s\S]*?inset: 0;/.test(css))
  check('...and sits below the body link', /\.sb-panel-link \{[\s\S]*?z-index: 0;/.test(css))
  /*
   * The overlay must be a DIRECT child of the panel.
   *
   * An absolutely-positioned element resolves against its nearest POSITIONED ancestor, and the
   * panel's inner row is positioned. Rendered from inside the text column the overlay covered the
   * row and not the half, which is how the whole-panel click target silently disappeared — the two
   * links worked and everything else on the panel had quietly stopped being clickable.
   */
  check('the overlay is a direct child of the panel, not of the text column',
    /\{inner\}\s*<a\s+href=\{external \? panel\.ctaHref/.test(mq))
  check('the CTA itself is not a link, so nothing nests', /<span className=\{cn\('marquee-cta', theme\.cta\)\}>/.test(mq))
  check('...and the body link is raised above it', /\.sb-body-link \{[\s\S]*?z-index: 1;/.test(css))
  check('the body link is underlined, not colour alone', /\.sb-body-link \{[\s\S]*?text-decoration: underline;/.test(css))
  check('the body link has a hover state', /\.sb-body-link:hover/.test(css))
  check('...and a visible focus ring', /\.sb-body-link:focus-visible/.test(css))
  check('the panel button kept a focus ring of its own', /\.sb-panel-link:focus-visible/.test(css))
  check('the link takes the panel accent', /--sb-accent/.test(css))
}

// ── One renderer, so preview and published cannot drift ───────────────────────────────────────
section('The builder preview and the published page render the same component')
{
  const mq = readFileSync('src/components/site-builder/modules/marquee.tsx', 'utf8')
  check('the marquee is registered once', (mq.match(/registerModule\(/g) ?? []).length === 1)
  check('...and body copy is drawn in that one render path',
    (mq.match(/<BodyCopy /g) ?? []).length === 1)
  check('hasLink is available for the editor', typeof hasLink === 'function' && hasLink('a https://x.example.com b'))
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
