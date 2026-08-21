/**
 * Source files must not contain control bytes that a database will reject.
 *
 * The Break's post query used a literal NUL byte as an "id nobody could hold" sentinel:
 *
 *     : { where: { playerId: '\0none' }, select: { value: true } },
 *
 * Postgres accepts a NUL in no text value at all — it answers 22021, "invalid byte sequence for
 * encoding UTF8: 0x00", and fails the whole query. Every logged-out read of a post therefore died at
 * the database, which surfaced as "Something went wrong" on the article page. Nothing caught it
 * because a NUL is invisible in an editor and typechecks perfectly happily as part of a string.
 *
 * A byte scan catches the whole class in well under a second, so it runs over the source itself.
 *
 * Run: npx tsx --tsconfig scripts/tsconfig.verify.json --env-file=.env scripts/verify-source-hygiene.mts
 */
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const SCAN = ['src', 'scripts', 'prisma']
const EXT = new Set(['.ts', '.tsx', '.mts', '.mjs', '.js', '.jsx', '.prisma', '.sql', '.json', '.css'])
const SKIP = new Set(['node_modules', '.next', '.git', 'dist', 'build'])

let pass = 0
let fail = 0
const check = (label: string, ok: boolean, detail?: string) => {
  if (ok) { pass++; console.log(`  ✓ ${label}`) }
  else { fail++; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`) }
}

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (EXT.has(path.extname(e.name))) out.push(p)
  }
  return out
}

const files = SCAN.flatMap((d) => walk(path.join(ROOT, d)))
console.log(`--- Scanning ${files.length} source files ---`)

/**
 * NUL is the one that reaches the database and kills a query outright. The other C0 controls are
 * merely suspect in source, so they are reported separately rather than failing the run — a real
 * tab or newline is fine, an accidental 0x07 in a string is not, and telling them apart is a
 * judgement nobody should have to make at 3am because a page went blank.
 */
const nulFiles: { file: string; count: number; lines: number[] }[] = []
const oddFiles: { file: string; bytes: string[] }[] = []

for (const f of files) {
  const raw = fs.readFileSync(f)
  const rel = path.relative(ROOT, f).replace(/\\/g, '/')

  const nulAt: number[] = []
  const odd = new Set<string>()
  for (let i = 0; i < raw.length; i++) {
    const b = raw[i]
    if (b === 0) nulAt.push(i)
    else if (b < 0x09 || (b > 0x0d && b < 0x20)) odd.add('0x' + b.toString(16).padStart(2, '0'))
  }
  if (nulAt.length) {
    const lines = nulAt.map((i) => raw.subarray(0, i).toString('utf8').split('\n').length)
    nulFiles.push({ file: rel, count: nulAt.length, lines })
  }
  if (odd.size) oddFiles.push({ file: rel, bytes: [...odd] })
}

check('no source file contains a NUL byte', nulFiles.length === 0,
  nulFiles.map((n) => `${n.file} (${n.count} at line ${n.lines.join(', ')})`).join('; '))

if (oddFiles.length) {
  console.log(`\n  note: ${oddFiles.length} file(s) carry other control bytes — check they are deliberate:`)
  for (const o of oddFiles.slice(0, 10)) console.log(`    ${o.file}: ${o.bytes.join(' ')}`)
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
if (fail > 0) process.exitCode = 1
