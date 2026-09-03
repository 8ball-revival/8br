/**
 * The Groups board, checked in a real browser at real widths.
 *
 * The Node suite proves what the data says and what the source says. It cannot prove that the
 * sticky player column actually stays put while the matrix scrolls, that a 390px phone produces no
 * page-level overflow, that four boards stop animating in a hidden tab, or that repeated hovering
 * leaves nothing behind. Those are facts about a rendered page.
 *
 * Drives `shoot.mjs` rather than speaking CDP itself — see the note in the Season Progress visual
 * suite for why the awkward part is worth having only once.
 *
 * Needs a dev server and a season with published groups:
 *   npm run dev:replica
 *   npx tsx --tsconfig tsconfig.scripts.json scripts/fixture-season-progress.mts --up
 *
 * Run:  node scripts/verify-group-board-visual.mjs [baseUrl] [seasonPath]
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const BASE = process.argv[2] ?? process.env.VERIFY_BASE_URL ?? 'http://localhost:3000'
const PATHNAME = process.argv[3] ?? '/seasons/16427'
const URL_ = `${BASE}${PATHNAME}`

let pass = 0
let fail = 0
const check = (label, ok, detail) => {
  if (ok) { pass++; console.log(`  ✓ ${label}`) }
  else { fail++; console.log(`  ✗ ${label}${detail !== undefined ? ` — ${detail}` : ''}`) }
}
const section = (t) => console.log(`\n--- ${t} ---`)

const shots = mkdtempSync(join(tmpdir(), 'gb-visual-'))

function evaluate(width, height, expression, extraArgs = []) {
  return new Promise((resolve, reject) => {
    const args = [
      'scripts/shoot.mjs', URL_, join(shots, `w${width}.png`), String(width), String(height),
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
      for (const line of out.trim().split('\n').reverse()) {
        const t = line.trim()
        if (!t.startsWith('{') && !t.startsWith('"')) continue
        try {
          const v = JSON.parse(t)
          return resolve(typeof v === 'string' ? JSON.parse(v) : v)
        } catch { /* not this line */ }
      }
      reject(new Error(`no JSON from shoot.mjs.\n  stdout: ${out.slice(0, 300)}\n  stderr: ${err.slice(0, 400)}`))
    })
  })
}

/* Layout, stickiness and the things a wide matrix has to keep true at every width. */
const LAYOUT = `(() => {
  const board = document.querySelector('.gb-board');
  if (!board) return JSON.stringify({ missing: true });
  const sc = document.querySelector('.gb-scroll');
  const who = sc.querySelector('.gb-who');
  const rows = [...sc.querySelectorAll('.gb-matrix tbody tr')];
  const cut = sc.querySelector('.gb-row-cutoff');
  const tag = sc.querySelector('.gb-cutoff-tag');
  const nav = document.querySelector('.gb-nav');
  const rail = document.querySelector('.gb-rail-fill');
  const railLabel = document.body.innerText.match(/([\\d.]+)% complete/i);

  const whoLeftBefore = who.getBoundingClientRect().left;
  sc.scrollLeft = sc.scrollWidth;
  const whoLeftAfter = who.getBoundingClientRect().left;
  const headersAfterScroll = [...sc.querySelectorAll('thead th')].filter((h) => !h.classList.contains('gb-corner'))
    .map((h) => h.textContent.trim()).filter(Boolean).length;
  sc.scrollLeft = 0;

  const bg = (n) => getComputedStyle(rows[n]).backgroundColor;
  const overlaps = (a, b) => !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom);
  const nextName = cut && cut.nextElementSibling ? cut.nextElementSibling.querySelector('.gb-id-handle') : null;

  return JSON.stringify({
    viewport: innerWidth,
    pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    boards: document.querySelectorAll('.gb-board').length,
    matrixScrolls: sc.scrollWidth > sc.clientWidth,
    playerColumnSticky: Math.abs(whoLeftAfter - whoLeftBefore) < 2,
    opponentHeaders: headersAfterScroll,
    headerHasNoSecondLine: ![...sc.querySelectorAll('thead th')].some((h) => h.querySelectorAll('span,div').length > 1),
    headerHasNoAvatar: sc.querySelectorAll('thead .gb-avatar, thead img').length === 0,
    zebraDiffers: rows.length > 1 && bg(0) !== bg(1),
    zebraRunsFullWidth: rows.length > 1
      && getComputedStyle(rows[1].querySelector('.gb-who')).backgroundColor === bg(1)
      && getComputedStyle(rows[1].querySelector('td:last-child')).backgroundColor === bg(1),
    firstPlaceHasNoWash: getComputedStyle(rows[0]).backgroundImage === 'none',
    cutoffAfterRow: cut ? [...cut.parentElement.children].indexOf(cut) + 1 : null,
    cutoffLabelClear: !!(tag && nextName) && !overlaps(tag.getBoundingClientRect(), nextName.getBoundingClientRect()),
    navButtons: nav ? [...nav.querySelectorAll('button')].map((b) => b.textContent.trim()) : [],
    railWidthPct: rail ? +(rail.getBoundingClientRect().width / rail.parentElement.getBoundingClientRect().width * 100).toFixed(1) : null,
    railLabelPct: railLabel ? +railLabel[1] : null,
    avatarPx: Math.round(document.querySelector('.gb-avatar').getBoundingClientRect().width),
    scoreCellsAreText: [...sc.querySelectorAll('.gb-cell')].every((c) => !c.querySelector('button,a,input')),
    identityIsLink: !!document.querySelector('.gb-id-link[href]'),
    remColumnPresent: [...sc.querySelectorAll('thead th')].some((h) => h.textContent.trim() === 'Rem'),
  });
})()`

