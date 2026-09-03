/**
 * The site's finish: smoked glass everywhere, brushed metal nowhere.
 *
 * ── Why this is a rendered audit rather than a grep ─────────────────────────────────────────────
 * "No brushed metal anywhere" is a claim about what a browser paints, and a stylesheet cannot answer
 * it. A rule can be present and overridden, absent and inherited, or reachable only in a state
 * nobody thought to look at. So this walks every element on every major route, reads the COMPUTED
 * background of the element and both its pseudo-elements, and looks for the two shapes that make a
 * surface read as metal:
 *
 *   · directional streaking — a repeating gradient at or near the horizontal or vertical;
 *   · a cross-sheen — four or more stops running across an element, light in the middle, which is
 *     how a turned or brushed face catches a light.
 *
 * ── The one exception, named rather than hidden ─────────────────────────────────────────────────
 * The Groups progress rail carries a highlight that travels across the COMPLETED portion of the bar.
 * It matches the cross-sheen shape because it is a moving light, which is the point of it — it marks
 * progress rather than describing a material, it is confined to the red fill, and the design brief
 * asked for it. It is allow-listed by class here so the check stays meaningful: anything else
 * matching these shapes is a regression.
 *
 * Run:  node scripts/verify-glass-finish.mjs [baseUrl]
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const BASE = process.argv[2] ?? process.env.VERIFY_BASE_URL ?? 'http://localhost:3000'

let pass = 0
let fail = 0
const check = (label, ok, detail) => {
  if (ok) { pass++; console.log(`  ✓ ${label}`) }
  else { fail++; console.log(`  ✗ ${label}${detail !== undefined ? ` — ${detail}` : ''}`) }
}
const section = (t) => console.log(`\n--- ${t} ---`)

const shots = mkdtempSync(join(tmpdir(), 'glass-'))

function evaluate(url, width, height, expression) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      'scripts/shoot.mjs', `${BASE}${url}`, join(shots, 'x.png'), String(width), String(height),
      `--eval=${expression}`,
    ], { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    child.stdout.on('data', (d) => { out += d })
    child.stderr.on('data', (d) => { err += d })
    child.on('error', reject)
    child.on('close', (c) => {
      if (c !== 0) return reject(new Error(`shoot.mjs exited ${c}: ${err.slice(0, 300)}`))
      for (const line of out.trim().split(/[\r\n]+/).reverse()) {
        const t = line.trim()
        if (!t.startsWith('{') && !t.startsWith('"')) continue
        try {
          const v = JSON.parse(t)
          return resolve(typeof v === 'string' ? JSON.parse(v) : v)
        } catch { /* not this line */ }
      }
      reject(new Error(`no JSON.\n  stdout: ${out.slice(0, 250)}\n  stderr: ${err.slice(0, 300)}`))
    })
  })
}

/*
  Allow-listed, and each for a stated reason.

  · `gb-rail-fill` — the Groups progress highlight. A moving light marking completion, confined to
    the red fill, asked for by the design. It matches the cross-sheen shape because it IS a light.
  · `opacity-[0.18]` — the scanline-and-grid overlay on the Table Clear video tile. A CRT motif at
    eighteen percent over a video, not a material on a surface, and the brief protects intentional
    decorative elements explicitly.

  Anything else matching the metal shapes is a regression.
*/
const ALLOWED = ['gb-rail-fill', 'opacity-[0.18]']

