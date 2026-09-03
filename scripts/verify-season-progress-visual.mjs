/**
 * Season Progress, checked in a real browser at real widths.
 *
 * ── Why this is separate from the Node suite ────────────────────────────────────────────────────
 * `verify-season-progress.mts` can prove what the data says and what the source says. It cannot
 * prove that fifteen rows fit, that the points column clears the scrollbar, that four hundred
 * pointer events cost one animation frame, or that hiding the tab stops the animation and showing
 * it again does not leave a second listener behind. Those are facts about a rendered page, and the
 * only honest way to check them is to render the page.
 *
 * ── Why it drives shoot.mjs rather than speaking CDP itself ─────────────────────────────────────
 * `shoot.mjs` already launches Chrome, sets a real layout viewport, waits for the page and
 * evaluates an expression. Reimplementing that here would be a second copy of the awkward part —
 * the part that took a while to get right — so this script only supplies the questions.
 *
 * Needs a dev server. Start one with `npm run dev:replica`, and seed the standings with
 * `scripts/fixture-season-progress.mts --up` so there is a table to measure.
 *
 * Run:  node scripts/verify-season-progress-visual.mjs [baseUrl]
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

const shots = mkdtempSync(join(tmpdir(), 'sp-visual-'))

/** Run one expression in the page at one width, and return whatever it evaluated to. */
function evaluate(width, height, expression, extraArgs = []) {
  return new Promise((resolve, reject) => {
    const args = [
      'scripts/shoot.mjs', BASE, join(shots, `w${width}.png`), String(width), String(height),
      `--eval=${expression}`, ...extraArgs,
    ]
    const child = spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    child.stdout.on('data', (d) => { out += d })
    child.stderr.on('data', (d) => { err += d })
    child.on('error', reject)
    child.on('close', (codeNum) => {
      if (codeNum !== 0) return reject(new Error(`shoot.mjs exited ${codeNum}: ${err.slice(0, 400)}`))
      /*
        The last JSON object printed. `shoot.mjs` also logs the file it wrote, and under
        `--measure` a second object, so taking the last line that parses is what makes this
        independent of how much else it decides to say.
      */
      const lines = out.trim().split('\n').reverse()
      for (const line of lines) {
        const t = line.trim()
        if (!t.startsWith('{') && !t.startsWith('"')) continue
        try {
          const v = JSON.parse(t)
          return resolve(typeof v === 'string' ? JSON.parse(v) : v)
        } catch { /* not this line */ }
      }
      /* stderr carries `eval threw:` from shoot.mjs, which is the only useful diagnosis here. */
      reject(new Error(`no JSON from shoot.mjs.
  stdout: ${out.slice(0, 300)}
  stderr: ${err.slice(0, 500)}`))
    })
  })
}

/*
  Everything measurable about the tile, in one expression.

  One evaluation per width rather than one per question: a page load is the expensive part, and
  asking twelve questions of the same rendered page costs nothing extra.
*/
const LAYOUT = `(() => {
  const p = document.querySelector('[data-sb-module="home-season-progress"] .sp-panel');
  if (!p) return JSON.stringify({ missing: true });
  const sc = p.querySelector('[role="region"]');
  const rows = [...p.querySelectorAll('tbody tr')];
  const head = p.querySelector('thead tr');
  const foot = p.querySelector('a[href^="/seasons/"]');
  const dl = p.querySelector('dl');
  const h2 = p.querySelector('h2');
  const rec = document.querySelector('[data-sb-module="home-record-feature"]');
  const pts = rows[0].querySelector('td:last-child');
  const sbW = sc.offsetWidth - sc.clientWidth;
  const rowH = rows[0].getBoundingClientRect().height;
  const headTopBefore = head.getBoundingClientRect().top;
  const footTopBefore = foot.getBoundingClientRect().top;
  const statsTop = dl.getBoundingClientRect().top;
  sc.scrollTop = sc.scrollHeight;
  const last = rows[rows.length - 1];
  const out = {
    viewport: innerWidth,
    panelW: Math.round(p.getBoundingClientRect().width),
    rowCount: rows.length,
    visibleRows: +(sc.clientHeight / rowH).toFixed(1),
    scrollable: sc.scrollHeight > sc.clientHeight,
    lastRowReachable: last.getBoundingClientRect().bottom <= sc.getBoundingClientRect().bottom + 2,
    lastRowText: last.querySelector('td:nth-child(2)').textContent.trim(),
    headerStayedPut: Math.abs(head.getBoundingClientRect().top - headTopBefore) < 2,
    footerStayedPut: Math.abs(foot.getBoundingClientRect().top - footTopBefore) < 2,
    statsStayedPut: Math.abs(dl.getBoundingClientRect().top - statsTop) < 2,
    statsOnTitleRow: Math.abs(statsTop - h2.getBoundingClientRect().top) < 14,
    statLabels: [...dl.querySelectorAll('dt')].map((d) => d.textContent.trim()),
    anyStatClipped: [...dl.querySelectorAll('div')].some((d) => d.scrollWidth > d.clientWidth + 1),
    gutterToScrollbar: Math.round((sc.getBoundingClientRect().right - sbW) - pts.getBoundingClientRect().right),
    scrollbarWidth: sbW,
    bottomAlignToRecord: rec ? Math.round(p.getBoundingClientRect().bottom - rec.getBoundingClientRect().bottom) : null,
    sectionStacked: rec ? rec.getBoundingClientRect().bottom < p.getBoundingClientRect().top : null,
    pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    leaderIsRowOne: rows[0].className.includes('sp-row-leader'),
    onlyOneLeader: rows.filter((r) => r.className.includes('sp-row-leader')).length,
    keyboardReachable: sc.tabIndex === 0,
    touchAction: getComputedStyle(sc).touchAction,
    decorativeHidden: ['.sp-frame', '.sp-glow', '.sp-spot']
      .every((s) => p.querySelector(s)?.getAttribute('aria-hidden') === 'true'),
    decorativeInert: ['.sp-frame', '.sp-glow', '.sp-spot']
      .every((s) => getComputedStyle(p.querySelector(s)).pointerEvents === 'none'),
  };
  sc.scrollTop = 0;
  return JSON.stringify(out);
})()`

