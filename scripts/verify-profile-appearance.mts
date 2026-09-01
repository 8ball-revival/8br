/**
 * Profile appearance and historical dates: themes, avatars, and the year a match was played.
 *
 * ── What this is guarding ───────────────────────────────────────────────────────────────────────
 * Three things that are each one mistake away from being a real problem:
 *
 *   · A colour typed by a player ends up inside a `style` attribute. If "is this a colour" is
 *     answered loosely, that is a style-injection hole, so the parser is exercised against the
 *     things an attacker would actually send rather than against a happy path.
 *   · An uploaded avatar is a file from the internet. Its type must be decided from its bytes, not
 *     its name, and an animated file must survive the trip — a GIF that arrives animated and leaves
 *     as a single frame is a silent loss of what somebody uploaded.
 *   · A match date that reads "2026-08-20" for a 2005 match is not imprecise, it is false, and it
 *     sorted and filtered as though it were last week.
 *
 * Run:  npx tsx --tsconfig tsconfig.scripts.json scripts/verify-profile-appearance.mts
 */
import { readFileSync } from 'node:fs'
import sharp from 'sharp'
import { prisma } from '../src/lib/prisma.ts'
import { assertLocalDatabase } from '../src/lib/db-guard.ts'
import {
  DEFAULT_THEME, THEME_KEYS, contrast, parseHex, themeFromRow, themeVars, validateTheme,
} from '../src/lib/players/theme.ts'
import { ALLOWED_TYPES, looksLikeMarkup, safeFilename, sniffImageType, validateImage } from '../src/lib/media/validate.ts'
import { getPlayerProfilePage } from '../src/lib/players/profile.ts'
import { monogram } from '../src/components/players/profile/profile-avatar.tsx'

assertLocalDatabase()