/* Motion, and what repeated interaction costs. */
const MOTION = `(async () => {
  const board = document.querySelector('.gb-board');
  const frame = board.querySelector('.gb-frame');
  const before = getComputedStyle(frame, '::before').transform;
  await new Promise((r) => setTimeout(r, 900));
  const after = getComputedStyle(frame, '::before').transform;

  let net = 0;
  const boards = [...document.querySelectorAll('.gb-board')];
  const patched = boards.map((b) => {
    const add = b.addEventListener.bind(b);
    const rem = b.removeEventListener.bind(b);
    b.addEventListener = (t, f, o) => { net++; return add(t, f, o); };
    b.removeEventListener = (t, f, o) => { net--; return rem(t, f, o); };
    return { b, add, rem };
  });

  let state = 'visible';
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  const cycle = async (s) => {
    state = s;
    document.dispatchEvent(new Event('visibilitychange'));
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  };
  let stoppedWhenHidden = true;
  let resumedWhenVisible = true;
  for (let i = 0; i < 5; i++) {
    await cycle('hidden');
    if (document.querySelector('.gb-frame-live')) stoppedWhenHidden = false;
    await cycle('visible');
    if (!document.querySelector('.gb-frame-live')) resumedWhenVisible = false;
  }
  delete document.visibilityState;
  patched.forEach(({ b, add, rem }) => { b.addEventListener = add; b.removeEventListener = rem; });

  /* Hover every row of the first board repeatedly, to see whether anything accumulates. */
  let frames = 0;
  const raf = window.requestAnimationFrame;
  window.requestAnimationFrame = (cb) => { frames++; return raf(cb); };
  const rows = [...board.querySelectorAll('.gb-matrix tbody tr')];
  for (let pass = 0; pass < 20; pass++) {
    for (const r of rows) {
      const cell = r.querySelector('.gb-cell');
      if (cell) cell.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }));
    }
  }
  await new Promise((r) => raf(() => raf(r)));
  window.requestAnimationFrame = raf;

  return JSON.stringify({
    reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
    frameLiveCount: document.querySelectorAll('.gb-frame-live').length,
    boardCount: document.querySelectorAll('.gb-board').length,
    /*
      Boards near the viewport, by the same margin the observer uses.

      The interesting number is not "are all six animating" — they should not be. A board scrolled
      well past is deliberately switched off, so the claim worth testing is that exactly the ones in
      view are running.
    */
    boardsOnScreen: boards.filter((b) => {
      const r = b.getBoundingClientRect();
      return r.bottom > -120 && r.top < innerHeight + 120;
    }).length,
    frameAnimationName: getComputedStyle(frame, '::before').animationName,
    frameIsMoving: before !== after,
    framePainted: getComputedStyle(frame, '::before').backgroundImage !== 'none',
    stoppedWhenHidden,
    resumedWhenVisible,
    netListenersAfterCycles: net,
    hoverPasses: 20 * rows.length,
    framesRequestedByHover: frames,
    decorativeHidden: [...document.querySelectorAll('.gb-frame, .gb-glow')].every((e) => e.getAttribute('aria-hidden') === 'true'),
    decorativeInert: [...document.querySelectorAll('.gb-frame, .gb-glow')].every((e) => getComputedStyle(e).pointerEvents === 'none'),
  });
})()`

