/**
 * No client component may value-import a `server-only` module.
 *
 * ── The mistake this exists for ──────────────────────────────────────────────────────────────────
 * A `'use client'` component needed one constant — a list of four labels — that happened to live in
 * `ladder-explorer`, which is `server-only`. Changing
 *
 *     import type { ExplorerRow } from '@/lib/stats/ladder-explorer'
 * to
 *     import { RECORD_VIEWS, type ExplorerRow } from '@/lib/stats/ladder-explorer'
 *
 * looked like adding one name to an import that was already there. It is not the same thing at all:
 * a type import is erased at compile time, and a value import pulls the module and everything it
 * touches into the BROWSER bundle. In this case that was Prisma, Payload, `pg`, `pino` and a dozen
 * node builtins, and the build failed with forty screens of "Can't resolve 'fs'".
 *
 * What made it dangerous was how it failed. The page still server-rendered perfectly — every row,
 * every filter, correct data — so it looked fine. Only the client bundle was broken, so nothing on
 * the page responded to a click. A reviewer reading the diff sees one added identifier; a reviewer
 * loading the page sees a working table.
 *
 * The fix was to move the constant to a client-safe module, which is where a list of labels belonged
 * anyway. This check makes the next occurrence a failing test rather than a puzzling afternoon.
 */
import { readFileSync, readdirSync } from 'node:fs'

let pass = 0
let fail = 0
const check = (label: string, ok: boolean, detail?: string) => {
  if (ok) { pass++; console.log(`  ✓ ${label}`) }
  else { fail++; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`) }
}
const section = (t: string) => console.log(`\n--- ${t} ---`)

function walk(root: string, test: RegExp): string[] {
  const out: string[] = []
  const go = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = `${dir}/${e.name}`
      if (e.isDirectory()) go(full)
      else if (test.test(e.name)) out.push(full)
    }
  }
  go(root)
  return out
}

const ALL = walk('src', /\.(ts|tsx)$/)
const read = (f: string) => readFileSync(f, 'utf8')

/** Modules that declare themselves server-only, by their import specifier. */
const serverOnly = new Set<string>()
for (const f of ALL) {
  if (/^\s*import ['"]server-only['"]/m.test(read(f))) {
    serverOnly.add(f.replace(/^src\//, '@/').replace(/\.tsx?$/, ''))
  }
}

section('The map of server-only modules')
check('server-only modules are present and detected', serverOnly.size > 0, `${serverOnly.size} found`)

section('No client component imports a value from one')
{
  const clientFiles = ALL.filter((f) => /^\s*['"]use client['"]/m.test(read(f)))
  check('client components exist to check', clientFiles.length > 0, `${clientFiles.length}`)

  const offenders: string[] = []
  for (const file of clientFiles) {
    /*
     * Comments are stripped first, and imports are anchored to the start of a line.
     *
     * Without both, this scan reports its own documentation: the prose above contains the words
     * "import" and "from", and a pattern that scans raw text will happily match from a word in a
     * comment to the next real specifier - which is exactly how the first version of this check
     * flagged a file whose import it had already confirmed was type-only, two assertions later.
     */
    const src = read(file)
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
    /*
     * Every import statement, with its `type` marker if it has one. `import type { … }` and
     * `import { type X }` are both erased; anything else brings the module along at runtime.
     */
    for (const m of src.matchAll(/^\s*import\s+(type\s+)?([^;]*?)\s+from\s+['"]([^'"]+)['"]/gm)) {
      const isTypeOnly = Boolean(m[1])
      const clause = m[2]
      const spec = m[3]
      if (!serverOnly.has(spec)) continue
      if (isTypeOnly) continue
      /*
       * A braced clause where EVERY name is marked `type` is also fully erased. Checked rather than
       * assumed, so `import { type A, B }` is still caught on B.
       */
      const braced = /^\{([\s\S]*)\}$/.exec(clause.trim())
      if (braced) {
        const names = braced[1].split(',').map((n) => n.trim()).filter(Boolean)
        if (names.length > 0 && names.every((n) => n.startsWith('type '))) continue
      }
      offenders.push(`${file.replace('src/', '')} → ${spec}`)
    }
  }
  check('no client component pulls a server-only module into the browser bundle',
    offenders.length === 0, offenders.slice(0, 6).join(' | '))
}

section('The specific module that caused it stays type-only in the client')
{
  const explorer = read('src/components/rankings/rankings-explorer.tsx')
  const line = /import[^\n]*from '@\/lib\/stats\/ladder-explorer'/.exec(explorer)?.[0] ?? ''
  check('the Rankings explorer imports ladder-explorer as types only',
    line.includes('import type'), line || 'no import found')
  check('...and takes the record views from the client-safe module instead',
    /RECORD_VIEWS[^\n]*from '@\/lib\/stats\/rankings-columns'/.test(explorer)
    || explorer.includes('RECORD_VIEWS,'),
    'RECORD_VIEWS must not come from a server-only module')
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