/* Frame motion, the pointer budget, and what a hide/show cycle leaves behind. */
const MOTION = `(async () => {
  const p = document.querySelector('[data-sb-module="home-season-progress"] .sp-panel');
  const frame = p.querySelector('.sp-frame');
  const before = getComputedStyle(frame, '::before').transform;
  await new Promise((r) => setTimeout(r, 800));
  const after = getComputedStyle(frame, '::before').transform;

  let requested = 0;
  const raf = window.requestAnimationFrame;
  window.requestAnimationFrame = (cb) => { requested++; return raf(cb); };
  const box = p.getBoundingClientRect();
  for (let i = 0; i < 300; i++) {
    p.dispatchEvent(new PointerEvent('pointermove', {
      bubbles: true, clientX: box.left + 20 + (i % 200), clientY: box.top + 40 + (i % 60),
    }));
  }
  const framesForBurst = requested;
  await new Promise((r) => raf(() => raf(r)));
  const spotWritten = p.style.getPropertyValue('--pf-mx') !== '';
  window.requestAnimationFrame = raf;

  let net = 0;
  const addOrig = p.addEventListener.bind(p);
  const remOrig = p.removeEventListener.bind(p);
  p.addEventListener = (t, f, o) => { if (t === 'pointermove') net++; return addOrig(t, f, o); };
  p.removeEventListener = (t, f, o) => { if (t === 'pointermove') net--; return remOrig(t, f, o); };
  let state = 'visible';
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  const cycle = async (s) => {
    state = s;
    document.dispatchEvent(new Event('visibilitychange'));
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  };
  let stoppedWhenHidden = true;
  let resumedWhenVisible = true;
  let peak = 0;
  for (let i = 0; i < 5; i++) {
    await cycle('hidden');
    if (p.querySelector('.sp-frame-live')) stoppedWhenHidden = false;
    peak = Math.max(peak, net);
    await cycle('visible');
    if (!p.querySelector('.sp-frame-live')) resumedWhenVisible = false;
    peak = Math.max(peak, net);
  }
  delete document.visibilityState;
  p.addEventListener = addOrig;
  p.removeEventListener = remOrig;

  return JSON.stringify({
    reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
    frameHasLiveClass: !!p.querySelector('.sp-frame-live'),
    glowHasLiveClass: !!p.querySelector('.sp-glow-live'),
    frameAnimationName: getComputedStyle(frame, '::before').animationName,
    frameIsMoving: before !== after,
    frameStillPainted: getComputedStyle(frame, '::before').backgroundImage !== 'none',
    spotDisplay: getComputedStyle(p.querySelector('.sp-spot')).display,
    /* First place is a glowing number and handle now, not a surface — so that is what to look for. */
    leaderStillStyled: getComputedStyle(p.querySelector('.sp-row-leader .sp-pos')).textShadow !== 'none',
    leaderHasNoSurface: getComputedStyle(p.querySelector('.sp-row-leader')).boxShadow === 'none',
    pointerEvents: 300,
    framesForBurst,
    spotWritten,
    netListenersAfterCycles: net,
    peakListeners: peak,
    stoppedWhenHidden,
    resumedWhenVisible,
  });
})()`

