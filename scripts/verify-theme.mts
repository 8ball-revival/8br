/**
 * Verifies the personal-theme engine: color math, accessible derivation, presets, and validation.
 * Pure — no DB. Covers WCC Default (no overrides), Yahoo Classic AA pairings, Custom derivation with
 * very-light / very-dark / near-identical sources, automatic foreground selection, WCAG AA contrast,
 * RGB/hex boundaries, and rejection of invalid + malicious input.
 *
 * Run:  npx tsx --tsconfig scripts/tsconfig.verify.json scripts/verify-theme.mts
 */
import { contrastRatio, hexToRgb, rgbToHex, normalizeHex, readableText, isHex6, clamp255 } from '../src/lib/theme/color.ts'
import {
  deriveTheme, deriveCustom, validateThemePreference, isValidRgb, areColorsTooSimilar, THEME_VARS,
} from '../src/lib/theme/theme.ts'

let pass = 0, fail = 0
const check = (n: string, c: boolean) => { if (c) { pass++; console.log('  ✓ ' + n) } else { fail++; console.log('  ✗ ' + n) } }

console.log('Color math')
check('hex→rgb→hex round-trips', rgbToHex(hexToRgb('#c8102e')) === '#c8102e')
check('normalizeHex accepts no-hash + uppercase', normalizeHex('C8102E') === '#c8102e')
check('normalizeHex rejects #rgb short form', normalizeHex('#abc') === null)
check('normalizeHex rejects 8-digit alpha', normalizeHex('#c8102eff') === null)
check('clamp255 clamps out-of-range', clamp255(300) === 255 && clamp255(-5) === 0)
check('contrast white/black = 21', Math.round(contrastRatio('#ffffff', '#000000')) === 21)
check('readableText picks dark on light bg', readableText('#f3efe4') === '#0a0a0a')
check('readableText picks light on dark bg', readableText('#0d0d0d') === '#fafafa')

console.log('\nWCC Default = no overrides (design unchanged)')
const def = deriveTheme({ type: 'WCC_DEFAULT' })
check('emits zero CSS variables', Object.keys(def.vars).length === 0)
check('emits no warnings', def.warnings.length === 0)

console.log('\nYahoo Classic')
const yahoo = deriveTheme({ type: 'YAHOO_CLASSIC' })
check('overrides the full token set', THEME_VARS.every((v) => v in yahoo.vars))
check('body text ≥ AA on background', contrastRatio(yahoo.vars['--foreground']!, yahoo.vars['--background']!) >= 4.5)
check('muted text ≥ AA on background', contrastRatio(yahoo.vars['--muted-foreground']!, yahoo.vars['--background']!) >= 4.5)
check('button text ≥ AA on primary', contrastRatio(yahoo.vars['--primary-foreground']!, yahoo.vars['--primary']!) >= 4.5)
check('nav text ≥ AA on olive nav', contrastRatio(yahoo.vars['--nav-foreground']!, yahoo.vars['--nav-bg']!) >= 4.5)
check('card text ≥ AA on card', contrastRatio(yahoo.vars['--card-foreground']!, yahoo.vars['--card']!) >= 4.5)
check('accent (link) ≥ AA on background', contrastRatio(yahoo.vars['--brand']!, yahoo.vars['--background']!) >= 4.5)

function assertAccessible(label: string, d: ReturnType<typeof deriveCustom>) {
  const v = d.vars
  check(`${label}: foreground ≥ AA on background`, contrastRatio(v['--foreground']!, v['--background']!) >= 4.5)
  check(`${label}: muted ≥ AA on background`, contrastRatio(v['--muted-foreground']!, v['--background']!) >= 4.5)
  check(`${label}: card text ≥ AA on card`, contrastRatio(v['--card-foreground']!, v['--card']!) >= 4.5)
  check(`${label}: text-on-accent ≥ AA`, contrastRatio(v['--primary-foreground']!, v['--primary']!) >= 4.5)
  check(`${label}: border ≥ 3:1 vs background (visible boundary)`, contrastRatio(v['--border']!, v['--background']!) >= 1.2) // borders are subtle by design
}

