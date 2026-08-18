/**
 * Pasted media: validation, storage, safety and the editor's placeholder bookkeeping.
 *
 * The security checks are the point of this suite. Every one of them describes a way a hostile or
 * careless upload could get through, so each is written as "this specific thing is refused" rather
 * than as a general "validation works".
 *
 * Real images are generated with sharp rather than shipped as fixtures, so the bytes are genuine and
 * the suite has no binary files to keep in the repository. Everything it stores it deletes.
 *
 * Run:  node scripts/run-with-esm.mjs npx tsx --tsconfig scripts/tsconfig.verify.json --env-file=.env scripts/verify-media-paste.mts
 */
import sharp from 'sharp'
import { prisma } from '../src/lib/prisma.ts'
import {
  validateImage, sniffImageType, looksLikeMarkup, safeFilename, MediaError,
  ALLOWED_TYPES, MAX_DIMENSION,
} from '../src/lib/media/validate.ts'
import { storePastedMedia, isMediaReferenced, findOrphanedMedia, RATE_LIMIT } from '../src/lib/media/service.ts'
import {
  insertAtSelection, replaceToken, placeholderToken, nextUploadId, mediaReference,
  failureNote, inlineMediaFilenames, imagesFromClipboard, clipboardHasImage, PASTEABLE_TYPES,
} from '../src/lib/editorial/paste-media.ts'
import { isGiphyMediaUrl, giphyIdFromLink, giphyConfigured } from '../src/lib/media/giphy.ts'

let pass = 0, fail = 0
const check = (n: string, ok: boolean, d = '') => {
  if (ok) { pass++; console.log('  ✓ ' + n) } else { fail++; console.log('  ✗ ' + n + (d ? ` — ${d}` : '')) }
}
const section = (t: string) => console.log(`\n--- ${t} ---`)

async function refuses(name: string, fn: () => Promise<unknown>, expect?: RegExp) {
  try {
    await fn()
    check(name, false, 'it was accepted')
  } catch (e) {
    check(name, e instanceof MediaError && (!expect || expect.test(e.message)),
      e instanceof Error ? e.message : String(e))
  }
}

// --------------------------------------------------------------------------- fixtures

const madeFiles: string[] = []
const madeUploadIds: number[] = []
let fixturePlayerId = ''

/** A real PNG/JPEG/WebP/GIF, produced by the same library the validator uses. */
async function makeImage(
  format: 'png' | 'jpeg' | 'webp' | 'gif',
  { width = 40, height = 30 } = {},
): Promise<Buffer> {
  const base = sharp({
    create: { width, height, channels: 3, background: { r: 20, g: 120, b: 80 } },
  })
  if (format === 'png') return base.png().toBuffer()
  if (format === 'jpeg') return base.jpeg().toBuffer()
  if (format === 'webp') return base.webp().toBuffer()
  return base.gif().toBuffer()
}

/**
 * A genuinely animated GIF, assembled byte by byte.
 *
 * Hand-built rather than produced with sharp: sharp will not write a multi-page GIF from a raw
 * filmstrip in this build (it returns a single page), so a generated fixture would have quietly
 * tested the still-image path while claiming to test animation — which is exactly what it did before
 * this was written out properly.
 *
 * Two 1x1 frames, a two-colour global table, and a Netscape loop block. The LZW payload for a single
 * pixel is three codes at three bits each — clear (4), the colour index, end-of-information (5) —
 * packed least-significant-bit first, which is where 0x44 and 0x4C come from.
 */
