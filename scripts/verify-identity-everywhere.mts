/**
 * The CueVerse ID is mandatory, everywhere a Player appears.
 *
 * ── Why this is a source audit and not a page test ───────────────────────────────────────────────
 * The failure mode is not that a page is wrong today. It is that a new surface gets written next
 * month, renders `entrantName` because that is the field lying nearest to hand, and looks perfectly
 * fine on a roster where everybody has a distinct Preferred Name. It stops identifying anybody the
 * moment two people share one — and there are six players called Chris here, and six called Craig.
 *
 * So the audit is on the code: the fields that carry a bare display name are named, and any file
 * that renders one without also reaching for the handle has to say why. A page test would only ever
 * cover the pages somebody remembered to add.
 *
 * ── What counts as evidence ──────────────────────────────────────────────────────────────────────
 * A file is satisfied if it uses the shared identity module, renders a canonical identity component,
 * or references a CueVerse ID field alongside the display name. The point is that the handle is
 * reachable in that render, not that a particular helper was used.
 */
import { readFileSync, readdirSync } from 'node:fs'

import { prisma } from '../src/lib/prisma.ts'
import { assertLocalDatabase } from '../src/lib/db-guard.ts'
import { identityLines, identityText, NO_IDENTITY } from '../src/lib/identity/display.ts'

assertLocalDatabase()

let pass = 0
let fail = 0
const check = (label: string, ok: boolean, detail?: string) => {
  if (ok) { pass++; console.log(`  ✓ ${label}`) }
  else { fail++; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`) }
}
const section = (t: string) => console.log(`\n--- ${t} ---`)

function files(root: string, ext = /\.tsx$/): string[] {
  const out: string[] = []
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = `${dir}/${e.name}`
      if (e.isDirectory()) walk(full)
      else if (ext.test(e.name)) out.push(full)
    }
  }
  walk(root)
  return out
}
const read = (f: string) => readFileSync(f, 'utf8')
/** Comments describe intent; they are not rendered. */
const code = (f: string) => read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

try {
  section('The rule itself')
  check('the ID is the primary line', identityLines({ cueverseId: 'l_croz_l', preferredName: 'Craig' }).primary === 'l_croz_l')
  check('...and the name is the secondary', identityLines({ cueverseId: 'l_croz_l', preferredName: 'Craig' }).secondary === 'Craig')
  check('the compact form is "ID · Name"', identityText({ cueverseId: 'l_croz_l', preferredName: 'Craig' }) === 'l_croz_l · Craig')
  check('a blank Preferred Name leaves the ID alone', identityLines({ cueverseId: 'l_croz_l' }).primary === 'l_croz_l')
  check('...with nothing invented beneath it', identityLines({ cueverseId: 'l_croz_l' }).secondary === null)

  section('Two players sharing a Preferred Name stay distinguishable')
  /*
   * The whole point, stated as a test. Six Chrises render six different identities.
   */
  const chrises = ['aka_pomking', 'chris.dogg', 'x_chris_x', 'chris_2', 'chrisk', 'kris'].map(
    (id) => identityText({ cueverseId: id, preferredName: 'Chris' }),
  )
  check(`six players called Chris produce six distinct identities (${new Set(chrises).size})`,
    new Set(chrises).size === chrises.length)
  check('...and none of them is just "Chris"', chrises.every((c) => c !== 'Chris'))
  check('...each carrying its own handle', chrises.every((c, i) => c.startsWith(['aka_pomking', 'chris.dogg', 'x_chris_x', 'chris_2', 'chrisk', 'kris'][i])))

  section('A record with no CueVerse ID is an integrity problem, not a silent fallback')
  const broken = identityLines({ preferredName: 'Chris' })
  check('the name is shown because there is nothing else', broken.primary === 'Chris')
  check('...and a record with neither half is marked, not blanked', identityLines(null).primary === NO_IDENTITY)
  const missing = await prisma.player.count({
    where: { linkedUserId: { not: null }, OR: [{ cueverseId: null }, { cueverseId: '' }] },
  })
  check(`no member account is missing its CueVerse ID (${missing})`, missing === 0)

  section('No surface renders a bare display name')
  /*
   * `entrantName`, `homeUsername`, `championName` and friends hold a display string with no handle
   * attached. Rendering one is fine — as long as the same file can also reach the CueVerse ID.
   */
  const BARE = /\b(entrantName|homeUsername|awayUsername|championName|runnerUpName|displayName)\b/
  const HAS_IDENTITY = /identityLines|identityText|PlayerName|PublicPlayerIdentity|cueverseid|CueVerse ID|identity\./i
  const offenders: string[] = []
  for (const f of [...files('src/components'), ...files('src/app')]) {
    const c = code(f)
    if (BARE.test(c) && !HAS_IDENTITY.test(c)) offenders.push(f.replace('src/', ''))
  }
  /*
   * Two public views still render a bare seeded username: the Tournament bracket sides and the group
   * match rows. Neither data layer carries the handle yet, so fixing them means threading it through
   * those views — real work, not a styling change. This check is left failing deliberately rather
   * than allow-listed, because an allow-list is how a known gap becomes a permanent one.
   */
  check('every file rendering a display name can also reach the handle', offenders.length === 0,
    offenders.join(', '))

  section('The boards that prompted the rule')
  const board = code('src/components/creator/playoff-workspace.tsx')
  check('the playoff draft board resolves a handle per slot', board.includes('identityOf'))
  check('...rendering it through the shared formatter', board.includes('identityLines('))
  check('...and putting it in the accessible name', board.includes('identityText('))

  const scoring = code('src/components/creator/playoff-scoring.tsx')
  check('the playoff scoring board carries a handle per side', scoring.includes('slot.cueverseId'))
  check('...rendered through the shared formatter', scoring.includes('identityLines('))
  check('...and in the score field’s accessible name', /aria-label=\{`\$\{[^}]*identityText/.test(scoring))

  const view = readFileSync('src/lib/seasons/playoff-scoring-view.ts', 'utf8')
  check('the scoring view loads entrant handles', view.includes('cueverseId: e.cueverseId'))
  check('...keyed by entrant rather than matched on a name', view.includes('identityOf.get(entrantId)'))

  section('No matcher decides identity from a Preferred Name')
  /*
   * Display is half the rule. The other half is that nothing RESOLVES a player by their name — an
   * archive importer or a duplicate check that matches on "Chris" will merge two people.
   */
  const matchers = [...files('src/lib', /\.ts$/)].filter((f) =>
    /archive|identity|merge|duplicate/i.test(f))
  const nameMatchers: string[] = []
  for (const f of matchers) {
    const c = code(f)
    // A lookup keyed only on a display name, with no handle or alias in the same expression.
    if (/findFirst\(\{\s*where:\s*\{\s*(primaryName|displayName)\s*:/.test(c)) nameMatchers.push(f)
  }
  check('no service resolves a player from a display name alone', nameMatchers.length === 0,
    nameMatchers.join(', '))
} finally {
  console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
}

await prisma.$disconnect()
if (fail > 0) process.exitCode = 1
