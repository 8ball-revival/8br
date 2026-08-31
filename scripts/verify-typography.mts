/**
 * Typography, checked mechanically.
 *
 * ── Why this is not a design review ─────────────────────────────────────────────────────────────
 * "Is the type good" is a judgement. These are not: a weight the loaded face does not have, a label
 * below the size anybody can read, a numeric column that shifts as its digits change, a line box too
 * short for the glyphs in it. Each is a measurable property of a rendered page, each has a specific
 * failure a reader would notice, and each is the kind of thing that arrives quietly with a theme
 * change and is never looked at again.
 *
 * Run: npm run test:typography (with the dev server up)
 */

import { launch, sleep } from './browser/driver.mjs'

let pass = 0
let fail = 0
const failures: string[] = []
const check = (label: string, ok: boolean, detail?: string) => {
  if (ok) { pass++; console.log(`  ok   ${label}`) }
  else { fail++; failures.push(label); console.log(`  FAIL ${label}${detail ? ` -- ${detail}` : ''}`) }
}
const section = (t: string) => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 66 - t.length))}`)

const ROUTES = ['/', '/rankings', '/yahoo', '/seasons', '/the-break', '/achievements']

/**
 * The weights each family actually ships, so a faux-bold can be detected.
 *
 * `next/font` loads exactly what was asked for. Asking the browser for 800 from a family that has
 * only 400 and 700 gets a synthesised weight — the glyphs are smeared rather than drawn, which on a
 * condensed face at 96px is unmistakable and at 11px is just muddy.
 */
const LOADED = `(function () {
  var out = {};
  try {
    for (var i = 0; i < document.fonts.size; i++) {}
    document.fonts.forEach(function (f) {
      var fam = f.family.replace(/^['"]|['"]$/g, '');
      (out[fam] = out[fam] || []).push(String(f.weight) + (f.style === 'italic' ? 'i' : ''));
    });
  } catch (e) {}
  return out;
})()`

const TYPO = `(function () {
  var seen = {}, rows = [];
  [].slice.call(document.querySelectorAll('main *, header *, footer *')).forEach(function (el) {
    if (el.children.length > 0) return;
    var t = (el.textContent || '').trim();
    if (!t) return;
    var r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return;
    var cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') return;

    var size = parseFloat(cs.fontSize);
    var weight = parseInt(cs.fontWeight, 10) || 400;
    var family = cs.fontFamily.split(',')[0].replace(/^['"]|['"]$/g, '');
    var spacing = cs.letterSpacing === 'normal' ? 0 : parseFloat(cs.letterSpacing);
    var lh = cs.lineHeight === 'normal' ? size * 1.2 : parseFloat(cs.lineHeight);
    var transform = cs.textTransform;
    var variant = cs.fontVariantNumeric;

    var key = family + '|' + size + '|' + weight + '|' + spacing + '|' + lh + '|' + transform;
    if (seen[key]) return;
    seen[key] = 1;

    rows.push({
      text: t.slice(0, 28), family: family, size: Math.round(size * 10) / 10, weight: weight,
      spacing: Math.round(spacing * 100) / 100, lh: Math.round(lh * 10) / 10,
      transform: transform, variant: variant,
      // A numeric run: something whose visible text is mostly digits.
      numeric: /^[\\s0-9.,%:+\\u2013-]+$/.test(t) && /[0-9]/.test(t),
      /*
        A line box shorter than the type in it.

        Allowed above 32px: at display sizes a tight line box is a typographic decision, and the
        figures and capitals this design sets that large have no descenders to clip. Below that it
        is a fault -- body copy in a line box under 95% of its size loses the tails of its glyphs.
      */
      tight: lh > 0 && lh < size * 0.95 && size < 32,
      cls: String(el.className || '').slice(0, 40)
    });
  });
  return rows;
})()`

const b = await launch()
try {
  await b.viewport(1440, 900, false)
  await b.goto('/', 14000)
  await sleep(1500)

  section('The faces the page actually loaded')
  const loaded = await b.eval(LOADED) as Record<string, string[]>
  for (const [family, weights] of Object.entries(loaded)) {
    console.log(`   ${family}: ${[...new Set(weights)].sort().join(', ')}`)
  }
  const barlow = Object.keys(loaded).find((f) => /Barlow/i.test(f))
  check('the condensed display face is loaded', barlow != null, Object.keys(loaded).join(', '))
  if (barlow) {
    const w = new Set(loaded[barlow].map((x) => x.replace('i', '')))
    check('...with every weight the design uses (600, 700, 800)',
      ['600', '700', '800'].every((n) => w.has(n)), [...w].join(', '))
    check('...and a real italic rather than a sheared roman',
      loaded[barlow].some((x) => x.endsWith('i')), loaded[barlow].join(', '))
  }

  const all: Record<string, unknown>[] = []
  for (const route of ROUTES) {
    await b.goto(route, 14000)
    await sleep(900)
    const rows = await b.eval(TYPO) as Record<string, unknown>[]
    for (const r of rows) all.push({ ...r, route })
  }

  section(`Measured ${all.length} distinct type treatments across ${ROUTES.length} routes`)

  // ── Faux bold ─────────────────────────────────────────────────────────────────────────────────
  /*
    A variable font reports a RANGE, not a weight.

    `document.fonts` gives "100 900" for a variable face, and reading that as a single number made
    every weight of Inter look synthesised. So each entry is parsed as either a point or a span, and
    a weight is available if any entry covers it.
  */
  const availableFor = (family: string) => {
    const hit = Object.keys(loaded).find((f) => f.toLowerCase() === family.toLowerCase())
    if (!hit) return null
    return loaded[hit].map((raw) => {
      const parts = raw.replace('i', '').trim().split(/\s+/).map(Number).filter(Number.isFinite)
      return parts.length >= 2 ? { lo: parts[0], hi: parts[1] } : { lo: parts[0], hi: parts[0] }
    })
  }
  const faux = all.filter((r) => {
    const avail = availableFor(String(r.family))
    // Only families this page loaded itself can be judged; a system stack is not our business.
    if (avail == null || avail.length === 0) return false
    const w = Number(r.weight)
    return !avail.some((range) => w >= range.lo && w <= range.hi)
  })
  check('no synthesised weight (faux bold)', faux.length === 0,
    JSON.stringify(faux.slice(0, 5).map((r) => `${r.family} ${r.weight} "${r.text}"`)))

  // ── Sizes a reader can actually resolve ───────────────────────────────────────────────────────
  const tiny = all.filter((r) => Number(r.size) < 10)
  check('nothing is set below 10px', tiny.length === 0,
    JSON.stringify(tiny.slice(0, 5).map((r) => `${r.size}px "${r.text}" ${r.route}`)))

  /*
    Small uppercase with wide tracking is the hardest combination on this site to read, and the one
    the design uses most. Held to a floor: at or below 11px it must carry real weight, because a
    letterspaced 10px 400 in capitals is a row of shapes rather than a word.
  */
  const weakCaps = all.filter((r) =>
    r.transform === 'uppercase' && Number(r.size) <= 11 && Number(r.weight) < 600)
  check('small uppercase labels carry enough weight', weakCaps.length === 0,
    JSON.stringify(weakCaps.slice(0, 5).map((r) => `${r.size}px/${r.weight} "${r.text}" ${r.route}`)))

  const overTracked = all.filter((r) => Number(r.spacing) > Number(r.size) * 0.4)
  check('no letter spacing wide enough to break a word apart', overTracked.length === 0,
    JSON.stringify(overTracked.slice(0, 5).map((r) => `${r.spacing}px on ${r.size}px "${r.text}"`)))

  // ── Line boxes ────────────────────────────────────────────────────────────────────────────────
  const clipped = all.filter((r) => r.tight === true)
  check('no line box shorter than the type in it', clipped.length === 0,
    JSON.stringify(clipped.slice(0, 5).map((r) => `${r.size}px in ${r.lh}px "${r.text}" ${r.route}`)))

  // ── Numbers that have to line up ──────────────────────────────────────────────────────────────
  const wobbly = all.filter((r) =>
    r.numeric === true && Number(r.size) >= 12
    && !String(r.variant).includes('tabular-nums')
    && (r.route === '/rankings' || r.route === '/yahoo'))
  check('every statistic in a ranking table uses tabular figures', wobbly.length === 0,
    JSON.stringify(wobbly.slice(0, 6).map((r) => `"${r.text}" ${r.cls} ${r.route}`)))

  // ── Families ──────────────────────────────────────────────────────────────────────────────────
  const families = [...new Set(all.map((r) => String(r.family)))]
  check('the site is set in a small number of families', families.length <= 5, families.join(', '))

  section('And the swap does not move anything')
  /*
    Layout shift from a font swap, measured rather than assumed.

    The fallback is declared with `size-adjust` so a heading occupies the same box before and after
    the webfont arrives. This measures a condensed heading, forces the fallback, and measures again:
    a metric-matched pair differs by a percent or two, an unmatched one by a third.
  */
  await b.goto('/', 14000)
  await sleep(1500)
  const shift = await b.eval(`(function () {
    var h = document.querySelector('h1');
    if (!h) return null;
    var before = h.getBoundingClientRect();
    var prev = h.style.fontFamily;
    h.style.fontFamily = "'Barlow Condensed Fallback', sans-serif";
    var after = h.getBoundingClientRect();
    h.style.fontFamily = prev;
    return { w: Math.round(before.width), fw: Math.round(after.width),
             h: Math.round(before.height), fh: Math.round(after.height) };
  })()`)
  if (shift) {
    const dw = Math.abs(shift.w - shift.fw) / shift.w
    const dh = Math.abs(shift.h - shift.fh) / shift.h
    check('the fallback is metric-matched to within 12% of width', dw < 0.12, `${(dw * 100).toFixed(1)}%`)
    check('...and of height', dh < 0.12, `${(dh * 100).toFixed(1)}%`)
  } else {
    check('a heading was found to measure', false)
  }
} finally {
  await b.close()
}

console.log(`\n${'═'.repeat(74)}`)
if (fail) {
  console.log(`\n${fail} FAILED:\n`)
  for (const f of failures) console.log(`  x ${f}`)
}
console.log(`\n${pass} checks passed, ${fail} failed\n`)
process.exit(fail ? 1 : 0)