const AUDIT = `(() => {
  const metal = [];
  const allowed = ${JSON.stringify(ALLOWED)};
  const seen = new Set();
  for (const el of document.querySelectorAll('body *')) {
    const cls = String(el.className || '');
    for (const pseudo of [null, '::before', '::after']) {
      const s = getComputedStyle(el, pseudo);
      const bg = s.backgroundImage || '';
      if (bg === 'none' || !bg) continue;
      const streaky = /repeating-linear-gradient\\((?:90deg|270deg|0deg|180deg)/.test(bg);
      const crossSheen = /linear-gradient\\((?:90deg|to right)[^)]*,[^)]*,[^)]*,[^)]*,/.test(bg);
      if (!streaky && !crossSheen) continue;
      const isAllowed = allowed.some((a) => cls.includes(a));
      const key = cls + '|' + pseudo + '|' + bg.slice(0, 50);
      if (seen.has(key)) continue;
      seen.add(key);
      (isAllowed ? (metal.allowed ||= []) : metal).push({
        tag: el.tagName, cls: cls.slice(0, 60), pseudo: pseudo || 'element', bg: bg.slice(0, 120),
      });
    }
  }
  const panels = [...document.querySelectorAll(
    '.gb-board,.gb-panel,.pf-panel,.dl-surface,.cyber-panel,.glass-surface,.glass-surface-raised')];
  const alphas = panels.map((p) => {
    const c = getComputedStyle(p).backgroundColor;
    if (!c.startsWith('rgba')) return 1;
    return +Number(c.slice(c.indexOf('(') + 1, c.indexOf(')')).split(',')[3]).toFixed(2);
  });
  /*
    Contrast, measured against the surface each element ACTUALLY sits on.

    The first version compared every text colour to the body element, which on this site is
    transparent -- so both sides of the ratio came out the same and it reported 1:1 for perfectly
    legible text. Walking up for the nearest opaque ancestor is what makes the number mean something.

    Invisible and decorative elements are skipped: a zero-sized node, a visually-hidden label and an
    element with transparent text all have contrast figures that describe nothing.

    No backticks anywhere in this comment: the whole expression is carried into the page inside a
    template literal, and one would end it here.
  */
  /* Parsed with the closing paren removed -- without it the alpha reads NaN and every guard below
     silently passes. That is what made gradient-filled text report a 1:1 ratio. */
  const parse = (c) => (c || '').slice((c || '').indexOf('(') + 1).replace(')', '').split(',').map(Number);
  const lum = (c) => {
    const p = parse(c);
    if (p.length > 3 && !(p[3] > 0)) return null;
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(p[0]) + 0.7152 * f(p[1]) + 0.0722 * f(p[2]);
  };
  const groundOf = (el) => {
    for (let n = el; n; n = n.parentElement) {
      const c = getComputedStyle(n).backgroundColor;
      if (!c || c === 'transparent') continue;
      const parts = parse(c);
      if (parts.length > 3 && !(parts[3] >= 0.5)) continue;
      return c;
    }
    return 'rgb(5, 6, 7)';
  };
  const sample = [...document.querySelectorAll('p,td,th,li,h1,h2,h3,a,span')]
    .filter((el) => {
      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) return false;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.opacity === '0') return false;
      /*
        Gradient-filled text is skipped, not failed.

        A wordmark painted with background-clip has a transparent color and takes its appearance
        from a gradient behind the glyphs. There is no foreground colour to measure, so a ratio
        computed from one describes nothing.
      */
      if (cs.webkitBackgroundClip === 'text' || cs.backgroundClip === 'text') return false;
      /*
        Decoration hidden from assistive technology is not text.

        The separators between the group-header facts are aria-hidden middots whose whole job is to
        be faint. A contrast rule exists to protect what people READ, and something explicitly
        removed from the accessibility tree is not that.
      */
      if (el.closest('[aria-hidden="true"]')) return false;
      if (!(parse(cs.color)[3] > 0) && parse(cs.color).length > 3) return false;
      /* Only leaves: a wrapper's colour is not the colour anybody reads. */
      return el.children.length === 0 && (el.textContent || '').trim().length > 0;
    })
    .slice(0, 80);
  const ratios = sample.map((el) => {
    const fg = lum(getComputedStyle(el).color);
    const bg = lum(groundOf(el));
    if (fg == null || bg == null) return null;
    const [hi, lo] = fg > bg ? [fg, bg] : [bg, fg];
    return { ratio: +((hi + 0.05) / (lo + 0.05)).toFixed(2), color: getComputedStyle(el).color };
  }).filter((r) => r != null && Number.isFinite(r.ratio));
  /*
    Repeating line textures, measured in the RENDERED page rather than searched for in CSS.

    This is the check the first pass needed and did not have. The site's brushed look came from a
    repeating linear gradient painting a 1px line every 3px, from a fixed body::before at
    z-index 9999 — a layer no CSS search for the word "brushed" would ever have found, and one that
    sat above every panel, so no surface colour could hide it.

    So: walk every element and pseudo-element, find each repeating gradient actually being painted,
    and read its period out of the computed value. Anything repeating inside ~14px is texture. The
    one legitimate exception is the group board's 45deg hatch, which is semantic — it marks a cell
    where no fixture can exist — and the user asked for it to stay.
  */
  const linePattern = [];
  for (const el of document.querySelectorAll('*')) {
    for (const p of [null, '::before', '::after']) {
      const cs = getComputedStyle(el, p);
      const bgi = cs.backgroundImage;
      if (!bgi || bgi === 'none' || !bgi.includes('repeating-linear-gradient')) continue;
      const seg = bgi.slice(bgi.indexOf('repeating-linear-gradient'));
      const stops = [...seg.matchAll(/([0-9.]+)px/g)].map((m) => Number(m[1])).slice(0, 6);
      const period = stops.length ? Math.max(...stops) : 999;
      const cls = String(el.className || '');
      /* The semantic self-match hatch, explicitly kept. */
      if (cls.includes('gb-diag')) continue;
      if (period <= 14) {
        linePattern.push({ cls: cls.slice(0, 44), pseudo: p || 'element', periodPx: period,
                           z: cs.zIndex, pos: cs.position });
      }
    }
  }
  return JSON.stringify({
    lineCount: linePattern.length,
    lines: linePattern.slice(0, 5),
    metalCount: metal.length,
    metal: metal.slice(0, 5),
    allowedCount: (metal.allowed || []).length,
    panels: panels.length,
    minAlpha: alphas.length ? Math.min(...alphas) : null,
    minContrast: ratios.length ? Math.min(...ratios.map((r) => r.ratio)) : null,
    /*
      The brand red, separated out.

      rgb(224, 16, 33) on void black is 4.12:1 — just under AA for body text, and a pre-existing
      brand decision this pass was told to preserve. It is reported on its own rather than dragging
      the page minimum down, so a genuine regression in ordinary text still shows.
    */
    minContrastExcludingBrand: (() => {
      const rest = ratios.filter((r) => !r.color.includes('224, 16, 33'));
      return rest.length ? Math.min(...rest.map((r) => r.ratio)) : null;
    })(),
    brandLinkRatio: (() => {
      const brand = ratios.filter((r) => r.color.includes('224, 16, 33'));
      return brand.length ? Math.min(...brand.map((r) => r.ratio)) : null;
    })(),
    pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    glassTokenPresent: getComputedStyle(document.documentElement).getPropertyValue('--glass-highlight').trim().length > 0,
  });
})()`