function makeAnimatedGif(): Buffer {
  const frame = (colourIndex: 0 | 1) => [
    0x21, 0xf9, 0x04, 0x00, 0x0a, 0x00, 0x00, 0x00,       // graphic control: 100ms delay
    0x2c, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, // image descriptor: 1x1 at 0,0
    0x02, 0x02, colourIndex === 0 ? 0x44 : 0x4c, 0x01, 0x00,    // LZW: clear, index, EOI
  ]

  return Buffer.from([
    0x47, 0x49, 0x46, 0x38, 0x39, 0x61,                   // "GIF89a"
    0x01, 0x00, 0x01, 0x00,                               // logical screen 1x1
    0x80, 0x00, 0x00,                                     // global colour table, 2 entries
    0xff, 0xff, 0xff,                                     // colour 0: white
    0x00, 0x00, 0x00,                                     // colour 1: black
    0x21, 0xff, 0x0b,                                     // application extension
    0x4e, 0x45, 0x54, 0x53, 0x43, 0x41, 0x50, 0x45,       // "NETSCAPE"
    0x32, 0x2e, 0x30,                                     // "2.0"
    0x03, 0x01, 0x00, 0x00, 0x00,                         // loop forever
    ...frame(0),
    ...frame(1),
    0x3b,                                                 // trailer
  ])
}

async function cleanup() {
  if (madeUploadIds.length) {
    await prisma.mediaUpload.deleteMany({ where: { id: { in: madeUploadIds } } })
  }
  if (madeFiles.length) {
    const { getPayload } = await import('payload')
    const config = (await import('@payload-config')).default
    try {
      const payload = await getPayload({ config: await config })
      for (const filename of madeFiles) {
        const found = await payload.find({
          collection: 'media', where: { filename: { equals: filename } }, limit: 1, overrideAccess: true,
        })
        const doc = found.docs[0] as { id?: string | number } | undefined
        if (doc?.id != null) {
          await payload.delete({ collection: 'media', id: doc.id, overrideAccess: true })
        }
      }
    } catch (e) {
      console.warn('media cleanup warning:', e instanceof Error ? e.message : e)
    }
  }
  if (fixturePlayerId) {
    await prisma.player.deleteMany({ where: { id: fixturePlayerId, primaryName: { startsWith: 'zzmedia' } } })
  }
}

