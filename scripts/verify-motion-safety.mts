/**
 * Decoration may never be the only thing making content visible.
 *
 * ── The fault this was written against ───────────────────────────────────────────────────────────
 * The homepage headline, its eyebrow and its description are `.boot-in`: they fade and rise on
 * arrival. Written the usual way — `from { opacity: 0 }` with `fill-mode: both` — they rendered at
 * zero opacity and STAYED there in two ordinary situations:
 *
 *   1. Motion turned off in the display panel. That rule pauses animations, and a paused entrance is
 *      held at its first frame. Permanent: every navigation re-created it.
 *   2. The page loaded in a background tab. A hidden tab never advances its timeline, so the
 *      animation sits in its active phase at time zero — which applies the first frame whatever the
 *      fill mode says.
 *
 * Neither is exotic, and in both the text was not dimmed but absent. The fix has two halves, and
 * this asserts both, because either one alone still leaves a way to blank the page:
 *
 *   • Entrances are CANCELLED rather than paused when motion is off, so the element falls back to
 *     its own styles.
 *   • No entrance keyframe starts at zero opacity, so even a frozen timeline shows readable text.
 */
import { readFileSync } from 'node:fs'

let pass = 0, fail = 0
const check = (label: string, ok: boolean, detail?: string) => {
  if (ok) { pass++; console.log(`  ✓ ${label}`) }
  else { fail++; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`) }
}
const section = (s: string) => console.log(`\n--- ${s} ---`)

const cyber = readFileSync('src/app/(frontend)/cyberpunk.css', 'utf8')
const hud = readFileSync('src/app/(frontend)/hud.css', 'utf8')

section('No entrance begins at zero opacity')
{
  /*
   * Every keyframe block, checked at its `from`/`0%` frame. A LOOPING effect may legitimately pass
   * through zero — a pulse does — so this asks only about the frame an animation is held at when
   * its timeline is not running, which is the first one.
   */
  const blocks = [...cyber.matchAll(/@keyframes\s+([\w-]+)\s*\{([\s\S]*?)\n\}/g)]
  check('keyframes are declared and readable', blocks.length > 0, `${blocks.length} found`)

  for (const [, name, body] of blocks) {
    const first = body.match(/(?:^|\n)\s*(?:from|0%)\s*\{([^}]*)\}/)
    if (!first) continue
    const opacity = first[1].match(/opacity:\s*([\d.]+)/)
    if (!opacity) continue
    const value = Number(opacity[1])
    // A looping ambience is allowed to start dark; it is never carrying text on its own.
    const isEntrance = /boot|in$|reveal|enter/i.test(name)
    if (!isEntrance) continue
    check(`${name} starts readable, not invisible`, value >= 0.2, `starts at opacity ${value}`)
  }
}

section('Turning motion off cancels entrances rather than freezing them')
{
  const pauses = /\[data-hud-motion='off'\][\s\S]*?animation-play-state:\s*paused/.test(hud)
  check('the ambience is paused, so a loop holds a frame it had reached', pauses)

  const cancels = /\[data-hud-motion='off'\]\s*\.boot-in[\s\S]{0,200}?animation:\s*none/.test(hud)
  check('entrances are cancelled, so nothing is held at frame zero', cancels)

  const order = hud.indexOf("animation-play-state: paused")
  const cancelAt = hud.indexOf("[data-hud-motion='off'] .boot-in")
  check('the cancel is declared after the pause, so it wins', cancelAt > order, `pause@${order} cancel@${cancelAt}`)
}

section('A system reduced-motion preference does the same')
{
  const rm = cyber.slice(cyber.indexOf('@media (prefers-reduced-motion: reduce)'))
  check('reduced motion is honoured at all', rm.length > 0)
  check('...and it cancels the entrances outright', /\.boot-in[\s\S]{0,120}?animation:\s*none/.test(rm))
}

section('No entrance relies on a fill mode to stay visible')
{
  const decls = [...cyber.matchAll(/\.boot-in(?:-slow)?\s*\{([^}]*)\}/g)].map((m) => m[1])
  check('the entrance classes are declared', decls.length >= 2, `${decls.length}`)
  check('none of them pins a first frame with `both`/`backwards`',
    decls.every((d) => !/animation:[^;]*\b(both|backwards)\b/.test(d)), decls.join(' | '))
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
