/**
 * The header mark is a tracked file, and the wordmark's weight is real.
 *
 * ── What went wrong ─────────────────────────────────────────────────────────────────────────────
 * Two separate faults, both of which looked fine in the source.
 *
 * The mark came from the admin-managed branding record, which pointed at an upload in Blob storage.
 * So the one image every page shows depended on a database row and a remote object, and replacing
 * it meant a re-upload — served from cache under the same name, which is how the header went on
 * showing artwork nobody had chosen. It is a file in this repository now, versioned by FILENAME so
 * a new crest is a URL nothing has cached.
 *
 * The wordmark asked for font-weight 900 in the display face, whose variable axis stops at 700. The
 * browser clamped it and rendered pixel-for-pixel what it already was: 700, 800 and 900 all measured
 * 132.05px. A weight that cannot render is not a weight. It is set in Inter, which reaches 900.
 *
 * Run:  npx tsx --tsconfig scripts/tsconfig.verify.json --env-file=.env scripts/verify-header-brand.mts
 */
import { readFileSync, existsSync, statSync } from 'node:fs'

let failures = 0
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${label}${ok || !detail ? '' : ` — ${detail}`}`)
  if (!ok) failures++
}

const BRAND = readFileSync('src/components/brand.tsx', 'utf8')
const HEADER = readFileSync('src/components/site-header.tsx', 'utf8')
const ASSET = 'public/assets/branding/registry-crest-20260827.png'

console.log('--- The mark is a file in this repository ---')

check('the asset exists', existsSync(ASSET))
check('...and is the artwork, not a placeholder', existsSync(ASSET) && statSync(ASSET).size > 100_000,
  existsSync(ASSET) ? `${statSync(ASSET).size} bytes` : 'missing')

/* A PNG with an alpha channel: colour type 6 is RGBA. The crest sits on the acid bar and would
   show a white box if it were flattened, so transparency is a requirement, not a detail. */
if (existsSync(ASSET)) {
  const bytes = readFileSync(ASSET)
  const signature = bytes.subarray(0, 8).toString('hex') === '89504e470d0a1a0a'
  const width = bytes.readUInt32BE(16)
  const height = bytes.readUInt32BE(20)
  const colourType = bytes[25]
  check('it is a real PNG', signature)
  check('...with an alpha channel, so the bar shows through', colourType === 6, `colour type ${colourType}`)
  check('...and the declared dimensions match the file', /width: 1261/.test(BRAND) && /height: 1247/.test(BRAND) && width === 1261 && height === 1247,
    `${width}x${height}`)
}

console.log('\n--- The header uses it, and nothing remote ---')

check('the mark is referenced by its versioned filename', BRAND.includes('/assets/branding/registry-crest-20260827.png'))
check('no header variant still points at the Blob upload', !BRAND.includes('/api/media/file/') && !HEADER.includes('/api/media/file/'))
/*
 * One Logo serves the desktop and mobile header alike — the bar is a single responsive markup, not
 * two. So "every variant" is a statement about the header passing no image of its own.
 */
check('the header no longer threads an image URL through', !/logoUrl=/.test(HEADER))
check('...and Logo takes no image URL to thread', !/logoUrl\??:/.test(BRAND))
check('the site name is still admin-managed', /siteName=\{branding\.siteName\}/.test(HEADER))

console.log('\n--- The wordmark is genuinely 900 ---')

const wordmark = /<span className="([^"]*)">\{siteName\}<\/span>/.exec(BRAND)?.[1] ?? ''
check('the wordmark carries font-black (weight 900)', /\bfont-black\b/.test(wordmark), wordmark)
check('...in a family whose axis reaches 900', /\bfont-sans\b/.test(wordmark), wordmark)
/*
 * The display face is the trap: its axis stops at 700, so font-black there renders as 700 and the
 * change is invisible. This is the check that would have caught it.
 */
check('...and NOT in the display face, which clamps at 700', !/\bfont-display\b/.test(wordmark), wordmark)
check('the wording is unchanged', BRAND.includes('{siteName}'))
check('...and so is the size', /\btext-lg\b/.test(wordmark) && /\bsm:text-xl\b/.test(wordmark), wordmark)

console.log('\n--- Proportions are the image\'s own ---')

check('height is fixed and width follows it', /h-10 w-auto/.test(BRAND))
check('...and the image is never cropped to fit', /object-contain/.test(BRAND))

console.log(`\n${failures === 0 ? 'RESULT: all checks passed' : `RESULT: ${failures} check(s) failed`}`)
process.exit(failures === 0 ? 0 : 1)