try {
  section('Layout at every supported width')

  const widths = [
    { w: 1440, h: 1500, label: 'desktop' },
    { w: 1280, h: 1500, label: 'laptop' },
    { w: 1024, h: 1500, label: 'small laptop' },
    { w: 820, h: 2200, label: 'tablet' },
    { w: 390, h: 2600, label: 'phone' },
  ]

  for (const { w, h, label } of widths) {
    const r = await evaluate(w, h, LAYOUT)
    if (r.missing) { check(`${label} (${w}px): the panel is on the page`, false, 'not found'); continue }
    console.log(`\n  ${label} — ${w}px, tile ${r.panelW}px`)
    check('  no horizontal page overflow', r.pageOverflow === 0, `${r.pageOverflow}px`)
    check('  all 32 players are present', r.rowCount === 32, `${r.rowCount}`)
    check('  ...and the list scrolls to reach them', r.scrollable)
    check('  ...with the last row reachable', r.lastRowReachable, r.lastRowText)
    check('  the column headings stay put while the body scrolls', r.headerStayedPut)
    check('  ...as does the footer link', r.footerStayedPut)
    check('  ...and the header statistics', r.statsStayedPut)
    check('  the four statistics are all present', r.statLabels.join(',') === 'Groups,Players,Matches,Qualified', r.statLabels.join(','))
    check('  ...and none is clipped', !r.anyStatClipped)
    /*
      Ten to sixteen pixels was the brief. Measured to the scrollbar's inner edge rather than the
      container's, because the container's right edge is UNDER the scrollbar — measuring there
      would report a gutter the reader cannot see.
    */
    check('  the points column clears the scrollbar by 10-16px', r.gutterToScrollbar >= 10 && r.gutterToScrollbar <= 16, `${r.gutterToScrollbar}px`)
    check('  exactly one row carries the first-place treatment', r.onlyOneLeader === 1, `${r.onlyOneLeader}`)
    check('  ...and it is the top row', r.leaderIsRowOne)
    check('  the standings area is reachable by keyboard', r.keyboardReachable)
    check('  ...and scrollable by touch', r.touchAction === 'auto', r.touchAction)
    check('  the decorative layers are hidden from assistive technology', r.decorativeHidden)
    check('  ...and never intercept a pointer', r.decorativeInert)
    if (r.sectionStacked === false) {
      check('  the tile still ends level with the record feature', r.bottomAlignToRecord === 0, `${r.bottomAlignToRecord}px`)
      check('  about fifteen rows are visible', r.visibleRows >= 13 && r.visibleRows <= 17, `${r.visibleRows}`)
      /*
        Beside the title where there is room for it, wrapped underneath where there is not.

        The threshold is the tile's width, not the viewport's: at 1024 the three-column homepage
        leaves this tile 302px, which is narrower than the same tile on a 390px PHONE, where it is
        full width. Asserting "always beside the title" failed there and was the assertion being
        wrong rather than the layout — the requirement is that the strip reorganises cleanly, and
        the checks above already prove nothing is clipped or crushed wherever it lands.
      */
      if (r.panelW >= 360) {
        check('  the statistics sit beside the title', r.statsOnTitleRow, `tile ${r.panelW}px`)
      } else {
        check('  the statistics wrap below the title on a narrow tile', !r.statsOnTitleRow, `tile ${r.panelW}px`)
      }
    } else {
      // Stacked: there is no neighbour to align with, and the strip is expected to wrap.
      check('  the standings stay internally bounded when stacked', r.visibleRows >= 8 && r.visibleRows < r.rowCount, `${r.visibleRows}`)
    }
  }

  section('Motion, and what it costs')

  const m = await evaluate(1440, 1500, MOTION)
  check('the frame light travels', m.frameIsMoving)
  check('...driven by the CSS animation', m.frameAnimationName === 'sp-frame-travel', m.frameAnimationName)
  check('...on both the frame and its glow', m.frameHasLiveClass && m.glowHasLiveClass)
  check('300 pointer events cost exactly one animation frame', m.framesForBurst === 1, `${m.framesForBurst}`)
  check('...and still move the light', m.spotWritten)
  check('the animation stops while the tab is hidden', m.stoppedWhenHidden)
  check('...and resumes when it returns', m.resumedWhenVisible)
  check('five hide/show cycles leave no listener behind', m.netListenersAfterCycles === 0, `${m.netListenersAfterCycles}`)
  check('...and never stack more than one', m.peakListeners <= 1, `${m.peakListeners}`)

  section('Reduced motion keeps the polish and drops the movement')

  const rm = await evaluate(1440, 1500, MOTION, ['--reduced-motion'])
  check('the preference is being emulated', rm.reducedMotion)
  check('the travelling classes are removed', !rm.frameHasLiveClass && !rm.glowHasLiveClass)
  check('...and the CSS animation with them', rm.frameAnimationName === 'none', rm.frameAnimationName)
  check('the frame is nonetheless still drawn', rm.frameStillPainted)
  check('first place keeps its neon glow', rm.leaderStillStyled)
  check('...and still draws no bar or wash behind the row', rm.leaderHasNoSurface)
  check('the cursor pool is switched off entirely', rm.spotDisplay === 'none', rm.spotDisplay)
} finally {
  rmSync(shots, { recursive: true, force: true })
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
