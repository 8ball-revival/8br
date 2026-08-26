/**
 * Wide content scrolls inside itself. The document never scrolls sideways.
 *
 * ── The rule, and why it is structural rather than cosmetic ──────────────────────────────────────
 * A twelve-column standings table and a four-round bracket are both wider than a phone, and there
 * are only two ways to handle that: shrink them until they are unreadable, or let them scroll within
 * their own container. This site does the second, everywhere.
 *
 * The failure mode when it is missed is not "a bit awkward on mobile". A single unwrapped table
 * makes the whole PAGE scroll horizontally, which drags the navigation, the filter bar and every
 * other section sideways with it. One missing wrapper breaks every screen it appears on.
 *
 * ── What this can and cannot prove ───────────────────────────────────────────────────────────────
 * This is a source check: it proves the wide surfaces declare a scroll container and that the
 * container is reachable without a pointer. It cannot measure a rendered layout — that is done in a
 * browser at 1440, 1024 and 390, and the results are recorded in the commit that accompanies this.
 */
import { readFileSync, existsSync } from 'node:fs'

let pass = 0
let fail = 0
const check = (label: string, ok: boolean, detail?: string) => {
  if (ok) { pass++; console.log(`  ✓ ${label}`) }
  else { fail++; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`) }
}
const section = (t: string) => console.log(`\n--- ${t} ---`)

const read = (f: string) => (existsSync(f) ? readFileSync(f, 'utf8') : '')

/** The surfaces that are genuinely wider than a phone, and the file that owns each. */
const WIDE = [
  ['the Season group matrix', 'src/components/seasons/season-standings-matrix.tsx'],
  ['the Season bracket panel', 'src/components/seasons/season-bracket-panel.tsx'],
  ['the Rankings table', 'src/components/rankings/rankings-table.tsx'],
  ['the Tournament bracket', 'src/components/tournaments/bracket.tsx'],
  ['the Achievements strip', 'src/components/home/achievements-carousel.tsx'],
] as const

section('Every wide surface carries its own scroll container')
for (const [label, file] of WIDE) {
  const src = read(file)
  check(`${label} exists`, src.length > 0, file)
  if (!src) continue
  /*
   * Either an explicit overflow-x, or the shared DataTableFrame which supplies one. The bracket
   * panel scales to fit first and scrolls only past its legibility floor, so it may express this as
   * `overflow-auto` rather than `overflow-x-auto`.
   */
  const scrolls = /overflow-x-auto|overflow-auto|DataTableFrame|scrollbar-themed/.test(src)
  check(`...and scrolls internally`, scrolls, 'no scroll container found')
}

section('The scroll containers are reachable without a pointer')
{
  /*
   * A bare `overflow-x: auto` div cannot be focused, so a keyboard reader has no way to scroll it
   * and the columns past the fold are simply unreachable for them. Focusable and labelled is the
   * whole fix, and the shared frame does it once.
   */
  const frame = read('src/components/cyber/primitives.tsx')
  check('the shared table frame is focusable', /tabIndex=\{0\}/.test(frame))
  check('...and names its region', /role="region"/.test(frame) && /aria-label=\{label\}/.test(frame))

  const strip = read('src/components/home/achievements-carousel.tsx')
  check('the Achievements strip is focusable', /tabIndex=\{0\}/.test(strip))
  check('...and names its region', /aria-label="Achievements, scrollable"/.test(strip))
}

section('Nothing forces the document wider than the viewport')
{
  /*
   * A `min-w` on a page-level wrapper is the other way to make the document scroll: it cannot shrink
   * below its minimum, so the body inherits that width. Minimums on table CELLS are fine and
   * necessary — they are what the scroll container exists to contain.
   */
  const shells = [
    'src/components/cyber/primitives.tsx',
    'src/components/primitives.tsx',
    'src/app/(frontend)/layout.tsx',
  ]
  const offenders: string[] = []
  for (const f of shells) {
    for (const m of read(f).matchAll(/min-w-\[(\d{3,})px\]/g)) {
      offenders.push(`${f.replace('src/', '')}: ${m[0]}`)
    }
  }
  check('no page shell declares a large minimum width', offenders.length === 0, offenders.join(', '))

  const page = read('src/components/cyber/primitives.tsx')
  check('the wide page shell uses max-w-none rather than a fixed cap',
    page.includes('max-w-none'))
}

section('The mobile navigation stays usable')
{
  const mobile = read('src/components/mobile-nav.tsx')
  check('a mobile navigation exists', mobile.length > 0)
  check('...its items are full-width touch targets', /py-3/.test(mobile))
  check('...and the active item is marked by more than colour',
    /border-l-2/.test(mobile), 'a colour-only active state fails for a colour-blind reader')
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
