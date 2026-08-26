/**
 * Public competition pages are read-only, and look the same to everybody.
 *
 * ── The rule ─────────────────────────────────────────────────────────────────────────────────────
 * A public Season or Tournament page renders results. It offers no Settings, no Create, no Rename,
 * no Edit, no Delete, no scoring and no lifecycle control, to anybody — including an Owner. All of
 * that lives in Creator.
 *
 * ── Why "hidden from members" is not good enough ─────────────────────────────────────────────────
 * The version this replaces did gate its controls: `{canManage && <Settings/>}`. That is a public
 * route whose markup changes shape depending on who is reading it, which means two designs to keep
 * in step and one permission flag standing between them. It also meant the same competition could
 * be edited from two different screens with two different sets of controls, and whichever one
 * somebody happened to open decided what they could do.
 *
 * Removing the controls, rather than hiding them, is the only version that cannot regress into
 * being shown to the wrong person — because there is nothing left to show.
 *
 * ── What this does and does not prove ────────────────────────────────────────────────────────────
 * This is a source audit: it proves the components cannot render management controls. It does not
 * replace the server-side authorisation on the actions themselves, which is enforced independently
 * and is what actually stops anybody doing anything. Both matter; this is the cheaper half.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'

let pass = 0
let fail = 0
const check = (label: string, ok: boolean, detail?: string) => {
  if (ok) { pass++; console.log(`  ✓ ${label}`) }
  else { fail++; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`) }
}
const section = (t: string) => console.log(`\n--- ${t} ---`)

/** Comments explain why a control was removed and must name it to do so. Judge what renders. */
const codeOf = (f: string) =>
  readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

function walk(root: string): string[] {
  if (!existsSync(root)) return []
  const out: string[] = []
  const go = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = `${dir}/${e.name}`
      if (e.isDirectory()) go(full)
      else if (/\.tsx?$/.test(e.name)) out.push(full)
    }
  }
  go(root)
  return out
}

/*
 * The public competition surfaces. Creator and Staff routes are deliberately absent: management is
 * their entire purpose.
 */
const PUBLIC_ROUTES = [
  'src/app/(frontend)/seasons',
  'src/app/(frontend)/tournaments',
]
const PUBLIC_COMPONENTS = [
  'src/components/seasons/season-controls.tsx',
  'src/components/seasons/season-masthead.tsx',
  'src/components/seasons/season-presentation.tsx',
  'src/components/seasons/season-standings-matrix.tsx',
  'src/components/seasons/season-bracket-panel.tsx',
]

section('No management control is rendered on a public competition page')
{
  /*
   * Phrases as they would appear in a control's LABEL. Deliberately not matching function names or
   * props: `canManage` reaching a component is not itself the fault, rendering an editor is.
   */
  const FORBIDDEN: [string, RegExp][] = [
    ['Create Season', />\s*Create Season|Create Season\s*</],
    ['Create Tournament', />\s*Create Tournament|Create Tournament\s*</],
    ['Settings link', />\s*Settings\s*<|>\s*Season Settings|>\s*Tournament Settings/],
    ['Rename', />\s*Rename|Rename\s*</],
    ['Delete', />\s*Delete\s*<|>\s*Delete Season|>\s*Delete Tournament/],
    ['Close/Reopen lifecycle', />\s*Close (Season|Groups|Tournament)|>\s*Reopen (Season|Groups)/],
    ['Save Group', />\s*Save Group/],
    ['Build bracket', />\s*Build Playoff Bracket|>\s*Place Entrants/],
  ]

  const files = [...PUBLIC_ROUTES.flatMap(walk), ...PUBLIC_COMPONENTS.filter(existsSync)]
  check('there are public competition files to audit', files.length > 0, `${files.length}`)

  for (const [label, re] of FORBIDDEN) {
    const hits = files.filter((f) => re.test(codeOf(f))).map((f) => f.replace('src/', ''))
    check(`no ${label} on a public page`, hits.length === 0, hits.slice(0, 3).join(', '))
  }
}

section('The public pages do not branch their layout on permission')
{
  /*
   * A permission flag may still reach these files — the Season page uses one to decide whether to
   * link somebody TO Creator, which is a signpost rather than a control. What must not happen is a
   * management SURFACE appearing behind it.
   */
  const controls = codeOf('src/components/seasons/season-controls.tsx')
  check('the Season control bar takes no management props',
    !/settingsHref|createHref|canManage/.test(controls))

  const page = codeOf('src/app/(frontend)/seasons/[seasonId]/page.tsx')
  check('the Season page passes no management hrefs to the public bar',
    !/settingsHref=|createHref=/.test(page))
}

section('Editing lives in Creator, and Creator still has it')
{
  /*
   * The other half of the rule. Removing controls from the public page is only correct if they exist
   * somewhere — otherwise this audit would pass beautifully on a site where nothing can be edited.
   */
  const creator = walk('src/app/(frontend)/creator')
  check('Creator routes exist', creator.length > 0, `${creator.length} files`)
  const creatorText = creator.map(codeOf).join('\n')
  check('...and Creator is where a Season is set up',
    /groups|playoffs|entrants/i.test(creatorText))

  const groupStage = existsSync('src/components/seasons/season-group-stage.tsx')
    ? codeOf('src/components/seasons/season-group-stage.tsx') : ''
  check('...and the group-stage editor still offers Close Groups',
    groupStage.includes('Close Groups'), 'score entry must remain available in Creator')
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