const ROUTES = [
  '/', '/seasons/16427', '/rankings', '/players', '/yahoo', '/the-break', '/tournaments',
  '/achievements', '/players/Starkiller',
]

try {
  for (const width of [1500, 820, 390]) {
    section(`Every route at ${width}px`)
    for (const route of ROUTES) {
      const r = await evaluate(route, width, 1400, AUDIT)
      const label = `  ${route}`
      check(`${label}: nothing paints a repeating line texture`, r.lineCount === 0,
        r.lineCount ? JSON.stringify(r.lines) : 'none')
      check(`${label}: no brushed, streaked or machined surface`, r.metalCount === 0,
        r.metal.map((m) => `${m.cls || m.tag}${m.pseudo === 'element' ? '' : m.pseudo}`).join(', '))
      /*
        `/rankings` overflows by 153px at 390px, and did so before this work — verified by measuring
        it with these stylesheets stashed. It is recorded here rather than excluded, so the number is
        visible and any change to it shows up as a failure.
      */
      const knownOverflow = route === '/rankings' && width === 390 ? 153 : 0
      check(`${label}: no new horizontal overflow`, r.pageOverflow === knownOverflow,
        `${r.pageOverflow}px${knownOverflow ? ` (pre-existing ${knownOverflow}px)` : ''}`)
      /*
        Substantially opaque. A surface below 0.9 would start letting the page grid read through the
        content sitting on it, which is the readability half of this change.
      */
      if (r.panels > 0) {
        /* 0.97 is the floor at which the page grid stops being legible through a panel interior. */
        check(`${label}: its ${r.panels} panels stay opaque enough to hide the grid`,
          r.minAlpha >= 0.97, `${r.minAlpha}`)
      }
      /*
        WCAG AA for body text is 4.5:1, sampled from the real rendered colours.

        The brand red is measured separately: at 4.12:1 on void it sits just under, and it is a
        pre-existing brand colour this pass was explicitly told not to change. Reporting it apart
        keeps the main figure honest about ordinary text.
      */
      if (r.minContrastExcludingBrand != null) {
        check(`${label}: text keeps readable contrast`, r.minContrastExcludingBrand >= 4.5,
          `${r.minContrastExcludingBrand}:1`)
      }
      if (r.brandLinkRatio != null) {
        check(`${label}: the brand red is unchanged at its known ratio`,
          r.brandLinkRatio >= 4.1 && r.brandLinkRatio <= 4.2, `${r.brandLinkRatio}:1 (pre-existing)`)
      }
      check(`${label}: the shared glass tokens are in scope`, r.glassTokenPresent)
    }
  }

  section('The one preserved highlight')
  const seasons = await evaluate('/seasons/16427', 1500, 1400, AUDIT)
  check('the progress rail keeps its travelling highlight', seasons.allowedCount >= 1,
    `${seasons.allowedCount}`)
  /*
    The allow-list stays short and every entry stays named.

    Two today, both decorative lights rather than materials. The check is on the SIZE because the
    failure mode for a list like this is quiet growth — one more exception each time something is
    awkward, until it excuses everything it was meant to catch.
  */
  check('...and the allow-list is still short and deliberate', ALLOWED.length <= 2, ALLOWED.join(', '))
} finally {
  rmSync(shots, { recursive: true, force: true })
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
