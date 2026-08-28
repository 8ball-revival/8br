/**
 * Display Lab — the properties it promises, checked rather than asserted in a comment.
 *
 * ── What this suite is for ───────────────────────────────────────────────────────────────────────
 * A theming panel fails in two ways that ordinary review does not catch. The first is a control that
 * does nothing: a toggle wired to an attribute no stylesheet reads looks exactly like a working one
 * in a screenshot, and only a reader who cared about that effect ever finds out. The second is a
 * setting that quietly changes something it must not — an accent that recolours a championship
 * marker, a preference that reaches the database, an effect that blurs body text.
 *
 * So this checks three things mechanically: every control reaches a real rule, the defaults still
 * render the official appearance, and the boundaries hold. It runs against source rather than a
 * browser because these are structural facts; the visual work is verified in a real browser
 * separately, and neither substitutes for the other.
 */
import { readFileSync, readdirSync } from 'node:fs'

import {
  DISPLAY_DEFAULTS, DISPLAY_KEY, DOM_SPEC, INTENSITY_FIELDS, INTENSITY_PRESETS, LEGACY_HUD_KEY,
  displayDom, matchedPreset, migrateLegacyHud, parseDisplay, withIntensity,
  type DisplaySettings, type IntensityValues,
} from '../src/lib/display/settings.ts'