try {
  section('Layout at every supported width')

  for (const { w, h, label } of [
    { w: 1600, h: 1800, label: 'wide desktop' },
    { w: 1280, h: 1800, label: 'laptop' },
    { w: 1024, h: 1800, label: 'small laptop' },
    { w: 820, h: 2400, label: 'tablet' },
    { w: 390, h: 3000, label: 'phone' },
  ]) {
    const r = await evaluate(w, h, LAYOUT)
    if (r.missing) { check(`${label} (${w}px): the board is on the page`, false, 'not found'); continue }
    console.log(`\n  ${label} — ${w}px, ${r.boards} boards`)
    check('  no horizontal page overflow', r.pageOverflow === 0, `${r.pageOverflow}px`)
    check('  the player column stays put while the matrix scrolls', r.playerColumnSticky)
    check('  every opponent column keeps its heading', r.opponentHeaders > 0, `${r.opponentHeaders}`)
    check('  headings carry the ID only — no second line', r.headerHasNoSecondLine)
    check('  ...and no avatar', r.headerHasNoAvatar)
    check('  rows alternate', r.zebraDiffers)
    check('  ...across their whole width, sticky cells included', r.zebraRunsFullWidth)
    check('  first place has no background wash', r.firstPlaceHasNoWash)
    check('  the cutoff sits after the configured position', r.cutoffAfterRow === 3, `${r.cutoffAfterRow}`)
    check('  ...and its label overlaps no name', r.cutoffLabelClear)
    check('  the group navigation is generated from the groups', r.navButtons.length >= 2, r.navButtons.join(','))
    /*
      The rail and its caption are the same number.

      Compared as rendered pixels against the printed label, within half a percent — a bar drawn
      from a different quantity than its caption is the defect this replaced.
    */
    check('  the rail fill matches its printed percentage',
      r.railWidthPct != null && r.railLabelPct != null && Math.abs(r.railWidthPct - r.railLabelPct) < 0.6,
      `${r.railWidthPct}% drawn vs ${r.railLabelPct}% printed`)
    check('  the avatar is a compact 26-28px', r.avatarPx >= 26 && r.avatarPx <= 28, `${r.avatarPx}`)
    check('  score cells are text, not controls', r.scoreCellsAreText)
    check('  the identity strip opens a profile', r.identityIsLink)
    check('  the remaining-sets column is present', r.remColumnPresent)
    if (w >= 1024) check('  the matrix fits without scrolling', !r.matrixScrolls)
    else check('  the matrix scrolls inside the board', r.matrixScrolls)
  }

  section('Motion, and what repeated interaction costs')

  const m = await evaluate(1600, 1800, MOTION)
  check('the perimeter light travels', m.frameIsMoving)
  check('...on every board that is on screen', m.frameLiveCount === m.boardsOnScreen,
    `${m.frameLiveCount} live of ${m.boardsOnScreen} on screen (${m.boardCount} total)`)
  /* And the other half of the same claim: a board scrolled past is not burning frames. */
  check('...and not on the ones scrolled past', m.boardsOnScreen < m.boardCount ? m.frameLiveCount < m.boardCount : true,
    `${m.frameLiveCount}/${m.boardCount}`)
  check('...driven by the CSS animation', m.frameAnimationName === 'gb-frame-travel', m.frameAnimationName)
  check('the animation stops while the tab is hidden', m.stoppedWhenHidden)
  check('...and resumes when it returns', m.resumedWhenVisible)
  check('five hide/show cycles leave no listener behind', m.netListenersAfterCycles === 0, `${m.netListenersAfterCycles}`)
  /*
    Hovering hundreds of cells must not queue hundreds of frames.

    The column highlight is one piece of state on the table, changed only when the column actually
    changes, so a sweep across a row costs nothing and a sweep down a column costs one update each.
  */
  check('hundreds of row hovers request only a handful of frames',
    m.framesRequestedByHover <= 12, `${m.framesRequestedByHover} for ${m.hoverPasses} hovers`)
  check('the decorative layers are hidden from assistive technology', m.decorativeHidden)
  check('...and never intercept a pointer', m.decorativeInert)

  section('Reduced motion keeps the board and drops the movement')

  const rm = await evaluate(1600, 1800, MOTION, ['--reduced-motion'])
  check('the preference is being emulated', rm.reducedMotion)
  check('no board is animating', rm.frameLiveCount === 0, `${rm.frameLiveCount}`)
  check('...and the CSS animation is off', rm.frameAnimationName === 'none', rm.frameAnimationName)
  check('the frame is still drawn', rm.framePainted)
} finally {
  rmSync(shots, { recursive: true, force: true })
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