let pass = 0, fail = 0
const check = (label: string, ok: boolean, detail?: string) => {
  if (ok) { pass++; console.log(`  ✓ ${label}`) }
  else { fail++; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`) }
}
const section = (t: string) => console.log(`\n--- ${t} ---`)

/** Source with comments stripped — these files describe the faults they fix in their own prose. */
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

// ── Theme validation ────────────────────────────────────────────────────────────────────────────
section('A profile colour is a hex value and nothing else')
{
  check('a six-digit hex is accepted', parseHex('#22d3ee') === '#22d3ee')
  check('a three-digit hex is expanded', parseHex('#2ae') === '#22aaee')
  check('case is normalised', parseHex('#22D3EE') === '#22d3ee')
  check('surrounding space is trimmed', parseHex('  #22d3ee ') === '#22d3ee')

  /*
    The refusals that matter. Each of these is a value that would otherwise reach a `style`
    attribute, and several are legal CSS that does something other than describe a colour.
  */
  for (const bad of [
    'red', 'rgb(255,0,0)', 'var(--gold)', 'url(http://x/y.png)',
    'transparent', '#22d3ee; background:url(x)', 'expression(alert(1))',
    '#gggggg', '#2', '#22d3e', '', '   ', 'javascript:alert(1)',
    '#22d3ee)', 'inherit', 'currentColor',
  ]) {
    check(`refused: ${JSON.stringify(bad)}`, parseHex(bad) === null)
  }
  check('a non-string is refused', parseHex(123 as unknown) === null && parseHex(null) === null)
}

section('A saved theme has to be readable')
{
  const ok = validateTheme(DEFAULT_THEME)
  check('the default theme validates', ok.ok === true)
  check('...and comes back normalised', ok.theme?.accent === DEFAULT_THEME.accent)

  const missing = validateTheme({ accent: '#22d3ee' })
  check('a partial theme is refused', missing.ok === false)
  check('...naming every missing field', Object.keys(missing.errors).length === THEME_KEYS.length - 1)

  /*
    Contrast is the point. A player may make an unusual profile; the profile is a public record other
    people read, so they may not make an unreadable one.
  */
  const unreadable = validateTheme({ ...DEFAULT_THEME, textPrimary: '#0d1420', panelSurface: '#0d1420' })
  check('text that matches its background is refused', unreadable.ok === false)
  check('...and the message points at the text field', 'textPrimary' in unreadable.errors)

  const invisibleMuted = validateTheme({ ...DEFAULT_THEME, textMuted: '#0e1521' })
  check('muted text too close to its background is refused', invisibleMuted.ok === false)

  const invisibleAccent = validateTheme({ ...DEFAULT_THEME, accent: '#0d1420' })
  check('an accent that cannot be seen is refused', invisibleAccent.ok === false)

  const badSurface = validateTheme({ ...DEFAULT_THEME, surface: '#e6edf5' })
  check('a profile background that swallows the text is refused', badSurface.ok === false)

  // A genuinely different but readable theme must be allowed — this is a customisation feature.
  const wild = validateTheme({
    accent: '#ff7ad9', accentSecondary: '#ffd166', surface: '#1a0620',
    panelSurface: '#2a0d33', border: '#5c2a66', textPrimary: '#ffffff', textMuted: '#d6b6de',
  })
  check('an unusual but readable theme is allowed', wild.ok === true, JSON.stringify(wild.errors))

  check('contrast maths is right (black on white)', Math.round(contrast('#000000', '#ffffff')) === 21)
}

section('The default theme is the house palette')
{
  /*
    The default is the site's own colours — the red the header and brand marks already use, on the
    two dark surfaces everything else sits on. A profile therefore looks like part of 8 Ball Registry
    before anybody customises it.
  */
  check('the accent is the brand red', DEFAULT_THEME.accent === '#ff2a2a')
  check('the surfaces are the site own dark greys',
    DEFAULT_THEME.surface === '#050607' && DEFAULT_THEME.panelSurface === '#07080a')
  check('the default itself passes the readability rules', validateTheme(DEFAULT_THEME).ok === true)

  // The stylesheet's fallbacks must not drift from the source of truth above.
  const css = readFileSync('src/app/(frontend)/player-profile.css', 'utf8')
  for (const [name, value] of [
    ['--pf-accent', DEFAULT_THEME.accent],
    ['--pf-surface', DEFAULT_THEME.surface],
    ['--pf-panel', DEFAULT_THEME.panelSurface],
    ['--pf-text', DEFAULT_THEME.textPrimary],
  ] as const) {
    check(`the CSS fallback for ${name} matches the default`, css.includes(`${name}: ${value};`))
  }

  /*
    The accent is spent on PLACE and on actions, not on every large number. Asserted because it is
    the difference between one figure standing out and eight competing.
  */
  const view = readFileSync('src/components/players/profile/profile-view.tsx', 'utf8')
  check('rank carries the accent', /label="Rank"[^/]*accent/.test(view))
  check('...and rating does not', /label="Rating" value=\{current \? String\(current\.rating\) : '—'\} \/>/.test(view))
  const headingRule = css.slice(css.indexOf('.pf-heading {'), css.indexOf('.pf-heading {') + 200)
  check('section headings sit in the text colour, not the accent',
    headingRule.includes('color: var(--pf-text)'))
}

section('A player can put their profile back to the default in one press')
{
  const header = readFileSync('src/components/players/profile/identity-header.tsx', 'utf8')
  check('the control exists', header.includes('Default Colours'))
  check('...beneath Edit Profile, for the same people', /canEdit && \(\s*<button[\s\S]{0,400}Default Colours/.test(header))
  check('...and calls the reset action', header.includes('resetProfileThemeAction(identity.playerId)'))
  check('...which re-establishes the right to do it server-side',
    readFileSync('src/lib/players/appearance-actions.ts', 'utf8')
      .includes('export async function resetProfileThemeAction'))
  check('a visitor never sees it', !/Default Colours/.test(header.replace(/canEdit && \([\s\S]*?\)\}/g, '')))
}

section('The theme reaches CSS only as scoped variables')
{
  const vars = themeVars(DEFAULT_THEME)
  check('every variable is namespaced', Object.keys(vars).every((k) => k.startsWith('--pf-')))
  /*
    Nothing may leave this object except colour values. If a raw player string could reach here it
    would be inside a `style` attribute on a public page.
  */
  check('every value is a hex colour or a hex with alpha',
    Object.values(vars).every((v) => /^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(v)),
    Object.entries(vars).filter(([, v]) => !/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(v)).join(','))

  const css = readFileSync('src/app/(frontend)/player-profile.css', 'utf8')
  const body = code(css)
  /*
    Scoping, asserted rather than assumed: every rule must be under `.pf-root` or one of the profile's
    own classes. A bare `body`, `:root` or element selector here would let one player's theme reach
    the rest of the site.
  */
  const selectors = body.split('}').map((b) => b.split('{')[0].trim()).filter(Boolean)
    .flatMap((s) => s.split(',').map((x) => x.trim()))
    .filter((s) => s && !s.startsWith('@') && !s.startsWith('/*'))
  const unscoped = selectors.filter((s) => !/^\.pf-/.test(s) && !/^\.pf/.test(s))
  check('no rule escapes the profile', unscoped.length === 0, unscoped.slice(0, 5).join(' | '))

  const view = readFileSync('src/components/players/profile/profile-view.tsx', 'utf8')
  check('the variables are set on the profile root only', view.includes('className="pf-root"') && view.includes('themeVars(identity.theme)'))

  check('a profile with no stored theme gets the default', themeFromRow(null).accent === DEFAULT_THEME.accent)
  check('a stored row with a bad value falls back rather than breaking',
    themeFromRow({ accent: 'not-a-colour' }).accent === DEFAULT_THEME.accent)
}

// ── Uploads ─────────────────────────────────────────────────────────────────────────────────────
section('An uploaded file is identified by its bytes')
{
  const png = await sharp({ create: { width: 8, height: 8, channels: 4, background: '#123456' } }).png().toBuffer()
  const jpg = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#123456' } }).jpeg().toBuffer()
  const webp = await sharp({ create: { width: 8, height: 8, channels: 4, background: '#123456' } }).webp().toBuffer()
  const avif = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#123456' } }).avif().toBuffer()
  const gif = await sharp({ create: { width: 8, height: 8, channels: 4, background: '#123456' } }).gif().toBuffer()

  check('PNG', sniffImageType(png) === 'image/png')
  check('JPEG', sniffImageType(jpg) === 'image/jpeg')
  check('WebP', sniffImageType(webp) === 'image/webp')
  check('AVIF', sniffImageType(avif) === 'image/avif', String(sniffImageType(avif)))
  check('GIF', sniffImageType(gif) === 'image/gif')
  check('AVIF is on the accepted list', (ALLOWED_TYPES as readonly string[]).includes('image/avif'))

  /*
    The whole point: a filename is not evidence. A PNG renamed `.jpg` is still a PNG, and an SVG
    called `.png` is still script.
  */
  const svg = Buffer.from('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')
  check('an SVG is recognised as markup', looksLikeMarkup(svg))
  check('...and is not an accepted type', sniffImageType(svg) === null)
  await check2('an SVG upload is refused outright', svg, /SVG|not a JPG/)

  const html = Buffer.from('<!doctype html><html><body>hi</body></html>')
  check('HTML is recognised as markup', looksLikeMarkup(html))
  await check2('an HTML upload is refused', html, /SVG|not a JPG/)

  await check2('an empty file is refused', Buffer.alloc(0), /empty/)
  await check2('random bytes are refused', Buffer.from('not an image at all, just text'), /not a JPG|could not/)

  // The stored name comes from the SNIFFED type, so a lying extension cannot survive.
  check('the stored extension follows the bytes, not the name',
    safeFilename('evil.php.jpg', 'image/png').endsWith('.png'))
  check('path separators are stripped from a stored name',
    !safeFilename('../../etc/passwd.png', 'image/png').includes('/'))
}

async function check2(label: string, input: Buffer, expect: RegExp) {
  try {
    await validateImage(input)
    check(label, false, 'it was accepted')
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    check(label, expect.test(msg), msg)
  }
}

section('An animated upload stays animated')
{
  /*
    Both fixtures are built by hand rather than by sharp.

    This libvips can READ animation but not write it — a two-frame GIF handed back through its own
    encoder comes out with one page. That is irrelevant to the feature, because an animated upload is
    passed through untouched and never re-encoded, but it does mean the test has to author its own
    files. Both are checked with sharp for `pages > 1` before they are used, so a fixture that failed
    to build fails the test rather than quietly proving nothing.
  */
  const animatedGif = buildAnimatedGif()
  const gifPages = (await sharp(animatedGif, { animated: true }).metadata()).pages ?? 1
  check('the animated GIF fixture really has frames', gifPages > 1, `pages=${gifPages}`)

  if (gifPages > 1) {
    const out = await validateImage(animatedGif)
    check('an animated GIF is reported as animated', out.animated === true)
    /*
      The guarantee. Re-encoding is exactly what flattens an animation to its first frame, so the
      bytes coming out must be the bytes that went in.
    */
    check('...and its bytes are passed through untouched', out.buffer.equals(animatedGif))
    check('...and it is stored as a GIF', out.extension === 'gif')
  }

  const animatedWebp = await buildAnimatedWebp()
  const webpPages = (await sharp(animatedWebp, { animated: true }).metadata()).pages ?? 1
  check('the animated WebP fixture really has frames', webpPages > 1, `pages=${webpPages}`)

  if (webpPages > 1) {
    const out = await validateImage(animatedWebp)
    /*
      The regression this closes. Animation used to be detected as "a GIF with more than one page",
      so an animated WebP fell through to the still path and was silently re-encoded to one frame —
      the upload succeeded and the animation was gone.
    */
    check('an animated WebP is reported as animated', out.animated === true)
    check('...and is NOT re-encoded to a single frame', out.buffer.equals(animatedWebp))
    check('...and is stored as a WebP', out.extension === 'webp')
  }

  // A still of the same format must still be re-encoded — that is what strips EXIF.
  const stillWebp = await sharp({ create: { width: 10, height: 10, channels: 4, background: '#00ff00' } }).webp().toBuffer()
  const still = await validateImage(stillWebp)
  check('a still WebP is not treated as animated', still.animated === false)
  check('...and IS re-encoded, which is the EXIF strip', !still.buffer.equals(stillWebp))
}

/**
 * A minimal two-frame GIF89a, with the NETSCAPE loop block a real animation carries.
 *
 * Written by hand because this libvips cannot encode one. Small enough to read: header, a two-colour
 * global palette, the loop extension, two identical 1x1 frames, terminator.
 */
function buildAnimatedGif(): Buffer {
  const b = (...n: number[]) => Buffer.from(n)
  const graphicControl = b(0x21, 0xF9, 0x04, 0x00, 0x0A, 0x00, 0x00, 0x00)
  const imageDescriptor = b(0x2C, 0, 0, 0, 0, 0x01, 0x00, 0x01, 0x00, 0x00)
  const lzwFrame = b(0x02, 0x02, 0x44, 0x01, 0x00)
  const frame = Buffer.concat([graphicControl, imageDescriptor, lzwFrame])
  return Buffer.concat([
    Buffer.from('GIF89a', 'latin1'),
    b(0x01, 0x00, 0x01, 0x00, 0x80, 0x00, 0x00),      // 1x1, global colour table of two
    b(0x00, 0x00, 0x00, 0xFF, 0xFF, 0xFF),            // black, white
    Buffer.concat([b(0x21, 0xFF, 0x0B), Buffer.from('NETSCAPE2.0', 'latin1'), b(0x03, 0x01, 0x00, 0x00, 0x00)]),
    frame, frame,
    b(0x3B),
  ])
}

/**
 * A real animated WebP: VP8X with the ANIM flag, an ANIM chunk, and two ANMF frames.
 *
 * The frame payload is a genuine VP8L chunk lifted from a still WebP that sharp encodes, so the
 * pixels are real rather than a stub the decoder might reject.
 */
async function buildAnimatedWebp(): Promise<Buffer> {
  const W = 16, H = 16
  const still = await sharp({ create: { width: W, height: H, channels: 4, background: '#ff0000' } })
    .webp({ lossless: true }).toBuffer()

  /** One RIFF sub-chunk, by four-character code. */
  const subChunk = (buf: Buffer, fourcc: string): Buffer | null => {
    let o = 12
    while (o + 8 <= buf.length) {
      const id = buf.subarray(o, o + 4).toString('latin1')
      const size = buf.readUInt32LE(o + 4)
      if (id === fourcc) return buf.subarray(o, o + 8 + size + (size % 2))
      o += 8 + size + (size % 2)
    }
    return null
  }
  const u24 = (n: number) => { const x = Buffer.alloc(3); x.writeUIntLE(n, 0, 3); return x }
  const riff = (id: string, payload: Buffer) => {
    const head = Buffer.alloc(8)
    head.write(id, 0, 'latin1')
    head.writeUInt32LE(payload.length, 4)
    return payload.length % 2 ? Buffer.concat([head, payload, Buffer.alloc(1)]) : Buffer.concat([head, payload])
  }

  const vp8l = subChunk(still, 'VP8L')
  if (!vp8l) throw new Error('could not read a VP8L chunk to build the fixture from')

  const anmf = () => riff('ANMF', Buffer.concat([
    u24(0), u24(0), u24(W - 1), u24(H - 1), u24(100), Buffer.from([0]), vp8l,
  ]))
  const body = Buffer.concat([
    Buffer.from('WEBP', 'latin1'),
    riff('VP8X', Buffer.concat([Buffer.from([0x02, 0, 0, 0]), u24(W - 1), u24(H - 1)])),
    riff('ANIM', Buffer.from([0, 0, 0, 0, 0, 0])),
    anmf(), anmf(),
  ])
  const size = Buffer.alloc(4)
  size.writeUInt32LE(body.length)
  return Buffer.concat([Buffer.from('RIFF', 'latin1'), size, body])
}

section('The avatar is framed in CSS, never cropped on the server')
{
  const actions = readFileSync('src/lib/players/appearance-actions.ts', 'utf8')
  const body = code(actions)
  /*
    If the upload path ever resized or extracted, an animated avatar would be flattened. The absence
    of those calls is the guarantee.
  */
  check('the upload does not resize, crop or extract',
    !/\.resize\(|\.extract\(|\.toFormat\(/.test(body))
  check('framing is stored as numbers, not applied to the file',
    body.includes('avatarFocalX') && body.includes('avatarZoom') && !/sharp/.test(body))
  check('framing values are clamped rather than trusted', body.includes('clamp('))

  const avatar = readFileSync('src/components/players/profile/profile-avatar.tsx', 'utf8')
  check('the crop is object-fit plus object-position', avatar.includes('objectPosition'))
  check('an animated avatar is not passed through the image optimiser', avatar.includes('<img'))
  check('reduced motion shows a still frame instead', avatar.includes('canvas') && avatar.includes('drawImage'))
  check('the preference is read as an external store, not mirrored into state',
    avatar.includes('useSyncExternalStore'))

  check('the monogram falls back to two letters', monogram('Starkiller') === 'ST')
  check('...and uses initials for a two-word name', monogram('Ada Lovelace') === 'AL')
  check('...and never returns an empty string', monogram('') === '?')

  const profile = readFileSync('src/lib/players/profile.ts', 'utf8')
  check('no avatar means no URL, so the monogram shows',
    profile.includes('avatarUrl: player.avatarFilename'))
}

section('Only the owner or player-management staff may change an appearance')
{
  const actions = readFileSync('src/lib/players/appearance-actions.ts', 'utf8')
  for (const fn of [
    'saveProfileThemeAction', 'resetProfileThemeAction',
    'uploadAvatarAction', 'setAvatarFramingAction', 'removeAvatarAction',
    'getProfileAppearanceAction',
  ]) {
    const at = actions.indexOf(`export async function ${fn}`)
    const slice = actions.slice(at, at + 400)
    check(`${fn} establishes rights before doing anything`,
      at !== -1 && /await rights\(playerId\)/.test(slice) && /verdict\.ok/.test(slice))
  }
  check('rights come from the shared rule, not a second copy',
    actions.includes("from './edit-rights'") && actions.includes('decideEditRights'))
  check('ownership still requires a VERIFIED link',
    readFileSync('src/lib/players/edit-rights.ts', 'utf8').includes("linkStatus === 'VERIFIED'"))

  const editor = readFileSync('src/components/players/profile/appearance-editor.tsx', 'utf8')
  check('the editor offers Save, Cancel and Reset to Default',
    editor.includes('>Save') || editor.includes('Saving…'))
  check('...Cancel restores what was there', editor.includes('original.current'))
  check('...Reset to Default exists', editor.includes('Reset to Default'))
  check('the preview writes to the live profile root', editor.includes(".querySelector<HTMLElement>('.pf-root')"))

  // The public profile must carry no customisation controls.
  const view = readFileSync('src/components/players/profile/profile-view.tsx', 'utf8')
  check('the editor is rendered only behind the server-decided flag',
    /\{canEdit && editing && \(/.test(view))
}

section('Theme storage is per profile')
{
  const rows = await prisma.playerProfileTheme.count()
  check('the theme table exists and is queryable', Number.isInteger(rows), String(rows))

  const players = await prisma.player.findMany({ take: 2, select: { id: true } })
  if (players.length === 2) {
    const [a, b] = players
    await prisma.playerProfileTheme.upsert({
      where: { playerId: a.id },
      create: { playerId: a.id, ...DEFAULT_THEME, accent: '#ff00ff' },
      update: { accent: '#ff00ff' },
    })
    const other = await prisma.playerProfileTheme.findUnique({ where: { playerId: b.id } })
    check('one player’s theme does not become another’s', other === null || other.accent !== '#ff00ff')
    /* Reset is a delete, so "no theme" and "a theme that matches the default" stay distinguishable. */
    await prisma.playerProfileTheme.delete({ where: { playerId: a.id } })
    check('deleting the row is a real reset',
      (await prisma.playerProfileTheme.findUnique({ where: { playerId: a.id } })) === null)
  }
}

// ── Historical dates ────────────────────────────────────────────────────────────────────────────
section('A match is dated when it was played, not when it was imported')
{
  const total = await prisma.ratingLedger.count()
  const withoutYear = await prisma.ratingLedger.count({ where: { occurredYear: null } })
  check('every ledger row knows its year', withoutYear === 0, `${withoutYear} of ${total}`)

  /*
    The invariant that makes the display honest: a YEAR-precision row must not be carrying a day,
    because a day it does not know is a day it must not print.
  */
  const yearWithDay = await prisma.ratingLedger.count({
    where: { datePrecision: 'YEAR', NOT: { occurredOn: null } },
  })
  check('no year-precision row holds an invented day', yearWithDay === 0, String(yearWithDay))

  // Every row's year must equal its competition's year — that is where it came from.
  const wrongYear = await prisma.$queryRawUnsafe<{ n: bigint }[]>(`
    SELECT count(*)::bigint AS n
      FROM "rating_ledger" l
      JOIN "season" s ON s."id" = l."seasonId"
     WHERE l."occurredYear" <> s."competitionYear"`)
  check('a season row carries its season’s year', Number(wrongYear[0].n) === 0, String(wrongYear[0].n))

  /*
    `completedAt` remains the audit trail and must NOT have been rewritten.

    Asserted by counting the archive rows whose stamp still falls in the import year: the correction
    changed what is displayed, not what was recorded, so every one of them should still carry it.
  */
  const yearRows = await prisma.ratingLedger.count({ where: { datePrecision: 'YEAR' } })
  const stillStamped = await prisma.$queryRawUnsafe<{ n: bigint }[]>(`
    SELECT count(*)::bigint AS n
      FROM "rating_ledger"
     WHERE "datePrecision" = 'YEAR'
       AND EXTRACT(YEAR FROM "completedAt") <> "occurredYear"`)
  check('the import timestamp is untouched on every corrected row',
    Number(stillStamped[0].n) === yearRows, `${stillStamped[0].n} of ${yearRows}`)

  const archive = await prisma.ratingLedger.findFirst({
    where: { datePrecision: 'YEAR' },
    select: { completedAt: true, occurredYear: true },
  })
  check('an archive row still holds its original import stamp',
    archive != null && archive.completedAt.getUTCFullYear() !== archive.occurredYear)
}

section('The profile prints the year, and orders by the real chronology')
{
  const busiest = await prisma.ratingLedger.groupBy({
    by: ['playerId'], _count: { playerId: true },
    orderBy: { _count: { playerId: 'desc' } }, take: 1,
  })
  const p = await prisma.player.findUnique({ where: { id: busiest[0].playerId }, select: { cueverseId: true, id: true } })
  const page = await getPlayerProfilePage(p?.cueverseId ?? p!.id)
  const matches = page!.matches

  const importStamped = matches.filter((m) => /^2026-08/.test(m.dateLabel) && !/2026/.test(m.competitionLabel))
  check('no archive match shows an August 2026 date', importStamped.length === 0, String(importStamped.length))

  const yearOnly = matches.filter((m) => m.datePrecision === 'YEAR')
  check('year-precision matches print exactly four digits',
    yearOnly.every((m) => /^\d{4}$/.test(m.dateLabel)), yearOnly[0]?.dateLabel)
  check('...and expose no day', yearOnly.every((m) => m.occurredOn === null))

  const dayKnown = matches.filter((m) => m.datePrecision === 'DAY')
  check('a match whose day is known keeps the full date',
    dayKnown.every((m) => /^\d{4}-\d{2}-\d{2}$/.test(m.dateLabel)))

  // The brief's example, checked literally.
  const example = matches.find((m) => /8BRCAM .*· 2005/.test(m.competitionLabel))
  if (example) check('a 2005 match displays as "2005"', example.dateLabel === '2005', example.dateLabel)

  /*
    Ordering. `sequence` is built by replaying competitions in competitionYear then number order, so
    it already IS the real chronology — the fix must not have disturbed it.
  */
  check('matches are newest first', matches.every((m, i) => i === 0 || matches[i - 1].sequence >= m.sequence))
  const years = matches.map((m) => m.occurredYear).filter((y): y is number => y != null)
  check('...and the years descend with them',
    years.every((y, i) => i === 0 || years[i - 1] >= y))

  check('head-to-head last-met dates use the same honest label',
    page!.headToHead.every((r) => /^\d{4}(-\d{2}-\d{2})?$/.test(r.lastMet) || r.lastMet === '—'))
}

section('The date fix survives a ledger rebuild')
{
  /*
    The ledger is deleted and rewritten on every competition close. A backfill alone would have been
    correct until the next tournament finished, so the builder has to write these columns too.
  */
  const ledger = readFileSync('src/lib/stats/ledger.ts', 'utf8')
  check('the builder sets the occurrence on every row', ledger.includes('...occurrence(mu.completedAt, c.year)'))
  check('...from the competition year it already sorts by', /function occurrence\(/.test(ledger))
  check('...and keeps the import stamp as well', ledger.includes('completedAt: mu.completedAt'))
  check('the timeline is still ordered by competition year then number',
    ledger.includes('a.year - b.year || a.num - b.num || a.id - b.id'))
}

section('Other date consumers no longer see the import stamp')
{
  const detail = readFileSync('src/lib/stats/rankings-detail.ts', 'utf8')
  check('recent form reads the occurrence', detail.includes('at: occurrenceLabel(r)'))
  check('the strongest win does too', detail.includes('at: occurrenceLabel(sw)'))
  check('the queries select the occurrence columns',
    (detail.match(/m\."occurredOn", m\."occurredYear", m\."datePrecision"/g) ?? []).length >= 1
    && detail.includes('me."occurredOn"'))

  const row = readFileSync('src/components/rankings/expanded-row.tsx', 'utf8')
  /*
    A bare year handed to `new Date()` becomes 1 January, which would announce a day nobody recorded.
  */
  check('a bare year is spoken as a year, not as 1 January', row.includes('spokenDate'))
}

// ── The things that must not have regressed ─────────────────────────────────────────────────────
section('The existing profile behaviour is intact')
{
  const cv = readFileSync('src/components/players/profile/cueverse-window.tsx', 'utf8')
  check('the replay iframe is still lazy', cv.includes('loading="lazy"'))
  check('...still minimally sandboxed', cv.includes('sandbox="allow-scripts allow-same-origin"'))
  check('...still unloads when left', cv.includes('setReplay(null)'))
  check('Back to Game History survives', cv.includes('Back to Game History'))
  check('Open on CueVerse survives', cv.includes('Open on CueVerse'))
  check('the game table still scrolls with a pinned heading',
    cv.includes('sticky top-0') && cv.includes('overflow-auto'))

  const links = readFileSync('src/lib/cueverse/links.ts', 'utf8')
  check('the CueVerse profile URL is unchanged',
    links.includes('/profile/?name=') && links.includes('encodeURIComponent(id)') && links.includes('game=${CUEVERSE_GAME}'))

  const expanding = readFileSync('src/components/players/profile/expanding-cards.tsx', 'utf8')
  check('View All still expands in place, without navigating', !/useRouter|next\/link/.test(expanding))
  check('Escape still closes a window', expanding.includes("e.key === 'Escape'"))
  check('reduced motion is still honoured', expanding.includes('reducedMotion()'))

  const h2h = readFileSync('src/components/players/profile/head-to-head-panel.tsx', 'utf8')
  check('Head to Head starts empty', h2h.includes('if (!opponent)'))
  check('...with a picker and an instruction', h2h.includes('OpponentPicker') && h2h.includes('Choose a player to compare'))
  check('...offering Change Player and Clear Comparison',
    h2h.includes('Change Player') && h2h.includes('Clear Comparison'))
  check('...and reusing the shared player search', h2h.includes('searchPlayersAction'))
  check('...with full keyboard support', h2h.includes('aria-activedescendant') && h2h.includes("e.key === 'ArrowDown'"))

  const nav = readFileSync('src/components/players/nav-player-search.tsx', 'utf8')
  check('the header search kept its keyboard behaviour',
    nav.includes('aria-activedescendant') && nav.includes("e.key === 'ArrowUp'") && nav.includes("e.key === 'Escape'"))
  check('...and is now compact and dark', nav.includes('h-7') && nav.includes('bg-black/60'))
  check('...still collapsing to an icon on small screens', nav.includes('md:hidden'))
}

section('The frame is decoration, and gives way before the layout does')
{
  const frame = readFileSync('src/components/players/profile/table-frame.tsx', 'utf8')
  check('the whole frame is hidden from assistive technology',
    (frame.match(/aria-hidden/g) ?? []).length >= 3)
  check('six pockets: four corners and two sides',
    (frame.match(/pf-pocket-(tl|tr|bl|br)/g) ?? []).length === 4
    && (frame.match(/pf-pocket-(top|bottom)\b/g) ?? []).length === 2)

  const css = code(readFileSync('src/app/(frontend)/player-profile.css', 'utf8'))
  check('the decoration is dropped on narrow screens',
    /@media \(max-width: 1023px\)[\s\S]{0,400}\.pf-rail \{ display: none/.test(css))
  check('no green felt anywhere', !/green|#0[0-9a-f]?[89a-f][0-9a-f]{3}\b/i.test(css.replace(/--pf-[a-z-]+/g, '')))
  check('the media is desaturated, so one file serves every theme', css.includes('saturate(0)'))
  check('there is one themed internal scrollbar', css.includes('.pf-scroll'))

  for (const asset of ['pocket-corner', 'pocket-side', 'rail']) {
    check(`${asset} is present as WebP and PNG`,
      readFileSync(`public/assets/table/${asset}.webp`).length > 0
      && readFileSync(`public/assets/table/${asset}.png`).length > 0)
    check(`...and the page prefers the WebP`, css.includes(`/assets/table/${asset}.webp`))
  }
}

await prisma.$disconnect()
console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
process.exitCode = fail === 0 ? 0 : 1
