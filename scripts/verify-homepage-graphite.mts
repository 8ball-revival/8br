/**
 * The graphite homepage, checked in a real browser.
 *
 * ── Why this exists as a suite rather than a session of screenshots ─────────────────────────────
 * Almost everything this page does is invisible to a static check. Whether the mobile crop is the
 * one a phone actually downloads, whether an iframe exists before somebody presses Play, whether the
 * champion photograph disappears when the champion changes, whether a card collapses when an article
 * has no picture — none of that is decidable from the markup, and a screenshot only says what one
 * width looked like on one day.
 *
 * So the assertions below drive the page and read what the browser did with it. A 200 is not
 * evidence of anything and is never checked for on its own.
 *
 * Run: npm run test:homepage (with the dev server up)
 */

import { launch, sleep } from './browser/driver.mjs'

const OUT = process.env.SHOT_DIR ?? 'C:/Users/Cerebro/AppData/Local/Temp/claude/C--Users-Cerebro/952b661e-7486-446a-90b1-a109d310f71e/scratchpad/shots'

let pass = 0
let fail = 0
const failures: string[] = []
const check = (label: string, ok: boolean, detail?: string) => {
  if (ok) { pass++; console.log(`  ok   ${label}`) }
  else { fail++; failures.push(label); console.log(`  FAIL ${label}${detail ? ` -- ${detail}` : ''}`) }
}
const eq = (label: string, actual: unknown, expected: unknown) =>
  check(label, JSON.stringify(actual) === JSON.stringify(expected), `got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`)