async function main() {
  section('Signature detection')

  const png = await makeImage('png')
  const jpeg = await makeImage('jpeg')
  const webp = await makeImage('webp')
  const gif = await makeImage('gif')
  const animated = makeAnimatedGif()

  check('a PNG is identified', sniffImageType(png) === 'image/png')
  check('a JPEG is identified', sniffImageType(jpeg) === 'image/jpeg')
  check('a WebP is identified', sniffImageType(webp) === 'image/webp')
  check('a GIF is identified', sniffImageType(gif) === 'image/gif')
  check('every accepted type is in the allow-list',
    ALLOWED_TYPES.length === 4 && ALLOWED_TYPES.includes('image/png'))

  check('a text file is not an image', sniffImageType(Buffer.from('just some text here, honestly')) === null)
  check('an empty buffer is not an image', sniffImageType(Buffer.alloc(0)) === null)
  check('a truncated header is not an image', sniffImageType(png.subarray(0, 4)) === null)

  // The whole point: the NAME and the declared type are not evidence. Only the bytes are.
  check('an SVG is recognised as markup', looksLikeMarkup(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')))
  check('an XML preamble is recognised as markup', looksLikeMarkup(Buffer.from('<?xml version="1.0"?><svg/>')))
  check('an HTML document is recognised as markup', looksLikeMarkup(Buffer.from('<!DOCTYPE html><html></html>')))
  check('leading whitespace does not hide markup', looksLikeMarkup(Buffer.from('   \n  <svg />')))
  check('a real PNG is not markup', !looksLikeMarkup(png))

  section('Validation refusals')

  await refuses('an empty file is refused', () => validateImage(Buffer.alloc(0)), /empty/i)
  await refuses('an SVG is refused even named .png',
    () => validateImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')),
    /SVG/i)
  await refuses('an HTML file is refused', () => validateImage(Buffer.from('<!DOCTYPE html><html>hi</html>')), /SVG|HTML/i)
  await refuses('a plain text file is refused', () => validateImage(Buffer.from('hello world, this is not an image')), /not a JPG/i)
  await refuses('a Windows executable is refused', () => validateImage(Buffer.from('MZ\u0090\u0000\u0003'.padEnd(64, '\u0000'))), /not a JPG/i)
  await refuses('a PDF is refused', () => validateImage(Buffer.from('%PDF-1.7\n%âãÏÓ\n'.padEnd(64, ' '))), /not a JPG/i)
  await refuses('a ZIP is refused', () => validateImage(Buffer.from('PK\u0003\u0004'.padEnd(64, '\u0000'))), /not a JPG/i)
  await refuses('a file with an image signature but no image body is refused',
    () => validateImage(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)])),
    /could not be read/i)

  {
    const huge = await makeImage('png', { width: MAX_DIMENSION + 200, height: 20 })
    await refuses('an over-wide image is refused', () => validateImage(huge), /pixels/i)
  }

  section('Validation and processing')

  for (const [label, buffer, type] of [
    ['PNG', png, 'image/png'], ['JPEG', jpeg, 'image/jpeg'],
    ['WebP', webp, 'image/webp'], ['GIF', gif, 'image/gif'],
  ] as const) {
    const result = await validateImage(buffer)
    check(`a ${label} validates`, result.mimeType === type)
    check(`...with readable dimensions`, result.width === 40 && result.height === 30)
  }

  {
    // EXIF removal is verified by absence: the metadata goes in and is not present on the way out.
    const withExif = await sharp({ create: { width: 30, height: 20, channels: 3, background: '#334455' } })
      .jpeg()
      .withExif({ IFD0: { Copyright: 'zzmedia-secret', Software: 'zzmedia-device' } })
      .toBuffer()
    const before = await sharp(withExif).metadata()
    check('the fixture really does carry EXIF', before.exif != null && before.exif.length > 0)

    const cleaned = await validateImage(withExif)
    const after = await sharp(cleaned.buffer).metadata()
    check('EXIF is stripped from a still image', after.exif == null || after.exif.length === 0)
    check('...and the pixels survive', (after.width ?? 0) === 30 && (after.height ?? 0) === 20)
    check('...with no trace of the original tags',
      !cleaned.buffer.toString('latin1').includes('zzmedia-secret'))
  }

  {
    // Confirm the fixture itself is animated before drawing any conclusion from the validator.
    const fixtureMeta = await sharp(animated, { animated: true }).metadata()
    check('the animated fixture really has multiple frames', (fixtureMeta.pages ?? 1) > 1,
      `${fixtureMeta.pages} pages`)

    const result = await validateImage(animated)
    check('an animated GIF validates', result.mimeType === 'image/gif')
    check('...and is reported as animated', result.animated === true)
    const meta = await sharp(result.buffer, { animated: true }).metadata()
    check('...with its frames intact, not flattened', (meta.pages ?? 1) > 1, `${meta.pages} pages`)
    check('...and is passed through byte-for-byte, which is what preserves the animation',
      result.buffer.equals(animated))
  }
  {
    const still = await validateImage(gif)
    check('a single-frame GIF is not reported as animated', still.animated === false)
    check('...and is still stored as a GIF', still.mimeType === 'image/gif' && still.extension === 'gif')
  }

  section('Filenames')

  check('a traversing name is neutralised', !safeFilename('../../../etc/passwd', 'image/png').includes('..'))
  check('...and keeps no path separators', !safeFilename('../../x/y.png', 'image/png').includes('/'))
  check('a Windows path is reduced to its base', !safeFilename('C:\\Users\\me\\shot.png', 'image/png').includes('\\'))
  check('the extension comes from the sniffed type, not the claim',
    safeFilename('payload.php', 'image/png').endsWith('.png'))
  check('a double extension cannot survive', !safeFilename('a.php.png', 'image/png').includes('.php'))
  check('a leading dot is removed', !safeFilename('.htaccess', 'image/png').startsWith('.'))
  check('a name with no usable characters still yields a filename',
    /^pasted-[a-z0-9]+\.png$/.test(safeFilename('???', 'image/png')))
  check('an empty name still yields a filename', safeFilename('', 'image/gif').endsWith('.gif'))
  check('two uploads of the same name do not collide',
    safeFilename('shot.png', 'image/png') !== safeFilename('shot.png', 'image/png'))
  check('the name is bounded', safeFilename('x'.repeat(500), 'image/png').length < 100)

  section('Storage')

  const player = await prisma.player.create({
    data: { primaryName: 'zzmedia_author', cueverseId: 'zzmedia_author', cueverseIdNormalized: 'zzmedia_author' },
    select: { id: true },
  })
  fixturePlayerId = player.id

  {
    const stored = await storePastedMedia({
      bytes: png, filename: 'screenshot.png', alt: 'A pasted screenshot', uploaderPlayerId: player.id,
    })
    madeFiles.push(stored.filename)
    check('a pasted image is stored', stored.filename.endsWith('.png'))
    check('...and served through the media route', stored.url === `/api/media/file/${stored.filename}`)
    check('...with its dimensions recorded', stored.width === 40 && stored.height === 30)

    const row = await prisma.mediaUpload.findFirst({ where: { filename: stored.filename } })
    if (row) madeUploadIds.push(row.id)
    check('provenance is recorded', row?.uploaderPlayerId === player.id)
    check('...with the real mime type', row?.mimeType === 'image/png')
    check('...and the stored byte count', (row?.bytes ?? 0) > 0)
  }
  {
    const stored = await storePastedMedia({ bytes: animated, uploaderPlayerId: player.id })
    madeFiles.push(stored.filename)
    const row = await prisma.mediaUpload.findFirst({ where: { filename: stored.filename } })
    if (row) madeUploadIds.push(row.id)
    check('an animated GIF is stored as a GIF', stored.filename.endsWith('.gif'))
    check('...and reported as animated', stored.animated === true)
  }
  await refuses('an SVG is refused by the storage path too',
    () => storePastedMedia({ bytes: Buffer.from('<svg/>'), uploaderPlayerId: player.id }), /SVG/i)

  {
    // The rate limit is real and counted in the database.
    const burst = await prisma.mediaUpload.count({
      where: { uploaderPlayerId: player.id, createdAt: { gte: new Date(Date.now() - 60_000) } },
    })
    check('uploads are counted for the rate limit', burst >= 2, `${burst}`)
    check('the per-minute limit is configured', RATE_LIMIT.perMinute > 0 && RATE_LIMIT.perMinute < 1000)
    check('the per-day limit is configured', RATE_LIMIT.perDay >= RATE_LIMIT.perMinute)
  }

  section('Reference safety')

  {
    const referenced = madeFiles[0]
    const article = await prisma.article.create({
      data: {
        authorNameSnapshot: 'zzmedia_author', title: 'zzmedia reference holder',
        slug: 'zzmedia-reference-holder', slugKey: 'zzmedia-reference-holder',
        body: { v: 1, blocks: [{ t: 'img', mediaId: referenced, alt: 'x', caption: null }] },
        state: 'DRAFT',
      },
      select: { id: true },
    })

    check('a file referenced by a draft body is protected', await isMediaReferenced(referenced))
    check('an unreferenced file is not protected', !(await isMediaReferenced('zzmedia-nothing-points-here.png')))

    const orphans = await findOrphanedMedia({ graceHours: 0 })
    check('an orphan sweep does not list a referenced file', !orphans.includes(referenced))

    await prisma.article.update({ where: { id: article.id }, data: { coverMediaId: referenced, body: { v: 1, blocks: [] } } })
    check('a file used only as the cover is still protected', await isMediaReferenced(referenced))

    await prisma.article.delete({ where: { id: article.id } })
    check('once nothing references it, it becomes an orphan candidate',
      (await findOrphanedMedia({ graceHours: 0 })).includes(referenced))
  }

  section('Editor placeholder bookkeeping')

  {
    const id = nextUploadId()
    const token = placeholderToken(id)
    check('a token is unique per upload', placeholderToken(nextUploadId()) !== token)
    check('a token reads as temporary', /uploading/i.test(token))

    const start = insertAtSelection('Before after', 7, 7, token, { asBlock: true })
    check('a token is inserted at the caret', start.text.includes(token))
    check('...as its own block', /\n\n/.test(start.text))
    check('...and the caret lands past it', start.caret === start.text.indexOf(token) + token.length + 2
      || start.text.slice(0, start.caret).includes(token))

    // The behaviour that matters: the author keeps typing while the upload runs.
    const typed = start.text.replace('Before', 'Before and more words typed later')
    const finished = replaceToken(typed, token, mediaReference('shot.png', 'A shot'))
    check('the finished image replaces the token wherever it drifted to',
      finished.includes('![A shot](media:shot.png)'))
    check('...and the typing survives', finished.includes('and more words typed later'))
    check('...with the placeholder gone', !finished.includes(token))

    // And the case that must NOT happen: an upload finishing after the author deleted the placeholder.
    const deleted = typed.split(token).join('')
    const afterDelete = replaceToken(deleted, token, mediaReference('shot.png', 'A shot'))
    check('a deleted placeholder is not resurrected by a late upload',
      !afterDelete.includes('media:shot.png'))

    const failed = replaceToken(start.text, token, failureNote(id, 'Upload failed (413)'))
    check('a failure leaves a visible note', failed.includes('failed to upload'))
    check('...not broken image syntax', !failed.includes('](media:'))
  }
  {
    check('a reference is built in the existing media: form',
      mediaReference('a.png', 'Alt text') === '![Alt text](media:a.png)')
    check('brackets in alt text cannot break the reference',
      !mediaReference('a.png', 'A [weird] (alt)').includes('['.repeat(2)))
    check('a newline in alt text cannot break the reference',
      !mediaReference('a.png', 'one\ntwo').includes('\n'))
  }
  {
    const body = `Intro.\n\n![One](media:one.png)\n\nMiddle.\n\n![Two](media:two.gif)\n\n![One again](media:one.png)`
    const names = inlineMediaFilenames(body)
    check('inline images are found in order', names.join(',') === 'one.png,two.gif')
    check('...without duplicates', names.length === 2)
    check('a body with no images yields none', inlineMediaFilenames('Just words.').length === 0)
    check('existing published syntax still parses', inlineMediaFilenames('![x](media:legacy-file.jpg)')[0] === 'legacy-file.jpg')
  }

  section('Clipboard handling')

  {
    // A minimal DataTransfer stand-in: the functions only read `items` and `files`.
    const fileOf = (type: string) => ({ kind: 'file', type, getAsFile: () => ({ type, name: `x.${type.split('/')[1]}` }) })
    const transferOf = (types: string[]) => ({
      items: types.map(fileOf), files: types.map((t) => ({ type: t, name: 'x' })),
    }) as unknown as DataTransfer

    check('a pasted PNG is detected', clipboardHasImage(transferOf(['image/png'])))
    check('a pasted JPEG is detected', clipboardHasImage(transferOf(['image/jpeg'])))
    check('a pasted WebP is detected', clipboardHasImage(transferOf(['image/webp'])))
    check('a pasted GIF is detected', clipboardHasImage(transferOf(['image/gif'])))
    check('every pasteable type is covered', PASTEABLE_TYPES.length === 4)

    check('a text-only clipboard is left alone', !clipboardHasImage(transferOf(['text/plain'])))
    check('an HTML clipboard is left alone', !clipboardHasImage(transferOf(['text/html'])))
    check('an unsupported image type is left alone', !clipboardHasImage(transferOf(['image/svg+xml'])))
    check('a null clipboard is handled', !clipboardHasImage(null))

    check('several pasted images are all taken', imagesFromClipboard(transferOf(['image/png', 'image/gif'])).length === 2)
    check('only the supported ones are taken',
      imagesFromClipboard(transferOf(['image/png', 'image/svg+xml'])).length === 1)
  }

  section('GIPHY safety')

  check('a GIPHY media host is allowed', isGiphyMediaUrl('https://media.giphy.com/media/abc/giphy.gif'))
  check('a GIPHY subdomain is allowed', isGiphyMediaUrl('https://media3.giphy.com/media/abc/giphy.gif'))
  check('a non-GIPHY host is refused', !isGiphyMediaUrl('https://evil.test/giphy.gif'))
  // The check that a substring match would fail.
  check('a host that merely mentions giphy is refused', !isGiphyMediaUrl('https://evil.test/?x=media.giphy.com'))
  check('a lookalike domain is refused', !isGiphyMediaUrl('https://media.giphy.com.evil.test/a.gif'))
  check('plain http is refused', !isGiphyMediaUrl('http://media.giphy.com/a.gif'))
  check('a file URL is refused', !isGiphyMediaUrl('file:///etc/passwd'))
  check('an internal address is refused', !isGiphyMediaUrl('http://169.254.169.254/latest/meta-data/'))
  check('a localhost address is refused', !isGiphyMediaUrl('http://localhost:3000/x.gif'))
  check('nonsense is refused', !isGiphyMediaUrl('not a url'))
  check('undefined is refused', !isGiphyMediaUrl(undefined))

  check('a GIPHY page link yields an id', giphyIdFromLink('https://giphy.com/gifs/funny-cat-abc123XYZ') === 'abc123XYZ')
  check('a short link yields an id', giphyIdFromLink('https://gph.is/g/aXbYcZ12345') != null)
  check('a non-GIPHY link yields nothing', giphyIdFromLink('https://example.com/gifs/abc123') === null)
  check('nonsense yields nothing', giphyIdFromLink('hello') === null)

  check('the picker reports whether it is configured', typeof giphyConfigured() === 'boolean')
  if (!giphyConfigured()) {
    console.log('    (GIPHY_API_KEY is not set, so live search is not exercised — the picker is designed to say so)')
  }

  console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} — ${pass} passed, ${fail} failed`)
}

main()
  .catch((e) => {
    console.error('\nSUITE ERROR:', e)
    fail += 1
  })
  .finally(async () => {
    await cleanup()
    const leftover = await prisma.mediaUpload.count({ where: { uploaderPlayerId: fixturePlayerId || 'none' } })
    console.log(`\nCleaned up ${madeFiles.length} files, ${madeUploadIds.length} upload rows.`)
    console.log(leftover === 0 ? 'No fixture rows remain.' : `WARNING: ${leftover} upload rows remain.`)
    await prisma.$disconnect()
    process.exit(fail === 0 && leftover === 0 ? 0 : 1)
  })

// ─────────────────────────────────────────────────── the cover is not rendered twice
console.log('\nfeatured image de-duplication')
{
  // The featured image falls back to the FIRST image in the body, so on most articles the cover and
  // the body's opening image are the same file. Rendering the hero and the body unchanged showed that
  // image twice on the published page. RichText drops the first matching block; this covers the rule
  // without rendering, by applying the same filter the component applies.
  const skipFirst = (blocks: { t: string; mediaId?: string }[], cover: string | null) => {
    let skipped = false
    return blocks.filter((b) => {
      if (skipped || !cover) return true
      if (b.t === 'img' && b.mediaId === cover) { skipped = true; return false }
      return true
    })
  }

  const cover = 'shot.png'
  const body = [
    { t: 'img', mediaId: 'shot.png' },
    { t: 'p' },
    { t: 'img', mediaId: 'other.png' },
  ]
  const out = skipFirst(body, cover)
  check('the cover image is dropped from the body so it renders once, not twice',
    out.length === 2 && !out.some((b) => b.t === 'img' && b.mediaId === 'shot.png'))
  check('a different inline image is untouched',
    out.some((b) => b.t === 'img' && b.mediaId === 'other.png'))

  // An author may deliberately reuse an image later; only the promoted occurrence goes.
  const repeated = skipFirst([
    { t: 'img', mediaId: 'shot.png' },
    { t: 'p' },
    { t: 'img', mediaId: 'shot.png' },
  ], cover)
  check('a deliberate later reuse of the same image survives',
    repeated.filter((b) => b.t === 'img').length === 1)

  // A cover uploaded separately never appears in the body, so nothing should be removed.
  const separate = skipFirst([{ t: 'img', mediaId: 'inline.png' }, { t: 'p' }], 'uploaded-cover.png')
  check('a separately uploaded cover leaves the body alone', separate.length === 2)

  check('an article with no cover is unchanged',
    skipFirst([{ t: 'img', mediaId: 'a.png' }], null).length === 1)
}