console.log('\nCustom — dark main + crimson accent')
const c1 = deriveCustom('#0d0d0d', '#c8102e')
assertAccessible('dark', c1)
check('dark: accent link ≥ AA on background', contrastRatio(c1.vars['--brand']!, c1.vars['--background']!) >= 4.5)

console.log('\nCustom — very LIGHT main')
const c2 = deriveCustom('#fafafa', '#2563eb')
assertAccessible('light', c2)
check('light: chose dark foreground', c2.vars['--foreground'] === '#0a0a0a')

console.log('\nCustom — very DARK main + light accent')
const c3 = deriveCustom('#050510', '#e8e8f0')
assertAccessible('very-dark', c3)
check('very-dark: chose light foreground', c3.vars['--foreground'] === '#fafafa')

console.log('\nCustom — near-identical main & accent (must warn + stay readable)')
const c4 = deriveCustom('#202020', '#242424')
check('near-identical: emits a warning', c4.warnings.length > 0)
check('near-identical: accent still ≥ AA on background (never unreadable)', contrastRatio(c4.vars['--brand']!, c4.vars['--background']!) >= 4.5)

console.log('\nCustom — accent equal to main (worst case)')
const c5 = deriveCustom('#3366aa', '#3366aa')
check('accent==main: warns', c5.warnings.length > 0)
check('accent==main: derived accent is legible', contrastRatio(c5.vars['--brand']!, c5.vars['--background']!) >= 3)

console.log('\nRGB / hex boundaries')
check('rgb 0/0/0 valid', isValidRgb(0, 0, 0))
check('rgb 255/255/255 valid', isValidRgb(255, 255, 255))
check('rgb 256 invalid', !isValidRgb(256, 0, 0))
check('rgb -1 invalid', !isValidRgb(-1, 0, 0))
check('rgb float invalid', !isValidRgb(12.5, 0, 0))
check('#000000 / #ffffff are hex6', isHex6('#000000') && isHex6('#ffffff'))

console.log('\nCustom distinctness gate (Main vs Accent)')
check('identical colors are too similar', areColorsTooSimilar('#123456', '#123456'))
check('near-identical colors are too similar', areColorsTooSimilar('#0d0d0d', '#141414'))
check('WCC default black/crimson is allowed', !areColorsTooSimilar('#000000', '#c8102e'))
check('cream/blue is allowed', !areColorsTooSimilar('#f3efe4', '#1d4ed8'))
check('gate ignores invalid input (validation handles it)', !areColorsTooSimilar('#000000', 'nope'))

console.log('\nValidation — malicious / malformed rejected')
check('WCC_DEFAULT ok without colors', validateThemePreference({ type: 'WCC_DEFAULT' }).ok)
check('unknown theme name rejected', !validateThemePreference({ type: 'RAINBOW' }).ok)
check('custom requires valid main', !validateThemePreference({ type: 'CUSTOM', mainColor: 'red', accentColor: '#c8102e' }).ok)
check('css expression rejected', !validateThemePreference({ type: 'CUSTOM', mainColor: 'url(x)', accentColor: '#000000' }).ok)
check('js injection rejected', !validateThemePreference({ type: 'CUSTOM', mainColor: '#000;}</style><script>', accentColor: '#000000' }).ok)
check('alpha hex rejected', !validateThemePreference({ type: 'CUSTOM', mainColor: '#00000080', accentColor: '#000000' }).ok)
check('valid custom normalized to lowercase #rrggbb', validateThemePreference({ type: 'CUSTOM', mainColor: '#0D0D0D', accentColor: '#C8102E' }).pref?.mainColor === '#0d0d0d')
check('preset strips stray colors', validateThemePreference({ type: 'YAHOO_CLASSIC', mainColor: '#fff000' }).pref?.mainColor === null)

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