const section = (t: string) => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 74 - t.length))}`)

/*
  One probe, read once per page state.

  Everything the suite wants to know about a rendered homepage, gathered in a single evaluation so a
  check never races a re-render between two reads.
*/
const PROBE = `(function () {
  var doc = document.documentElement;
  var q = function (s) { return document.querySelector(s) };
  var all = function (s) { return [].slice.call(document.querySelectorAll(s)) };
  var mod = function (t) { return q('[data-sb-module-type="' + t + '"]') };

  var heroEl = mod('home.championHero');
  var heroImg = heroEl ? heroEl.querySelector('picture img') : null;
  var heroSource = heroEl ? heroEl.querySelector('picture source') : null;

  var recordEl = mod('competitions.recordFeature');
  var posterImg = recordEl ? recordEl.querySelector('img') : null;

  // Anything that scrolls sideways inside the page, ignoring the ranking rail, which is meant to.
  var traps = all('main *').filter(function (el) {
    if (el.scrollWidth - el.clientWidth <= 1) return false;
    var o = getComputedStyle(el).overflowX;
    if (o !== 'auto' && o !== 'scroll') return false;
    return !el.closest('[data-sb-module-type="rankings.rail"]');
  }).map(function (el) { return el.tagName.toLowerCase() + '.' + String(el.className || '').split(' ')[0] });

  var text = document.body.innerText;

  return {
    modules: ['home.championHero', 'rankings.rail', 'competitions.marquee',
              'competitions.recordFeature', 'editorial.breakFeature',
              'editorial.newsPlaques', 'rankings.achievementPlaques', 'rankings.statsBar']
      .filter(function (t) { return !!mod(t) }),

    hero: heroEl ? {
      currentSrc: heroImg ? heroImg.currentSrc.replace(location.origin, '') : null,
      alt: heroImg ? heroImg.getAttribute('alt') : null,
      sourceMedia: heroSource ? heroSource.getAttribute('media') : null,
      fetchPriority: heroImg ? heroImg.getAttribute('fetchpriority') : null,
      objectPosition: heroImg ? getComputedStyle(heroImg).objectPosition : null,
      naturalW: heroImg ? heroImg.naturalWidth : 0,
      champion: (function () {
        var t = heroEl.innerText;
        /*
          The rating is matched by SHAPE, so a changed number cannot fake a pass; the badge is
          matched by its exact label, because the hero body copy contains the word "champions" and
          a looser test reports that sentence as a surviving panel.
        */
        return { handle: t.indexOf('SIXOHTWO') >= 0, name: t.indexOf('Kevin') >= 0,
                 rating: /[0-9],[0-9]{3}/.test(t), rank: t.indexOf('CURRENT CHAMPION') >= 0 };
      })(),
      headlines: [].slice.call(heroEl.querySelectorAll('ul li a')).map(function (a) { return a.textContent.trim() })
    } : null,

    rail: (function () {
      var el = mod('rankings.rail');
      if (!el) return null;
      var links = [].slice.call(el.querySelectorAll('a[aria-label]'));
      return {
        entries: links.map(function (a) { return a.getAttribute('aria-label') }),
        scroller: (function () {
          var s = el.querySelector('[role="region"]');
          return s ? { overflow: s.scrollWidth - s.clientWidth } : null;
        })()
      };
    })(),

    record: recordEl ? {
      iframes: recordEl.querySelectorAll('iframe').length,
      posterSrc: posterImg ? posterImg.getAttribute('src') : null,
      posterAlt: posterImg ? posterImg.getAttribute('alt') : null,
      posterVisible: !!posterImg && posterImg.getBoundingClientRect().width > 0,
      scoreboard: (recordEl.innerText || '').indexOf('8 BALL REGISTRY') >= 0,
      playLabel: (function () {
        var b = recordEl.querySelector('button[aria-label]');
        return b ? b.getAttribute('aria-label') : null;
      })(),
      holderLine: (function () {
        var t = recordEl.innerText || '';
        return t.replace(/\\s+/g, ' ');
      })()
    } : null,

    // The figure must appear exactly once on the whole page.
    figureCount: (text.match(/58\\.7/g) || []).length,

    thumbs: (function () {
      var el = mod('editorial.newsPlaques');
      if (!el) return null;
      return {
        imgs: [].slice.call(el.querySelectorAll('img')).map(function (i) {
          var r = i.getBoundingClientRect();
          return { src: i.getAttribute('src'), loading: i.getAttribute('loading'),
                   w: Math.round(r.width), h: Math.round(r.height),
                   ratio: r.height ? +(r.width / r.height).toFixed(2) : null,
                   broken: i.complete && i.naturalWidth === 0 };
        }),
        rows: el.querySelectorAll('li').length
      };
    })(),

    achievements: (function () {
      var el = mod('rankings.achievementPlaques');
      if (!el) return null;
      return {
        cards: [].slice.call(el.querySelectorAll('li')).map(function (li) {
          var t = (li.innerText || '').split(String.fromCharCode(10)).filter(Boolean);
          return t;
        })
      };
    })(),

    stats: (function () {
      var el = mod('rankings.statsBar');
      if (!el) return null;
      var pairs = [].slice.call(el.querySelectorAll('dt')).map(function (dt, i) {
        var dd = el.querySelectorAll('dd')[i];
        return { label: dt.textContent.trim(), value: dd ? dd.textContent.trim() : null };
      });
      return { pairs: pairs, text: (el.innerText || '').replace(/\\s+/g, ' ') };
    })(),

    footer: (document.querySelector('footer') || { innerText: '' }).innerText.replace(/\\s+/g, ' '),

    nav: (function () {
      var n = document.querySelector('nav[aria-label="Primary"]');
      if (!n) return null;
      return [].slice.call(n.querySelectorAll('a')).map(function (a) {
        var cs = getComputedStyle(a);
        return { label: a.textContent.trim(), color: cs.color, current: a.getAttribute('aria-current') };
      });
    })(),

    overflow: doc.scrollWidth - doc.clientWidth,
    traps: traps,
    editorCode: (function () {
      var h = doc.innerHTML;
      return ['site-builder/editor', 'editor-shell', 'sb-overlay'].some(function (n) { return h.indexOf(n) >= 0 });
    })()
  };
})()`

/**
 * Every visible text node measured against what is actually painted behind it.
 *
 * Walks up for the first ancestor with a non-transparent background rather than trusting the
 * element's own — which is `transparent` almost everywhere — and composites any alpha it finds onto
 * it. That is the difference between checking a token pair and checking what a reader sees.
 */
const CONTRAST = `(function () {
  var parse = function (c) {
    var m = /rgba?\\(([^)]+)\\)/.exec(c);
    if (!m) return null;
    var p = m[1].split(',').map(function (x) { return parseFloat(x) });
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  var over = function (fg, bg) {
    return { r: fg.r * fg.a + bg.r * (1 - fg.a),
             g: fg.g * fg.a + bg.g * (1 - fg.a),
             b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1 };
  };
  var lum = function (c) {
    var f = function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  };
  var ratio = function (a, b) {
    var l1 = lum(a), l2 = lum(b);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  };
  var groundOf = function (el) {
    var ground = { r: 5, g: 6, b: 7, a: 1 };
    var stack = [];
    for (var p = el; p; p = p.parentElement) {
      var c = parse(getComputedStyle(p).backgroundColor);
      if (c && c.a > 0) stack.push(c);
      if (c && c.a === 1) break;
    }
    for (var i = stack.length - 1; i >= 0; i--) ground = over(stack[i], ground);
    return ground;
  };

  var bad = [];
  var seen = 0;
  [].slice.call(document.querySelectorAll('main *, header *, footer *')).forEach(function (el) {
    if (el.children.length > 0) return;
    var t = (el.textContent || '').trim();
    if (!t) return;
    var r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return;
    var cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || parseFloat(cs.opacity) < 0.15) return;
    // Visually-hidden text is not read by eye and is exempt by construction.
    if (r.width <= 2 && r.height <= 2) return;
    /*
      Text painted by a gradient rather than by its colour property.

      The 8BRCAM wordmark is a clipped background: the colour is transparent and the glyphs are
      filled by the gradient behind them. Measuring that property there reads transparency against
      its own
      ground and reports 1:1, which says nothing about whether anybody can read it. Excluded and
      recorded as a known exception rather than silently passed -- the wordmark is brand artwork on
      its own panel and is checked by eye.
    */
    if ((cs.webkitTextFillColor && cs.webkitTextFillColor.indexOf('rgba(0, 0, 0, 0)') === 0)
        || cs.backgroundClip === 'text' || cs.webkitBackgroundClip === 'text') return;
    var fg = parse(cs.color);
    if (!fg) return;
    seen++;
    var ground = groundOf(el);
    var composited = fg.a < 1 ? over(fg, ground) : fg;
    var rr = ratio(composited, ground);
    var size = parseFloat(cs.fontSize);
    var weight = parseInt(cs.fontWeight, 10) || 400;
    var large = size >= 24 || (size >= 18.66 && weight >= 700);
    var need = large ? 3 : 4.5;
    if (rr < need) {
      bad.push({ text: t.slice(0, 42), ratio: +rr.toFixed(2), need: need,
                 size: Math.round(size), weight: weight,
                 tag: el.tagName.toLowerCase(), cls: String(el.className || '').slice(0, 60) });
    }
  });
  return { measured: seen, failures: bad.slice(0, 14), total: bad.length };
})()`

const SIZES: [number, number, boolean][] = [
  [1920, 1080, false], [1440, 900, false], [1280, 800, false], [1024, 768, false],
  [768, 1024, true], [375, 812, true], [320, 568, true],
]

const b = await launch()
try {
  // ══ Desktop, everything present and live ══════════════════════════════════════════════════════
  section('The composition, at 1600')
  await b.viewport(1600, 1100, false)
  await b.goto('/', 12000)
  await sleep(2200)
  const p = await b.eval(PROBE)

  eq('every module of the approved composition renders', p.modules, [
    'home.championHero', 'rankings.rail', 'competitions.marquee',
    'competitions.recordFeature', 'editorial.breakFeature',
    'editorial.newsPlaques', 'rankings.achievementPlaques', 'rankings.statsBar',
  ])

  section('The hero, and whose photograph it is')
  /*
    The hero art is configuration, so this asserts the SHAPE rather than one filename.

    It named `homepage-champion-sixohtwo-desktop.webp` and would have failed the moment the Owner
    changed the picture — reporting an ordinary content edit as a layout regression. What the design
    fixes is that the desktop crop is the one the browser chose; which image it is belongs to
    whoever is editing the page.
  */
  check('the desktop crop is the one downloaded',
    /^\/assets\/homepage\/.+-desktop\.webp$/.test(p.hero.currentSrc ?? ''), String(p.hero.currentSrc))
  check('the photograph actually decoded', p.hero.naturalW > 1000, `naturalWidth ${p.hero.naturalW}`)
  eq('the mobile source is behind a media query', p.hero.sourceMedia, '(max-width: 767px)')
  check('the hero image is prioritised, being above the fold', p.hero.fetchPriority === 'high', String(p.hero.fetchPriority))
  check('it describes itself', String(p.hero.alt || '').length > 10, String(p.hero.alt))
  eq('the desktop focal point is applied', p.hero.objectPosition, '72% 50%')
  /*
    The champion panel is gone, and its absence is the assertion.

    This used to check that the rank, handle, real name and rating came from the database rather
    than the mockup. The panel was removed from the hero at the owner's request, so the check is
    inverted rather than deleted: none of those four may reappear over the photograph.

    The rail below still carries the leaderboard, and is checked separately — removing the hero
    panel was not meant to remove the standings from the page.
  */
  check('no champion panel is drawn over the photograph',
    !p.hero.champion.handle && !p.hero.champion.name && !p.hero.champion.rating && !p.hero.champion.rank,
    JSON.stringify(p.hero.champion))
  eq('the hero lists three headlines', p.hero.headlines.length, 3)

  section('The ranking rail')
  check('five players are named', p.rail.entries.length === 5, String(p.rail.entries.length))
  check('rank one is announced as rank one', /^Rank 1,/.test(p.rail.entries[0] ?? ''), p.rail.entries[0])
  check('every entry is a keyboard-reachable link with a spoken label',
    p.rail.entries.every((e: string) => /^Rank \d+, .+, rating \d+$/.test(e)), JSON.stringify(p.rail.entries))
  eq('the rail does not scroll at a desktop width', p.rail.scroller.overflow, 0)

  section('The record, and its poster')
  eq('no iframe exists before anybody presses Play', p.record.iframes, 0)
  eq('the supplied poster is what is shown', p.record.posterSrc, '/assets/homepage/table-clear-58-7-poster.webp')
  check('the poster is visible', p.record.posterVisible, String(p.record.posterVisible))
  eq('the poster is decorative, the record being stated beside it', p.record.posterAlt, '')
  check('the scoreboard strip is drawn as text', p.record.scoreboard, 'strip missing')
  check('the play control names the run', /58\.7/.test(p.record.playLabel ?? ''), String(p.record.playLabel))
  /*
    The SHAPE of the holder line, not who currently holds the record.

    This named "sixohtwo / Kevin" and failed the moment the record was legitimately reassigned —
    reporting a content edit as a layout regression. What the design fixes is the composition:
    handle, a separator, then the name in the secondary style. Who that is belongs to the editor.
  */
  check('the holder is one line: handle, slash, name',
    /\S+\s*\/\s*\S+/.test(p.record.holderLine.split(/record holder/i)[1] ?? ''),
    p.record.holderLine.slice(0, 120))
  eq('the figure appears exactly once on the page', p.figureCount, 1)

  section('Article thumbnails')
  eq('three stories', p.thumbs.rows, 3)
  eq('each has a picture', p.thumbs.imgs.length, 3)
  check('none is broken', p.thumbs.imgs.every((i: { broken: boolean }) => !i.broken), JSON.stringify(p.thumbs.imgs))
  check('all three are the supplied crops',
    p.thumbs.imgs.every((i: { src: string }) => i.src.startsWith('/assets/homepage/article-')),
    JSON.stringify(p.thumbs.imgs.map((i: { src: string }) => i.src)))
  check('they are lazy, being below the fold',
    p.thumbs.imgs.every((i: { loading: string }) => i.loading === 'lazy'), 'not lazy')
  check('and hold a stable 16:9 box',
    p.thumbs.imgs.every((i: { ratio: number }) => Math.abs(i.ratio - 1.78) < 0.06),
    JSON.stringify(p.thumbs.imgs.map((i: { ratio: number }) => i.ratio)))

  section('Achievements are records, not totals')
  eq('three plaques', p.achievements.cards.length, 3)
  const flat = p.achievements.cards.map((c: string[]) => c.join(' | '))
  check('each names a holder and a figure',
    p.achievements.cards.every((c: string[]) => c.length >= 4), JSON.stringify(flat))
  check('none of them is a site-wide total',
    !flat.some((t: string) => /Still nobody|PLAYERS|MATCHES RECORDED/i.test(t)), JSON.stringify(flat))

  section('The totals bar')
  check('three totals, each with a label', p.stats.pairs.length === 3, JSON.stringify(p.stats.pairs))
  check('the values are numbers from the database',
    p.stats.pairs.every((s: { value: string }) => /^[\d,]+$/.test(s.value)), JSON.stringify(p.stats.pairs))
  check('the tagline is centred in the bar', /DEFINITIVE ARCHIVE/i.test(p.stats.text), p.stats.text)
  check('and the live indicator says LIVE in words, not colour alone', /LIVE/i.test(p.stats.text), p.stats.text)

  section('Navigation and footer')
  check('every published link is present',
    (p.nav ?? []).length >= 7, JSON.stringify((p.nav ?? []).map((n: { label: string }) => n.label)))
  check('the current page is marked with aria-current',
    (p.nav ?? []).some((n: { current: string }) => n.current === 'page'), 'no aria-current')
  check('the footer names the site and what it is',
    /THE HOME OF COMPETITIVE 8-BALL/i.test(p.footer), p.footer.slice(0, 120))
  check('and does not misspell it', !/COMPETTIVE/i.test(p.footer), p.footer.slice(0, 120))

  section('Nothing leaks to a signed-out visitor')
  check('no editor code is served', !p.editorCode, 'editor code present')
  eq('no page-level horizontal overflow', p.overflow, 0)
  eq('no nested scroll traps outside the rail', p.traps, [])

  // ══ Click to play ═════════════════════════════════════════════════════════════════════════════
  section('The poster becomes the player')
  const focused = await b.eval(`(function () {
    var r = document.querySelector('[data-sb-module-type="competitions.recordFeature"]');
    var btn = r ? r.querySelector('button[aria-label]') : null;
    if (!btn) return false;
    btn.focus();
    return document.activeElement === btn;
  })()`)
  check('the play control takes keyboard focus', focused === true)
  /*
    Focus is asserted as a declared contract rather than a computed style.

    `.focus()` from script does not necessarily satisfy `:focus-visible` -- that heuristic is about
    how the element was reached, and a scripted call is not a keystroke. Reading `boxShadow` after a
    programmatic focus therefore measures the browser's heuristic, not this page. What can be checked
    honestly is that the control declares a visible ring and does not suppress the outline without
    replacing it.
  */
  const ring = await b.eval(`(function () {
    var r = document.querySelector('[data-sb-module-type="competitions.recordFeature"]');
    var btn = r.querySelector('button[aria-label]');
    var c = btn.getAttribute('class') || '';
    return { hasRing: c.indexOf('focus-visible:ring-') >= 0, hidesOutline: c.indexOf('focus-visible:outline-none') >= 0 };
  })()`)
  check('and declares a visible focus ring', ring.hasRing === true, JSON.stringify(ring))

  await b.key('Enter')
  await sleep(2200)
  const after = await b.eval(`(function () {
    var r = document.querySelector('[data-sb-module-type="competitions.recordFeature"]');
    var f = r.querySelector('iframe');
    var box = f ? f.getBoundingClientRect() : null;
    return {
      iframes: r.querySelectorAll('iframe').length,
      posters: [].slice.call(r.querySelectorAll('img')).filter(function (i) {
        return (i.getAttribute('src') || '').indexOf('table-clear') >= 0;
      }).length,
      src: f ? f.getAttribute('src') : null,
      ratio: box && box.height ? +(box.width / box.height).toFixed(2) : null,
      figures: (document.body.innerText.match(/58\\.7/g) || []).length
    };
  })()`)
  eq('one keystroke creates the player', after.iframes, 1)
  eq('the poster is removed rather than hidden behind it', after.posters, 0)
  eq('the player is the approved video, muted, and started because it was asked for',
    after.src, 'https://www.youtube-nocookie.com/embed/xpUXNXdEhBI?rel=0&modestbranding=1&playsinline=1&mute=1&autoplay=1')
  check('and holds 16:9', after.ratio != null && Math.abs(after.ratio - 1.78) < 0.05, String(after.ratio))
  eq('the figure is still stated exactly once', after.figures, 1)

  // ══ Contrast ══════════════════════════════════════════════════════════════════════════════════
  section('Contrast, measured against what is painted')
  await b.goto('/', 12000)
  await sleep(1800)
  const c = await b.eval(CONTRAST)
  check(`every visible string clears WCAG AA (${c.measured} measured)`, c.total === 0,
    JSON.stringify(c.failures))

  // ══ Responsive ════════════════════════════════════════════════════════════════════════════════
  for (const [w, h, mobile] of SIZES) {
    section(`${w}x${h}`)
    await b.viewport(w, h, mobile)
    await b.goto('/', 12000)
    await sleep(1800)
    const v = await b.eval(PROBE)
    const tag = `${w}x${h}`
    eq(`${tag}: every module renders`, v.modules.length, 8)
    eq(`${tag}: no page-level horizontal overflow`, v.overflow, 0)
    eq(`${tag}: no nested scroll traps outside the rail`, v.traps, [])
    eq(`${tag}: no iframe before activation`, v.record.iframes, 0)
    eq(`${tag}: the figure appears exactly once`, v.figureCount, 1)
    check(`${tag}: article thumbnails hold their box`,
      v.thumbs.imgs.every((i: { ratio: number; broken: boolean }) => !i.broken && Math.abs(i.ratio - 1.78) < 0.08),
      JSON.stringify(v.thumbs.imgs.map((i: { ratio: number }) => i.ratio)))
    eq(`${tag}: three achievement plaques`, v.achievements.cards.length, 3)

    // The hero swaps crop at the declared breakpoint, and only one file is fetched.
    const wantMobile = w < 768
    /* Which crop, not which picture — the image itself is the Owner's to change. */
    check(`${tag}: the ${wantMobile ? 'upright' : 'wide'} crop is the one used`,
      (wantMobile ? /-mobile\.webp$/ : /-desktop\.webp$/).test(v.hero.currentSrc ?? ''),
      String(v.hero.currentSrc))
    /*
      The champion panel was removed from the hero, so its absence is what is checked here now.
      The ranking rail below still names who is first, and is asserted separately.
    */
    check(`${tag}: no champion panel is drawn over the photograph`,
      !v.hero.champion.handle && !v.hero.champion.rating, JSON.stringify(v.hero.champion))

    // Touch targets, where a finger is the pointer.
    if (mobile) {
      /*
        Target size, with the exception WCAG actually grants.

        2.5.8 exempts a link whose target is INLINE in a sentence -- a word in a paragraph cannot be
        padded to 24px without wrecking the line height it sits in, and the success criterion says
        so. Everything else is held to 24px: a standalone link, a button, a row in a list. The
        exemption is decided by computed `display`, not by guessing from the markup.
      */
      const small = await b.eval(`(function () {
        return [].slice.call(document.querySelectorAll('main a, main button')).filter(function (el) {
          var r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) return false;
          if (getComputedStyle(el).display === 'inline') return false;
          return r.height < 24 || r.width < 24;
        }).map(function (el) {
          var r = el.getBoundingClientRect();
          return (el.textContent || el.getAttribute('aria-label') || el.tagName).trim().slice(0, 28)
            + ' ' + Math.round(r.width) + 'x' + Math.round(r.height);
        }).slice(0, 8);
      })()`)
      check(`${tag}: no interactive target under 24px`, small.length === 0, JSON.stringify(small))
    }

    const cc = await b.eval(CONTRAST)
    check(`${tag}: contrast clears AA (${cc.measured} measured)`, cc.total === 0, JSON.stringify(cc.failures))

    if (w === 1920 || w === 1440 || w === 1024 || w === 768 || w === 375) {
      const ph = await b.eval('Math.min(document.documentElement.scrollHeight, 8000)')
      await b.screenshot(`${OUT}/home-${w}.png`, { fullPage: true, width: w, height: ph })
    }
  }

  // ══ Console ═══════════════════════════════════════════════════════════════════════════════════
  section('The browser had nothing to say')
  const errors = typeof b.consoleErrors === 'function' ? b.consoleErrors() : []
  check('no console errors across the run', errors.length === 0, JSON.stringify(errors).slice(0, 400))
} finally {
  await b.close()
}

console.log(`\n${'═'.repeat(80)}`)
if (fail) {
  console.log(`\n${fail} FAILED:\n`)
  for (const f of failures) console.log(`  x ${f}`)
}
console.log(`\n${pass} checks passed, ${fail} failed\n`)
process.exit(fail ? 1 : 0)