let pass = 0
let fail = 0
const check = (label: string, ok: boolean, detail?: string) => {
  if (ok) { pass++; console.log(`  ✓ ${label}`) }
  else { fail++; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`) }
}
const section = (t: string) => console.log(`\n--- ${t} ---`)

const CSS = readFileSync('src/app/(frontend)/display.css', 'utf8')
const GLOBALS = readFileSync('src/app/(frontend)/globals.css', 'utf8')
const LAYOUT = readFileSync('src/app/(frontend)/layout.tsx', 'utf8')
const LAB = readFileSync('src/components/display/display-lab.tsx', 'utf8')
const PREVIEW = readFileSync('src/components/display/preview.tsx', 'utf8')
const STORE = readFileSync('src/lib/display/store.ts', 'utf8')
const BG = readFileSync('src/lib/display/background-store.ts', 'utf8')
const HEADER = readFileSync('src/components/site-header.tsx', 'utf8')

/** Every file the display system is made of, for the boundary checks below. */
const DISPLAY_SOURCES = [
  ...readdirSync('src/lib/display').map((f) => `src/lib/display/${f}`),
  ...readdirSync('src/components/display').map((f) => `src/components/display/${f}`),
]

section('The default appearance is the official one')
{
  /*
   * A visitor who has never opened this panel must see exactly what the site looked like before it
   * existed. That is not a preference about defaults — it is the difference between adding a control
   * and redesigning the site for everybody.
   */
  check('nothing stored renders the defaults', JSON.stringify(parseDisplay(null)) === JSON.stringify(DISPLAY_DEFAULTS))
  check('...standard intensity means every value at 100',
    INTENSITY_FIELDS.every((f) => DISPLAY_DEFAULTS[f] === 100))
  check('...the default frame is the current one', DISPLAY_DEFAULTS.frame === 'minimal')
  check('...with no texture', DISPLAY_DEFAULTS.texture === 'flat')
  check('...no background', DISPLAY_DEFAULTS.background === 'none')
  check('...the chamfered corners the site already has', DISPLAY_DEFAULTS.corners === 'chamfer')
  check('...and the site accent rather than a custom one', DISPLAY_DEFAULTS.accentMode === 'default')

  /* The effects that were already on stay on, and the ones that were off stay off. */
  check('scanlines, grid and grain start on, as they were',
    DISPLAY_DEFAULTS.scanlines && DISPLAY_DEFAULTS.grid && DISPLAY_DEFAULTS.grain)
  check('aberration, vignette and border pulse start off, as they were',
    !DISPLAY_DEFAULTS.aberration && !DISPLAY_DEFAULTS.vignette && !DISPLAY_DEFAULTS.borderPulse)

  const dom = displayDom(DISPLAY_DEFAULTS)
  check('the default accent sets no accent variable, so the design can change without stranding anyone',
    dom.vars['--dl-accent'] === undefined)
}

section('The intensity presets are genuinely different')
{
  /*
   * The old panel had four presets that shared one multiplier, so Standard and Overdrive differed by
   * a number nobody could see. Every pair now differs on every field, and it is measured rather than
   * claimed — a future edit that makes two presets converge fails here.
   */
  const names = Object.keys(INTENSITY_PRESETS) as (keyof typeof INTENSITY_PRESETS)[]
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      const a = INTENSITY_PRESETS[names[i]]
      const b = INTENSITY_PRESETS[names[j]]
      const same = INTENSITY_FIELDS.filter((f) => a[f] === b[f])
      check(`${names[i]} and ${names[j]} differ on every value`, same.length === 0, `shared: ${same.join(', ')}`)
      /* And by enough to see. A one-point difference is a difference nobody can perceive. */
      const closest = Math.min(...INTENSITY_FIELDS.map((f) => Math.abs(a[f] - b[f])))
      check(`...by a visible margin`, closest >= 10, `closest field differs by ${closest}`)
    }
  }

  check('standard is the design, unmodified', INTENSITY_FIELDS.every((f) => INTENSITY_PRESETS.standard[f] === 100))
  check('clean removes light without removing structure',
    INTENSITY_PRESETS.clean.glow === 0 && INTENSITY_PRESETS.clean.linework > 0)

  /* Applying a preset must not disturb anything it does not own. */
  const custom: DisplaySettings = { ...DISPLAY_DEFAULTS, frame: 'glass', texture: 'hex', motion: 'calm', bgOpacity: 12 }
  const applied = withIntensity(custom, 'overdrive')
  check('a preset leaves frame, texture, motion and background alone',
    applied.frame === 'glass' && applied.texture === 'hex' && applied.motion === 'calm' && applied.bgOpacity === 12)
}

section('Moving an advanced control switches to Custom, and back')
{
  const fromPreset = withIntensity(DISPLAY_DEFAULTS, 'subtle')
  check('a preset reports itself', matchedPreset(fromPreset) === 'subtle')

  const nudged: IntensityValues = { ...fromPreset, glow: fromPreset.glow + 25 }
  check('...a changed value no longer matches any preset', matchedPreset(nudged) === null)

  const restored: IntensityValues = { ...nudged, glow: fromPreset.glow }
  check('...and dragging it back restores the preset name, so experimenting is not a one-way door',
    matchedPreset(restored) === 'subtle')

  check('the panel derives the label rather than trusting the stored one',
    LAB.includes('matchedPreset(next) ?? \'custom\''))

  /* Storage claiming a preset it does not match is not believed. */
  const lying = parseDisplay(JSON.stringify({ ...DISPLAY_DEFAULTS, intensity: 'standard', glow: 15 }))
  check('...and stored settings that claim a preset they do not match are corrected',
    lying.intensity === 'custom' && lying.glow === 15)
}

section('Every control reaches a real rule')
{
  /*
   * The check that catches a decorative control.
   *
   * Each attribute the settings produce must appear in the stylesheet, and each variable must be
   * read by it. A toggle wired to an attribute nothing selects on renders identically whether it is
   * on or off, which is indistinguishable from a working control until somebody depends on it.
   */
  for (const key of Object.keys(DOM_SPEC.attrs)) {
    const attr = `data-${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`
    check(`${attr} is styled`, CSS.includes(`[${attr}`), 'no rule selects on it')
  }
  for (const key of Object.keys(DOM_SPEC.bools)) {
    const attr = `data-${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`
    check(`${attr} is styled`, CSS.includes(`[${attr}=`), 'no rule selects on it')
  }
  /* `var(--x)` and `var(--x, fallback)` are both reads; only the first form has a closing paren. */
  const isRead = (name: string) => CSS.includes(`var(${name})`) || CSS.includes(`var(${name},`)
  for (const name of Object.keys(DOM_SPEC.nums)) {
    check(`${name} is read by the stylesheet`, isRead(name), 'set but never used')
  }
  for (const name of Object.keys(DOM_SPEC.px)) {
    check(`${name} is read by the stylesheet`, isRead(name), 'set but never used')
  }

  /*
   * Both directions of a toggle have to do something, and there are two legitimate ways to arrange
   * that: a rule for the state being switched TO, or an inert base that the "on" rule overrides.
   * Grain and the vignette use the second — their layers are `display: none` until switched on — so
   * demanding an explicit `='off'` rule would fail a control that works.
   *
   * What must never be true is an effect applied UNCONDITIONALLY with only a decorative attribute
   * beside it, which is the dead control this section exists to catch.
   */
  for (const [key] of Object.entries(DOM_SPEC.bools)) {
    const attr = `data-${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`
    check(`...and ${attr} gates its effect on an explicit state`,
      CSS.includes(`[${attr}='on']`) || CSS.includes(`[${attr}='off']`))
  }
  for (const layer of ['dl-grain-layer', 'dl-vignette-layer', 'dl-bg-layer']) {
    const base = new RegExp(`\\.${layer}[^{]*\\{([\\s\\S]*?)\\n\\}`).exec(CSS)?.[1] ?? ''
    check(`...the ${layer} is inert until switched on`, /display:\s*none/.test(base))
  }
}

section('The glow slider actually changes the glow')
{
  /*
   * The reported bug, and its cause.
   *
   * The lit shadows were declared TWICE: a scaled version in the display sheet and an unscaled copy
   * in globals.css, which is imported last. Equal specificity, later wins — so the scaled version
   * never applied and the slider changed an attribute, a variable, and nothing a reader could see.
   */
  for (const glow of ['--glow-yellow', '--glow-cyan', '--glow-magenta', '--glow-soft']) {
    check(`${glow} is declared once, in the sheet that owns it`,
      CSS.includes(`${glow}:`) && !new RegExp(`^\\s*${glow}:`, 'm').test(GLOBALS))
  }
  check('...and every one of them scales with the slider',
    ['--glow-yellow', '--glow-cyan', '--glow-magenta', '--glow-soft'].every((g) => {
      const body = new RegExp(`${g}:([\\s\\S]*?);`).exec(CSS)?.[1] ?? ''
      return body.includes('var(--dl-glow)')
    }))
  check('...including the panel shadow, which is the one the old slider missed',
    /--glow-soft:[\s\S]*?var\(--dl-glow\)/.test(CSS))

  /*
   * Blur radius scales linearly, which is what makes 0 / 50 / 100 / 200 four different renderings
   * rather than four numbers with the same saturated core.
   */
  check('...by radius as well as alpha, so 100% and 200% are not the same picture',
    /calc\(\d+px \* var\(--dl-glow\)\)/.test(CSS))
}

section('An override actually overrides')
{
  /*
   * The failure this catches has now happened twice, in two different variables, from one cause.
   *
   * globals.css declares the palette on a bare `:root` — specificity (0,1,0) — and is imported AFTER
   * this file. A display rule written as a single attribute selector is also (0,1,0), so the tie goes
   * to globals and the setting does nothing: the panel writes the variable, the attribute lands on
   * <html>, and the interface does not move. It is invisible in review because the CSS is correct in
   * isolation and the JavaScript is correct in isolation; only the cascade between two files is
   * wrong. The glow lost this way, and so did the custom accent.
   *
   * So: any variable this file redeclares that globals.css also declares on `:root` must be declared
   * by a selector that OUT-SPECIFIES `:root`.
   */
  const rootBlock = /\n:root \{([\s\S]*?)\n\}/.exec(GLOBALS)?.[1] ?? ''
  const rootVars = new Set([...rootBlock.matchAll(/^\s*(--[a-z0-9-]+)\s*:/gm)].map((m) => m[1]))
  check('the globals palette was found', rootVars.size > 20, `${rootVars.size} tokens`)

  /* Class-and-attribute count — the only component of specificity in play between these two. */
  const classSpecificity = (selector: string) =>
    (selector.match(/\[[^\]]+\]/g) ?? []).length +
    (selector.match(/\.[a-z][\w-]*/gi) ?? []).length +
    (selector.match(/:[a-z-]+\b(?!\()/gi) ?? []).length

  let weak = 0
  for (const [, selector, body] of CSS.matchAll(/\n(\[data-dl[^{\n]*)\{([\s\S]*?)\n\}/g)) {
    for (const [, name] of body.matchAll(/^\s*(--[a-z0-9-]+)\s*:/gm)) {
      if (!rootVars.has(name)) continue
      const spec = classSpecificity(selector.trim())
      if (spec < 2) {
        weak++
        check(`${name} is overridden by a selector that beats :root`, false, `${selector.trim()} scores ${spec}`)
      }
    }
  }
  check('every redeclared palette token out-specifies the default it replaces', weak === 0)

  /* And the accent in particular, since it is the one a reader can reach from the panel. */
  const accentSel = /\n(\[data-dl-accent-mode[^{\n]*)\{/.exec(CSS)?.[1]?.trim() ?? ''
  check('the custom accent rule beats the default palette', classSpecificity(accentSel) >= 2, accentSel)
}

section('Nothing blurs body text')
{
  /*
   * Two blurs exist, and both are aimed at an element with no text in it: `backdrop-filter` on the
   * Glass frame blurs what is BEHIND a panel, and `filter: blur` applies to the background image
   * layer. A `filter: blur` on anything that renders copy would make the site unreadable at the
   * reader's own request, which is not a request anybody makes.
   */
  const blurs = [...CSS.matchAll(/^\s*(-webkit-)?filter:\s*blur\([^)]*\)/gm)]
  const blurSelectors = blurs.map((m) => {
    const before = CSS.slice(0, m.index ?? 0)
    return before.slice(before.lastIndexOf('}') + 1).split('{')[0].trim()
  })
  check('every filter: blur is on a decorative layer',
    blurSelectors.every((sel) => sel.includes('dl-bg-image')), blurSelectors.join(' | '))
  check('...and the frame blur is a BACKDROP filter, which leaves the panel\'s own text sharp',
    CSS.includes('backdrop-filter: var(--dl-fr-blur)') && /--dl-fr-blur:\s*blur/.test(CSS))
}

section('The preview is the real thing')
{
  check('it applies settings with the same function the page uses', PREVIEW.includes('applyDisplay('))
  check('...to its own scope rather than the document', PREVIEW.includes('data-dl-scope'))
  check('...and shows the Competition History panel', PREVIEW.includes('Competition') && PREVIEW.includes('Latest News'))
  check('...on both an accent ground and a graphite one', PREVIEW.includes('dl-on-light') && PREVIEW.includes('bg-[var(--card)]'))
  check('...with panel-only and full-page modes', LAB.includes("'Panel Only'") && LAB.includes("'Full Page'"))

  /*
   * No rule may be anchored to :root, or the preview silently renders a different thing from what
   * saving would produce — the one failure a preview must not have.
   */
  check('no display rule is anchored to :root, so every one of them matches the preview too',
    !/:root\[data-dl/.test(CSS))

  check('the draft is only persisted on Save', LAB.includes('const commit = () =>') && LAB.includes('save(draft)'))
  check('...and closing without saving puts the stored settings back',
    /const closeLab[\s\S]{0,200}applyDisplay\(document\.documentElement, stored\)/.test(LAB))
}

section('Frames, corners, textures and backgrounds all exist')
{
  for (const frame of ['minimal', 'rails', 'beveled', 'neon', 'broadcast', 'glass']) {
    check(`the ${frame} frame is declared`, CSS.includes(`[data-dl-frame='${frame}']`))
  }
  /* And differs from the others: a frame that sets nothing of its own is a duplicate with a name. */
  const frameBodies = new Map<string, string>()
  for (const frame of ['minimal', 'rails', 'beveled', 'neon', 'broadcast', 'glass']) {
    frameBodies.set(frame, new RegExp(`\\[data-dl-frame='${frame}'\\]\\s*\\{([\\s\\S]*?)\\n\\}`).exec(CSS)?.[1] ?? '')
  }
  const uniqueFrames = new Set(frameBodies.values())
  check('...and no two frames render the same', uniqueFrames.size === frameBodies.size)

  for (const corner of ['square', 'round']) {
    check(`the ${corner} corner geometry is declared`, CSS.includes(`[data-dl-corners='${corner}']`))
  }
  check('...chamfer is the site default and needs no override', !CSS.includes("[data-dl-corners='chamfer']"))

  for (const texture of ['carbon', 'brushed', 'frosted', 'hex', 'circuit', 'grid', 'holo']) {
    const body = new RegExp(`\\[data-dl-texture='${texture}'\\]\\s*\\{([\\s\\S]*?)\\n\\}`).exec(CSS)?.[1] ?? ''
    check(`the ${texture} texture draws something`, body.includes('gradient('))
    check(`...and answers the scale control`, body.includes('var(--dl-texture-scale)'))
  }
  check('flat is the absence of a texture, not a pattern', !CSS.includes("[data-dl-texture='flat']"))

  /*
   * Every layer list is as long as the image list it describes.
   *
   * `background-image` on a shared surface is composed from three sources — the frame mark, the
   * interior wash and the texture — and when the size, position or repeat list is SHORTER than the
   * image list, CSS cycles it from the start rather than leaving the surplus layers alone. So a
   * three-layer hex mesh beside a one-value size list drew its second and third layers at the frame
   * mark's size: a mesh rendered as a hairline along the top edge of the panel. It looked like a
   * texture that did not work, and the cause was two numbers that did not match.
   *
   * Commas are counted at the top level only — `calc(8px * var(--x))` and `color-mix(in oklab, a,
   * b)` are full of commas that separate arguments rather than layers.
   */
  const topLevelCount = (value: string) => {
    let depth = 0
    let items = 1
    for (const ch of value) {
      if (ch === '(') depth++
      else if (ch === ')') depth--
      else if (ch === ',' && depth === 0) items++
    }
    return items
  }
  const declared = (block: string, prop: string) => {
    const m = new RegExp(`${prop}:([\\s\\S]*?);`).exec(block)
    return m ? topLevelCount(m[1]) : null
  }

  for (const [kind, names, prefix] of [
    ['frame', ['minimal', 'rails', 'beveled', 'neon', 'broadcast', 'glass'], '--dl-fr-mark'],
    ['texture', ['carbon', 'brushed', 'frosted', 'hex', 'circuit', 'grid', 'holo'], '--dl-texture'],
  ] as const) {
    for (const name of names) {
      const attr = kind === 'frame' ? 'data-dl-frame' : 'data-dl-texture'
      const block = new RegExp(`\\[${attr}='${name}'\\]\\s*\\{([\\s\\S]*?)\\n\\}`).exec(CSS)?.[1] ?? ''
      const image = declared(block, kind === 'frame' ? `${prefix}` : `${prefix}-image`)
      if (image == null) continue // this one draws no layer of its own
      const size = declared(block, `${prefix}-size`)
      const pos = declared(block, `${prefix}-pos`)
      const repeat = declared(block, `${prefix}-repeat`)
      check(`the ${name} ${kind} declares one size, position and repeat per layer`,
        size === image && pos === image && repeat === image,
        `${image} images vs ${size} sizes, ${pos} positions, ${repeat} repeats`)
    }
  }

  for (const bg of ['void-grid', 'carbon-weave', 'data-stream', 'red-circuit', 'holographic', 'custom']) {
    check(`the ${bg} background is declared`, CSS.includes(`[data-dl-bg='${bg}']`))
  }
  /* Anchored to the start of a line, so the tail of a compound selector is not mistaken for one. */
  check('fit and alignment apply only to an uploaded image',
    !/(^|\n)\[data-dl-bg-(fit|pos)=/.test(CSS) && CSS.includes("[data-dl-bg='custom'][data-dl-bg-fit='cover']"))
}

section('An uploaded background never leaves the browser')
{
  /*
   * The claim on the panel is `Stored in this browser only`. This is what makes it true rather than
   * a promise about how something is handled after we receive it — there is nothing to receive.
   */
  /*
   * Comments are stripped first. Both of these files describe the guarantee in prose — "no fetch, no
   * FormData, never localStorage" — and a scan that reads the explanation as a violation reports the
   * documentation of a rule as a breach of it.
   */
  const codeOnly = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  for (const file of DISPLAY_SOURCES) {
    const src = codeOnly(readFileSync(file, 'utf8'))
    const network = /\bfetch\s*\(|XMLHttpRequest|FormData|navigator\.sendBeacon|new WebSocket/.exec(src)
    check(`${file.split('/').pop()} makes no network call`, network == null, network?.[0])
    const server = /from '@\/lib\/(db|prisma)|getPayload|'use server'|prisma\./.exec(src)
    check(`...and touches no data layer`, server == null, server?.[0])
  }

  check('the image is held in IndexedDB', BG.includes('indexedDB.open'))
  check('...never in localStorage, where an image would evict the settings',
    !codeOnly(BG).includes('localStorage'))
  check('SVG is refused by type and by extension, not merely absent from the picker',
    BG.includes("'image/svg+xml'") && /\\.svgz\?\$/.test(BG))
  check('...and the accept list offers only raster formats',
    /ACCEPTED_TYPES = \['image\/png', 'image\/jpeg', 'image\/webp'\]/.test(BG))
  check('a file-size limit is enforced', BG.includes('MAX_FILE_BYTES') && BG.includes('file.size > MAX_FILE_BYTES'))
  check('...and a dimension limit', BG.includes('MAX_SOURCE_EDGE') && BG.includes('bitmap.width > MAX_SOURCE_EDGE'))
  check('the image is decoded and re-encoded, so camera and location metadata is discarded',
    BG.includes('createImageBitmap') && BG.includes('canvas.toBlob'))
  check('...and the decoded bitmap is released rather than leaked', /finally\s*\{\s*bitmap\.close\(\)/.test(BG))
  check('one action removes it', BG.includes('export async function clearBackground'))
  check('...and Reset removes it too', LAB.includes('clearBackground()') && LAB.includes('const resetAll'))
  check('the panel says where it is stored', LAB.includes('Stored in this browser only'))
}

section('Persistence, migration and corruption')
{
  check('the storage key is versioned', DISPLAY_KEY.endsWith('-v1'))

  /* Corrupt, hostile and obsolete storage all fall back to the official appearance. */
  for (const [label, raw] of [
    ['unparseable', '{not json'],
    ['an array', '[1,2,3]'],
    ['a bare number', '42'],
    ['null', 'null'],
  ] as const) {
    check(`${label} storage falls back to the defaults`,
      JSON.stringify(parseDisplay(raw)) === JSON.stringify(DISPLAY_DEFAULTS))
  }

  /*
   * A stale field falls back on its OWN, and this is the point of doing it per field: the day a
   * texture is renamed, a reader who had chosen one must not also lose their accent, frame and
   * motion setting.
   */
  const partial = parseDisplay(JSON.stringify({ texture: 'no-such-texture', motion: 'calm', corners: 'round', glow: 999 }))
  check('an unknown value falls back alone', partial.texture === DISPLAY_DEFAULTS.texture)
  check('...leaving the reader\'s other choices intact', partial.motion === 'calm' && partial.corners === 'round')
  check('...and an out-of-range number is clamped rather than discarded', partial.glow === 200)

  /* The old panel's settings are carried forward rather than dropped. */
  const legacy = migrateLegacyHud(JSON.stringify({
    intensity: 'off', accent: 'red', glow: 40, motion: 'calm', corners: 'square',
    scan: false, grid: true, noise: false, aberration: true, flicker: true,
  }))
  check('an old HUD configuration migrates', legacy != null)
  check('...with "off" becoming Clean', legacy?.intensity === 'custom' || legacy?.intensity === 'clean')
  check('...the red accent kept as a custom colour rather than dropped',
    legacy?.accentMode === 'custom' && legacy?.accentHex === '#ff2a2a')
  check('...and the toggles carried across',
    legacy?.scanlines === false && legacy?.grain === false && legacy?.aberration === true)
  check('...while an effect with no equivalent is not invented', !('flicker' in (legacy ?? {})))
  check('migration runs only when nothing new is stored', STORE.includes('if (localStorage.getItem(DISPLAY_KEY)) return'))
  check('...and reads the old key by name', STORE.includes('LEGACY_HUD_KEY') && LEGACY_HUD_KEY === '8br-hud')
}

section('The pre-paint script cannot drift from the applier')
{
  /*
   * Both walk DOM_SPEC. A hand-written copy of "intensity becomes data-dl-intensity" drifts the
   * first time a control is added, and the only symptom is a flash on load that nobody reproduces.
   */
  check('the script is generated from the shared spec', LAYOUT.includes('JSON.stringify(DOM_SPEC)'))
  check('...and from the shared defaults', LAYOUT.includes('JSON.stringify(DISPLAY_DEFAULTS)'))
  check('...and reads the versioned key', LAYOUT.includes('JSON.stringify(DISPLAY_KEY)'))
  for (const group of ['attrs', 'bools', 'nums', 'px'] as const) {
    check(`...covering the ${group} in the spec`, new RegExp(`S\\.${group}`).test(LAYOUT))
  }
  check('...including a custom accent, so a chosen colour does not flash the default first',
    LAYOUT.includes("--dl-accent") && LAYOUT.includes("--dl-accent-ink"))
  check('it runs in <head>, before the first paint', /<head>[\s\S]{0,200}displayScript/.test(LAYOUT))
  check('...and cannot take the page down if storage throws', /catch\(err\)\{\}/.test(LAYOUT))

  /* Every settings field is either in the spec or deliberately not a DOM value. */
  const specced = new Set([
    ...Object.values(DOM_SPEC.attrs),
    ...Object.values(DOM_SPEC.bools),
    ...Object.values(DOM_SPEC.nums).map(([f]) => f),
    ...Object.values(DOM_SPEC.px).map(([f]) => f),
  ])
  /* These four are not attributes: two are the accent pair, and two are panel state. */
  const notDom = new Set(['accentHex', 'accentInk', 'swatches', 'intensity'])
  const missed = Object.keys(DISPLAY_DEFAULTS).filter((f) => !specced.has(f) && !notDom.has(f))
  check('every setting is either applied to the DOM or explicitly not a DOM value', missed.length === 0, missed.join(', '))
}

section('Motion can always be refused')
{
  const reduced = CSS.lastIndexOf('@media (prefers-reduced-motion: reduce)')
  check('the reduced-motion override exists', reduced > 0)
  check('...and is declared last, so it wins over every speed, pulse and preset',
    reduced > CSS.lastIndexOf("[data-dl-motion='fast']") && reduced > CSS.lastIndexOf("[data-dl-border-pulse='on']"))
  check('...with !important, because the rules it overrides are equally specific',
    /prefers-reduced-motion: reduce\)\s*\{[\s\S]*?animation: none !important/.test(CSS.slice(reduced)))
  check('the panel says so, rather than leaving a reader to discover it',
    LAB.includes('A system reduced-motion setting always wins'))

  check('an entrance animation is cancelled rather than paused when motion is off',
    /\[data-dl-motion='off'\] \.boot-in[\s\S]{0,120}animation: none/.test(CSS))
}

section('Small screens and slow machines are protected')
{
  check('backdrop blur is dropped on phones', /@media \(max-width: 767px\)[\s\S]*?--dl-fr-blur: none/.test(CSS))
  check('...and so is a viewport-sized background blur', /@media \(max-width: 767px\)[\s\S]*?filter: none/.test(CSS))
  check('a display that reports slow updates gets no ambient motion', CSS.includes('@media (update: slow)'))
}

section('The old HUD is gone, not hidden')
{
  const files: string[] = []
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = `${dir}/${e.name}`
      if (e.isDirectory()) walk(full)
      else if (/\.(tsx?|css)$/.test(e.name)) files.push(full)
    }
  }
  walk('src')

  /*
   * Comments stripped first, for the same reason as the network scan: display.css EXPLAINS why the
   * old `:root[data-hud-accent='red']` selector did not hit the specificity bug this one did, and a
   * scan that reads that explanation as a survival reports the history of a fix as the absence of it.
   */
  const stripComments = (src: string) =>
    src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const stragglers = files.filter((f) => /data-hud|dataset\.hud|--hud-glow/.test(stripComments(readFileSync(f, 'utf8'))))
  check('no data-hud attribute or variable survives', stragglers.length === 0, stragglers.join(', '))
  check('hud.css is gone', !files.some((f) => f.endsWith('hud.css')))
  check('the floating bottom-right button is gone', !files.some((f) => readFileSync(f, 'utf8').includes('data-testid="hud-trigger"')))

  check('the trigger sits in the header where the LIVE badge was', HEADER.includes('<DisplayLab'))
  check('...and the badge itself no longer renders there', !HEADER.includes('<LiveClock'))
  check('...its label says what it opens', LAB.includes('aria-label="Customize Display"'))
  check('...with a tooltip that agrees', LAB.includes('title="Customize Display"'))
  check('the system status it replaced moved inside the panel',
    LAB.includes('LiveClock') && LAB.includes('System Status'))
}

section('The panel is operable from a keyboard')
{
  check('Escape closes it', /e\.key === 'Escape'/.test(LAB))
  check('Tab is trapped inside it', LAB.includes("e.key !== 'Tab'") && LAB.includes('e.preventDefault(); last.focus()'))
  check('...focus moves in on open', /open\) drawer\.current\?\.querySelector/.test(LAB))
  check('...and returns to the trigger on close', LAB.includes('trigger.current?.focus()'))
  check('it is announced as a modal dialog', LAB.includes('role="dialog"') && LAB.includes('aria-modal="true"'))
  check('...with a name', LAB.includes('aria-labelledby={titleId}'))
  check('the page behind cannot scroll under it', LAB.includes("document.body.style.overflow = 'hidden'"))

  const CONTROLS = readFileSync('src/components/display/controls.tsx', 'utf8')
  for (const control of ['export function Choice', 'export function Slider', 'export function Toggle', 'export function SwatchChoice']) {
    const body = CONTROLS.slice(CONTROLS.indexOf(control), CONTROLS.indexOf(control) + 2600)
    check(`${control.replace('export function ', '')} shows focus`, body.includes('focus-visible:ring-2'))
  }
  check('sliders are real inputs with associated labels',
    CONTROLS.includes('htmlFor={id}') && CONTROLS.includes("type=\"range\""))
  check('toggles are switches', CONTROLS.includes('role="switch"') && CONTROLS.includes('aria-checked={on}'))
  check('segmented choices report their state', CONTROLS.includes('aria-pressed={value === v}'))
  for (const layer of ['dl-bg-layer', 'dl-grain-layer', 'dl-vignette-layer']) {
    check(`the ${layer} is hidden from assistive technology`,
      new RegExp(`"${layer}"\\s+aria-hidden`).test(LAYOUT))
  }
}

section('Nothing here can change the site\'s data')
{
  /* Already checked per file above; this states the guarantee at the level it is promised. */
  check('the panel imports no server action', !/from '@\/lib\/[a-z-]+\/actions'/.test(LAB))
  check('...and the settings module is pure', !readFileSync('src/lib/display/settings.ts', 'utf8').includes('fetch('))
  check('the panel says the data is unaffected, and it is',
    LAB.includes('every rating,') && LAB.includes('rank and result is the same'))
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
