/**
 * The News article detail page: layout, featured image, and the expandable viewer.
 *
 * Structure is checked by RENDERING the real components with react-dom/server and asserting on the
 * markup, rather than by grepping source — so a class that moves or a wrapper that disappears is
 * caught. The lightbox's interaction rules are executed directly from `lightbox-behavior`, which is the
 * module the component actually uses, so backdrop clicks, Escape, focus wrapping and the scroll lock
 * are exercised rather than described.
 *
 * What this cannot do: there is no DOM here, so nothing is physically clicked in a browser and no
 * layout is computed. Pixel behaviour was checked separately against the running dev server.
 */

import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'

import { RichText } from '@/components/editorial/rich-text'
import { ExpandableArticleImage } from '@/components/editorial/expandable-article-image'
import {
  FIT_INDEX, FOCUSABLE_SELECTOR, ZOOM_STEPS, isCloseKey, lockScroll,
  nextFocusTarget, nextZoomIndex, shouldCloseOnBackdrop,
} from '@/components/editorial/lightbox-behavior'
import type { RichDocument } from '@/lib/editorial/richtext'
import { listArticles, parseArticleSort, ARTICLE_SORTS } from '@/lib/editorial/queries'

let passed = 0
let failed = 0
function check(name: string, ok: boolean, detail = '') {
  if (ok) { passed += 1 } else { failed += 1; console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`) }
}

const img = (mediaId: string, alt = 'An image', caption: string | null = null) =>
  ({ t: 'img' as const, mediaId, alt, caption })
const para = (text: string) => ({ t: 'p' as const, c: [{ t: 'text' as const, v: text }] })

const doc = (...blocks: RichDocument['blocks']): RichDocument => ({ blocks })

/** How many <img> tags reference a given media file. */
function imgCount(html: string, mediaId: string): number {
  return (html.match(new RegExp(`<img[^>]*${mediaId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^>]*>`, 'g')) ?? []).length
}

const render = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el)

// ─────────────────────────────────────────────────── featured image de-duplication
console.log('\nfeatured image de-duplication')
{
  // The auto-promotion case: no explicit cover, so the body's first image becomes the feature. It is
  // rendered above the body, so the body must not render it again.
  const promoted = doc(img('shot.png'), para('Body text.'), img('second.png'))
  const html = render(createElement(RichText, { doc: promoted, skipFirstMediaId: 'shot.png' }))
  check('a promoted first image is not rendered a second time in the body',
    imgCount(html, 'shot.png') === 0)
  check('...while other inline images are untouched', imgCount(html, 'second.png') === 1)

  // An explicitly chosen cover that is NOT the body's first image: every inline image is deliberate
  // and all of them must survive, including one that repeats the cover.
  const explicit = doc(img('inline-a.png'), para('Text.'), img('chosen-cover.png'))
  const explicitHtml = render(createElement(RichText, { doc: explicit, skipFirstMediaId: 'chosen-cover.png' }))
  check('an explicit cover leaves the body\'s first image in place',
    imgCount(explicitHtml, 'inline-a.png') === 1)
  check('...and does not strip a deliberate inline copy of itself',
    imgCount(explicitHtml, 'chosen-cover.png') === 1,
    'only the FIRST image is ever dropped, and only when it is the cover')

  // Deliberate reuse of the promoted image later in the piece.
  const repeated = doc(img('shot.png'), para('Text.'), img('shot.png'))
  const repeatedHtml = render(createElement(RichText, { doc: repeated, skipFirstMediaId: 'shot.png' }))
  check('a deliberate later reuse of the promoted image survives',
    imgCount(repeatedHtml, 'shot.png') === 1)

  // No cover at all.
  const noCover = render(createElement(RichText, { doc: doc(img('only.png')), skipFirstMediaId: null }))
  check('with no cover, nothing is removed', imgCount(noCover, 'only.png') === 1)

  // A cover that appears nowhere in the body.
  const separate = render(createElement(RichText, {
    doc: doc(para('Text.'), img('inline.png')),
    skipFirstMediaId: 'uploaded-separately.png',
  }))
  check('a separately uploaded cover leaves the body alone', imgCount(separate, 'inline.png') === 1)

  // Text before the first image: the promoted image is still the first IMAGE, not the first block.
  const textFirst = render(createElement(RichText, {
    doc: doc(para('Intro.'), img('lead.png'), para('More.')),
    skipFirstMediaId: 'lead.png',
  }))
  check('the rule finds the first image, not the first block', imgCount(textFirst, 'lead.png') === 0)
  check('...and leaves the surrounding text intact',
    textFirst.includes('Intro.') && textFirst.includes('More.'))
}

// ─────────────────────────────────────────────────── an article with no images
console.log('\narticles without images')
{
  const html = render(createElement(RichText, {
    doc: doc(para('Just words.'), para('And more words.')),
    skipFirstMediaId: null,
  }))
  check('a text-only article renders its text', html.includes('Just words.'))
  check('...and contains no image elements', imgCount(html, '') === 0 && !html.includes('<img'))
}

// ─────────────────────────────────────────────────── the expandable image itself
console.log('\nexpandable image')
{
  const html = render(createElement(ExpandableArticleImage, {
    src: '/api/media/file/tall.png',
    alt: 'A tall archival graphic',
    caption: 'From the archive',
  }))

  check('the preview renders the image', html.includes('/api/media/file/tall.png'))
  check('the preview is a button, so it is reachable by keyboard', html.includes('<button'))
  check('it announces that it opens a dialog', html.includes('aria-haspopup="dialog"'))
  check('it has a descriptive accessible name rather than just the alt text',
    html.includes('Enlarge image: A tall archival graphic'))
  check('the image is contained, never cropped', html.includes('object-contain'))
  check('there is a visible enlarge affordance', html.includes('Click to enlarge'))
  check('the caption is shown', html.includes('From the archive'))
  check('the affordance is hidden from screen readers, which already have the button label',
    html.includes('aria-hidden'))

  // The lightbox must not be in the document until it is opened.
  check('the dialog is not rendered until opened', !html.includes('aria-modal'))

  // It must not be a plain link to the raw file, which would navigate away from the article.
  check('the preview does not link straight to the media URL',
    !html.includes('<a href="/api/media/file/tall.png"'))

  const noCaption = render(createElement(ExpandableArticleImage, {
    src: '/api/media/file/x.gif', alt: 'A GIF',
  }))
  check('an image with no caption still renders', noCaption.includes('/api/media/file/x.gif'))

  // A GIF is served as-is; nothing re-encodes or replaces the source, which is what preserves motion.
  check('a GIF keeps its original source, which is what keeps it animated',
    noCaption.includes('.gif'))

  // Body images go through the same component, so they enlarge the same way.
  const inline = render(createElement(RichText, {
    doc: doc(img('inline.gif', 'Inline GIF')), skipFirstMediaId: null,
  }))
  check('images inside article markdown use the same expandable viewer',
    inline.includes('aria-haspopup="dialog"') && inline.includes('Enlarge image: Inline GIF'))
}

// ─────────────────────────────────────────────────── closing the lightbox
console.log('\nlightbox: closing')
{
  const backdrop = { id: 'backdrop' }
  const image = { id: 'image' }

  check('clicking the backdrop itself closes', shouldCloseOnBackdrop(backdrop, backdrop))
  check('clicking the image does NOT close', !shouldCloseOnBackdrop(image, backdrop),
    'the reader opened the dialog to look at the image')
  check('clicking a control does NOT close',
    !shouldCloseOnBackdrop({ id: 'zoom-in' }, backdrop))

  check('Escape closes', isCloseKey('Escape'))
  check('the legacy Esc key name also closes', isCloseKey('Esc'))
  check('an ordinary key does not close', !isCloseKey('a'))
  check('Tab does not close', !isCloseKey('Tab'))
  check('Enter does not close', !isCloseKey('Enter'))
}

// ─────────────────────────────────────────────────── focus handling
console.log('\nlightbox: focus')
{
  const [a, b, c] = ['zoom-out', 'zoom-in', 'close']
  const elements = [a, b, c]

  check('Tab from the last control wraps to the first',
    nextFocusTarget({ elements, active: c, shiftKey: false }) === a)
  check('Shift-Tab from the first control wraps to the last',
    nextFocusTarget({ elements, active: a, shiftKey: true }) === c)
  check('Tab in the middle is left to the browser',
    nextFocusTarget({ elements, active: b, shiftKey: false }) === null)
  check('Shift-Tab in the middle is left to the browser',
    nextFocusTarget({ elements, active: b, shiftKey: true }) === null)
  check('focus cannot escape a dialog with a single control',
    nextFocusTarget({ elements: [a], active: a, shiftKey: false }) === a)
  check('an empty dialog does nothing rather than throwing',
    nextFocusTarget({ elements: [], active: null, shiftKey: false }) === null)

  check('the focusable selector excludes disabled buttons',
    FOCUSABLE_SELECTOR.includes('button:not([disabled])'))
  check('...and excludes elements removed from the tab order',
    FOCUSABLE_SELECTOR.includes('[tabindex]:not([tabindex="-1"])'))
}

// ─────────────────────────────────────────────────── background scroll lock
console.log('\nlightbox: background scroll lock')
{
  const body = { style: { overflow: '', paddingRight: '' } }
  const restore = lockScroll(body, 15)
  check('background scrolling is locked while open', body.style.overflow === 'hidden')
  check('the scrollbar width is compensated, so the page does not jump sideways',
    body.style.paddingRight === '15px')

  restore()
  check('scrolling is restored on close', body.style.overflow === '')
  check('the compensating padding is removed', body.style.paddingRight === '')

  // A page that already had its own styles must get them back, not be reset to empty.
  const styled = { style: { overflow: 'auto', paddingRight: '2rem' } }
  lockScroll(styled, 15)()
  check('pre-existing overflow is restored verbatim', styled.style.overflow === 'auto')
  check('pre-existing padding is restored verbatim', styled.style.paddingRight === '2rem')

  // No scrollbar (a short page, or an overlay scrollbar platform) means no compensation.
  const noBar = { style: { overflow: '', paddingRight: '' } }
  lockScroll(noBar, 0)
  check('no padding is added when there is no scrollbar to compensate for',
    noBar.style.paddingRight === '')
}

// ─────────────────────────────────────────────────── zoom
console.log('\nlightbox: zoom')
{
  check('fit is the starting level', FIT_INDEX === 0 && ZOOM_STEPS[FIT_INDEX] === 1)
  check('zooming in advances a step', nextZoomIndex(0, 1) === 1)
  check('zooming out goes back a step', nextZoomIndex(2, -1) === 1)
  check('zoom cannot go below fit', nextZoomIndex(0, -1) === 0)
  check('zoom cannot exceed the largest step',
    nextZoomIndex(ZOOM_STEPS.length - 1, 1) === ZOOM_STEPS.length - 1)
  check('every zoom step magnifies', ZOOM_STEPS.every((z, i) => i === 0 || z > ZOOM_STEPS[i - 1]))
  check('a nonsense index falls back to fit', nextZoomIndex(Number.NaN, 1) === 0)
}

// ─────────────────────────────────────────────────── sort options
console.log('\nsort options')
{
  check('every sort option has a label', ARTICLE_SORTS.every((o) => o.label.length > 0))
  check('the sort ids are unique',
    new Set(ARTICLE_SORTS.map((o) => o.id)).size === ARTICLE_SORTS.length)
  check('newest is offered', ARTICLE_SORTS.some((o) => o.id === 'newest'))
  check('both author directions are offered',
    ARTICLE_SORTS.some((o) => o.id === 'author') && ARTICLE_SORTS.some((o) => o.id === 'author-desc'))

  check('a valid sort is accepted', parseArticleSort('author') === 'author')
  check('the reverse author sort is accepted', parseArticleSort('author-desc') === 'author-desc')
  check('oldest is accepted', parseArticleSort('oldest') === 'oldest')
  check('an unknown value falls back to newest', parseArticleSort('nonsense') === 'newest')
  check('a missing value falls back to newest', parseArticleSort(undefined) === 'newest')
  check('null falls back to newest', parseArticleSort(null) === 'newest')
  check('an injection attempt falls back rather than reaching the query',
    parseArticleSort('id; DROP TABLE article') === 'newest')
}

// ─────────────────────────────────────────────────── author ordering, on real data
console.log('\nauthor ordering (development database)')
{
  const nameOf = (a: { author: { handle: string | null; name: string } }) =>
    (a.author.handle ?? a.author.name).trim()

  const [asc, desc, newest] = await Promise.all([
    listArticles({ sort: 'author' }),
    listArticles({ sort: 'author-desc' }),
    listArticles({ sort: 'newest', honourPins: true }),
  ])

  check('the author sort returns the same articles as the default order',
    asc.total === newest.total, `${asc.total} vs ${newest.total}`)

  const names = asc.items.map(nameOf)
  // Case-insensitive, which is the whole point: this database uses the C collation, under which a
  // plain sort puts every capitalised name before every lowercase one.
  const sorted = [...names].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
  check('A-Z is genuinely alphabetical, ignoring case',
    names.join('|') === sorted.join('|'), `got ${names.join(', ')}`)

  check('Z-A is the exact reverse of A-Z',
    desc.items.map(nameOf).join('|') === [...names].reverse().join('|'),
    `asc [${names.join(', ')}] desc [${desc.items.map(nameOf).join(', ')}]`)

  check('sorting changes the order but not which articles are listed',
    [...asc.items.map((a) => a.id)].sort().join(',') === [...desc.items.map((a) => a.id)].sort().join(','))

  const oldest = await listArticles({ sort: 'oldest' })
  const times = oldest.items.map((a) => a.publishAt?.getTime() ?? 0)
  check('oldest-first is ascending by date',
    times.every((t, i) => i === 0 || times[i - 1] <= t))
}


console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
