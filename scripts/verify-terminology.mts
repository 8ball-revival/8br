/**
 * Public terminology: nothing a visitor reads says "Tournament".
 *
 * The product type is called a Cup. The rename moved navigation, routes and the obvious copy, but
 * "obvious copy" is not a category a compiler knows about, so this sweeps every source file for
 * strings that reach a reader and fails on any that still say Tournament.
 *
 * ── Why an allowlist rather than a clever regex ──────────────────────────────────────────────────
 * Plenty of legitimate occurrences remain: the Prisma model, its table, its enums, the services and
 * types built on them, and the `'tournament'` discriminant that several unions turn on. Renaming
 * those is a schema migration that would change no word anybody reads.
 *
 * The tempting shortcut is one broad exclusion — skip anything matching /tournament[A-Z]/, say —
 * which silently swallows real failures the day somebody writes `tournamentLabel = 'Tournament'`.
 * So exclusions are enumerated instead: each is a specific pattern with a stated reason, and
 * anything not matching one of them is a failure. The list is auditable; a regex is not.
 *
 * Run:  npx tsx --tsconfig scripts/tsconfig.verify.json scripts/verify-terminology.mts
 */
import { readFileSync, readdirSync } from 'node:fs'

let pass = 0, fail = 0
const check = (n: string, c: boolean, d = '') => {
  if (c) { pass++ } else { fail++; console.log('  FAIL ' + n + (d ? ` — ${d}` : '')) }
}
const section = (s: string) => console.log(`\n${s}`)

/**
 * Files exempt in full, with the reason.
 *
 * Each of these is a data layer or a piece of authored history. None of them renders a label.
 */
const EXEMPT_FILES: { path: string; why: string }[] = [
  { path: 'prisma/schema.prisma', why: 'the model, its table and its enums — a rename here is a migration' },
  { path: 'src/lib/competition/tournament-create.ts', why: 'creation service for the Tournament model' },
  { path: 'src/lib/competition/tournament-lifecycle.ts', why: 'lifecycle service for the Tournament model' },
  { path: 'src/lib/competition/tournament-sync.ts', why: 'sync service for the Tournament model' },
  { path: 'src/lib/competition/tournament-actions.ts', why: 'server actions over the Tournament model' },
  { path: 'src/lib/tournaments', why: 'the Tournament data layer in full' },
  { path: 'src/lib/verification/fixture-actors.ts', why: 'names of historical verify fixtures' },
]

/**
 * What a reader actually sees.
 *
 * Two earlier attempts got this wrong in opposite directions. A list of thirty-odd identifier
 * patterns was unmaintainable and grew faster than the code it excused. A "standalone word" rule
 * then flagged every local variable called `tournament`, which no visitor will ever read.
 *
 * The right question is not how the word is spelled but WHERE IT SITS: a label lives inside a string
 * literal or between JSX tags. An identifier, a property key, a model accessor and a type name never
 * do. So the scan looks only at string bodies and JSX text, and the identifier problem disappears
 * rather than being enumerated.
 */
const STRINGS = /'((?:\\.|[^'\\])*)'|"((?:\\.|[^"\\])*)"|`((?:\\.|[^`\\])*)`/g
const JSX_TEXT = />([^<>{}]*)</g
const WORD = /(?<![A-Za-z0-9_])[Tt]ournaments?(?![A-Za-z0-9_])/

/** Bodies that are internal even though they sit inside quotes, each with the reason. */
const EXEMPT_PATTERNS: { re: RegExp; why: string }[] = [
  { re: /^\s*(\/\/|\*|\/\*)/, why: 'a comment — explains internals to a developer, renders nowhere' },
  { re: /^\s*import|import\(/, why: 'a module specifier, not a sentence' },
]

/** String and JSX bodies that name something rather than describe it. */
const EXEMPT_BODIES: { re: RegExp; why: string }[] = [
  { re: /^\/?tournaments?\/?$/, why: 'an internal key or the legacy route, which the redirects already cover' },
  { re: /^[@./]|^https?:/, why: 'a module specifier or a URL path' },
  { re: /ego-tournament-1/, why: 'the slug of a real historical record — renaming it would break its URL' },
  { re: /comp_tournament|tournament_(group|playoff|titles|name|started|completed|cancelled)/,
    why: 'a physical table or column name in raw SQL' },
  { re: /^tournament$|^tournaments$/, why: 'a discriminant or a filter value' },
  { re: /^tournaments?:\s*$/, why: 'half of a composite row key built by string concatenation' },
  { re: /^tournament\.[a-z]/, why: 'an audit ACTION key — a stable machine identifier that historical rows already carry' },
  { re: /^tournaments?[-_][a-z]/, why: 'a URL or state key — renaming it would break existing bookmarks' },
]

/** Where visible copy can live. Scripts and verification harnesses are not shipped to anybody. */
const ROOTS = ['src']

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = `${dir}/${e.name}`
    if (e.isDirectory()) walk(full, out)
    else if (/\.(tsx?|css)$/.test(e.name)) out.push(full)
  }
  return out
}

