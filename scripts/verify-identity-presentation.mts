/**
 * The CueVerse ID is the identity. This audit stops a surface quietly deciding otherwise.
 *
 * ── The rule ─────────────────────────────────────────────────────────────────────────────────────
 * Wherever a player appears, the CueVerse ID is present and it is the primary line. The Preferred
 * Name may sit beneath or beside it. Nothing renders a Preferred Name on its own.
 *
 * ── Why it needs enforcing mechanically ──────────────────────────────────────────────────────────
 * Because the wrong version is easier to write. A row has a `preferredName` field on it, printing
 * that field is one expression, and the result looks perfectly reasonable in isolation — right up
 * until the page contains the second Chris. This site has six of them and six Craigs.
 *
 * That is exactly how the Rankings ladder ended up leading with the Preferred Name while every
 * other surface led with the handle: nobody decided to disagree, one component was simply written
 * on its own and never compared. So the check is not "does the current code look right", it is
 * "can a new surface print a bare Preferred Name without anybody noticing".
 *
 * ── What is scanned ──────────────────────────────────────────────────────────────────────────────
 * JSX that renders a `preferredName`-ish field directly, outside the components whose job it is to
 * render identities. The allow-list is short and each entry is justified where it appears.
 */
import { readFileSync, readdirSync } from 'node:fs'

import { identityLines, identityText } from '../src/lib/identity/display.ts'
import { identityShape } from '../src/components/rankings/identity-cell.tsx'

let pass = 0
let fail = 0
const check = (label: string, ok: boolean, detail?: string) => {
  if (ok) { pass++; console.log(`  ✓ ${label}`) }
  else { fail++; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`) }
}
const section = (t: string) => console.log(`\n--- ${t} ---`)

function tsxFiles(root: string): string[] {
  const out: string[] = []
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = `${dir}/${e.name}`
      if (e.isDirectory()) walk(full)
      else if (/\.tsx$/.test(e.name)) out.push(full)
    }
  }
  walk(root)
  return out
}

section('The canonical rule: the handle leads')
{
  check('a full identity leads with the CueVerse ID',
    identityLines({ cueverseId: 'cue.ball', preferredName: 'James' }).primary === 'cue.ball')
  check('...and carries the preferred name as the second line',
    identityLines({ cueverseId: 'cue.ball', preferredName: 'James' }).secondary === 'James')

  check('a duplicate second line is dropped rather than printed twice',
    identityLines({ cueverseId: 'Starkiller', preferredName: 'starkiller' }).secondary === null)

  check('with no handle the preferred name is all there is, and nothing is invented',
    identityLines({ cueverseId: null, preferredName: 'Ross' }).primary === 'Ross')
  check('...and that case is reported honestly as name-only',
    identityShape({ cueverseId: null, preferredName: 'Ross' }) === 'name-only')

  check('an empty identity still produces something to render',
    identityLines({ cueverseId: null, preferredName: '' }).primary.length > 0)

  check('the one-line form names both halves',
    identityText({ cueverseId: 'aka_pomking', preferredName: 'Chris' }) === 'aka_pomking · Chris')
}

section('Rankings and the rest of the site agree')
{
  /*
   * The specific regression this exists for. These two components render identities on different
   * surfaces, and they disagreed for months without either being wrong on its own.
   */
  const cell = readFileSync('src/components/rankings/identity-cell.tsx', 'utf8')
  check('the Rankings cell delegates the ordering rather than deciding it',
    cell.includes('identityLines'),
    'IdentityCell must not choose which half leads')
  check('...and no longer paints a name in championship gold',
    !/text-\[var\(--gold\)\]/.test(cell),
    'gold means a title, not a name')

  const playerName = readFileSync('src/components/identity/player-name.tsx', 'utf8')
  check('PlayerName delegates the same way', playerName.includes('identityLines'))
}

section('No surface prints a bare preferred name')
{
  /*
   * The files allowed to touch the raw field, and why:
   *  - display.ts / player-name / identity-cell  are the implementation of the rule itself.
   *  - forms and editors                          edit the field, so they must render its value.
   *  - identity/admin tooling                     exists to show and reconcile the two halves.
   */
  const ALLOWED = [
    'lib/identity/display.ts',
    'components/identity/player-name.tsx',
    'components/rankings/identity-cell.tsx',
    'components/identity/public-player-identity.tsx',
    'components/identity/registration-identity-summary.tsx',
    'components/identity/profile-completion-notice.tsx',
  ]

  /*
   * A bare render is the field appearing as JSX CHILDREN - `>{x.preferredName}<` - and not as the
   * value of an attribute.
   *
   * The distinction matters and the first version of this check got it wrong, flagging four
   * innocent files. `value={preferredName}` on a text input is the field being EDITED, and
   * `championName={...}` is a value being handed to a component whose own job is to render the
   * identity properly. Neither is a decision about how a player is displayed. Only an expression
   * printed directly into the document is.
   *
   * The negative lookbehind for `=` is what draws that line: an attribute is always `name={`.
   */
  const BARE = /(?<![=\w])\{\s*[\w.?]*(?:preferredName|championName|runnerUpName)\s*\}/
  /*
   * Case-insensitive, because the field is spelled `cueverseId` on a Player and `championCueverseId`
   * on a Season. The first version matched only the lower-case form and so reported a component that
   * passes the handle on the very next line.
   */
  const NEAR_HANDLE = /(cueverse|handle|identity|PlayerName|IdentityCell)/i

  const offenders: string[] = []
  for (const file of tsxFiles('src')) {
    const rel = file.replace('src/', '')
    if (ALLOWED.some((a) => rel.endsWith(a))) continue
    const lines = readFileSync(file, 'utf8').split('\n')
    lines.forEach((line, i) => {
      if (!BARE.test(line)) return
      // A window either side, because the handle is often on the neighbouring line in a two-line cell.
      const around = lines.slice(Math.max(0, i - 3), i + 4).join(' ')
      if (!NEAR_HANDLE.test(around)) offenders.push(`${rel}:${i + 1}`)
    })
  }
  check('no component renders a preferred name with no handle anywhere near it',
    offenders.length === 0, offenders.slice(0, 8).join(', '))
}

section('Identity is resolved through the canonical player, not by name')
{
  /*
   * Grouping or comparing by Preferred Name is the same fault one level down: two different people
   * called Chris become one row, and one person who renamed becomes two. Aliases exist precisely so
   * this never has to be done by string.
   */
  const byName: string[] = []
  for (const file of [...tsxFiles('src'), ...tsxFiles('src').map((f) => f.replace(/\.tsx$/, '.ts'))]) {
    let src: string
    try { src = readFileSync(file, 'utf8') } catch { continue }
    for (const m of src.matchAll(/\.(?:groupBy|findIndex|find|filter)\([^)]*preferredName\s*===/g)) {
      byName.push(`${file.replace('src/', '')}: ${m[0].slice(0, 60)}`)
    }
  }
  check('nothing matches players by comparing preferred names', byName.length === 0, byName.join(' | '))
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