const exemptFile = (path: string) => EXEMPT_FILES.find((e) => path.replace(/\\/g, '/').includes(e.path))
const exemptLine = (line: string) => EXEMPT_PATTERNS.find((e) => e.re.test(line))
const exemptBody = (body: string) => EXEMPT_BODIES.find((e) => e.re.test(body.trim()))

/** Every string body and JSX text node on this line. */
function readableParts(line: string): string[] {
  const parts: string[] = []
  // A trailing comment is still a comment. Anything after an unquoted // explains the code to a
  // developer and renders nowhere, so it is dropped before the strings are read out.
  const comment = line.search(/(^|[^:'"`])\/\//)
  if (comment >= 0) line = line.slice(0, comment)
  // A template literal's ${...} holds code, not prose — the same masking the sweep applies.
  const mask = (body: string) => body.replace(/\$\{[^}]*\}/g, ' ')
  for (const m of line.matchAll(STRINGS)) parts.push(mask(m[1] ?? m[2] ?? m[3] ?? ''))
  for (const m of line.matchAll(JSX_TEXT)) parts.push(m[1])
  return parts
}

section('Documented allowlist')
{
  check('every exempt file states a reason', EXEMPT_FILES.every((e) => e.why.length > 10))
  check('every exempt pattern states a reason', EXEMPT_PATTERNS.every((e) => e.why.length > 10))
  check('every exempt string body states a reason', EXEMPT_BODIES.every((e) => e.why.length > 10))
  // A single catch-all would hide real failures; the list is deliberately specific and long.
  check('no exemption is a bare catch-all',
    !EXEMPT_PATTERNS.some((e) => e.re.source === 'tournament' || e.re.source === '.*'))
  console.log(`  ${EXEMPT_FILES.length} exempt files, ${EXEMPT_PATTERNS.length} line exemptions, ${EXEMPT_BODIES.length} string exemptions — each with a stated reason`)
}

section('No visible Tournament labels remain')
{
  const offenders: string[] = []
  let scanned = 0
  for (const root of ROOTS) {
    for (const file of walk(root)) {
      if (exemptFile(file)) continue
      scanned++
      const lines = readFileSync(file, 'utf8').split(/\r?\n/)
      lines.forEach((line, i) => {
        if (exemptLine(line)) return
        for (const body of readableParts(line)) {
          if (!WORD.test(body)) continue
          if (exemptBody(body)) continue
          offenders.push(`${file}:${i + 1}  ${body.trim().slice(0, 100)}`)
          return
        }
      })
    }
  }
  console.log(`  scanned ${scanned} files`)
  if (offenders.length) {
    console.log('  Remaining occurrences that are not covered by the allowlist:')
    for (const o of offenders) console.log('    ' + o)
  }
  check('no unexplained Tournament text in shipped source', offenders.length === 0, String(offenders.length))
}

section('The Cup vocabulary is the one in use')
{
  const nav = readFileSync('src/lib/nav.ts', 'utf8')
  check('navigation offers Cups under Live', nav.includes("label: 'Cups', href: '/live/cups'"))
  check('navigation offers Cups under Archives', nav.includes("label: 'Cups', href: '/archives/cups'"))

  const cols = readFileSync('src/lib/stats/rankings-columns.ts', 'utf8')
  check('the Rankings column is Cup Titles', cols.includes('Cup Titles'))
  check('...and no column says Tournament Championships', !cols.includes('Tournament Championships'))

  // "Cup Winner" was rejected as a primary title — a Cup has a titleholder.
  const all = ROOTS.flatMap((r) => walk(r))
    .filter((f) => !exemptFile(f))
    .map((f) => readFileSync(f, 'utf8'))
    .join('\n')
  check('no surface calls anybody a Cup Winner', !/Cup Winner/.test(all))
}

section('Legacy routes still resolve')
{
  const redirects = [
    ['src/app/(frontend)/tournaments/route.ts', '/archives/cups'],
    ['src/app/(frontend)/tournaments/[number]/route.ts', '/cups/'],
    ['src/app/(frontend)/live/tournaments/route.ts', '/live/cups'],
    ['src/app/(frontend)/archives/tournaments/route.ts', '/archives/cups'],
    ['src/app/(frontend)/creator/tournaments/[id]/route.ts', '/creator/cups/'],
  ]
  for (const [file, target] of redirects) {
    let src = ''
    try { src = readFileSync(file, 'utf8') } catch { check(`${file} exists`, false, 'missing'); continue }
    check(`${file} redirects to ${target}`, src.includes(target), 'target not found')
    check(`${file} is permanent or a redirect`, /redirect|308|permanent/i.test(src))
  }

  // A redirect that drops the query string breaks every shared filtered link.
  const index = readFileSync('src/app/(frontend)/tournaments/route.ts', 'utf8')
  check('the legacy index preserves query parameters', /search|query/i.test(index))
  const detail = readFileSync('src/app/(frontend)/tournaments/[number]/route.ts', 'utf8')
  check('the legacy detail route preserves the record id', detail.includes('number'))
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
