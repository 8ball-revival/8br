/**
 * Public terminology: nothing a visitor reads says "Cup".
 *
 * The product type is called a Tournament, as it is on the live site. This guard used to enforce
 * the opposite — the Cup rename was never deployed — and its polarity is simply reversed rather
 * than deleted, because the sweep itself is the valuable part: "obvious copy" is not a category a
 * compiler knows about, so this reads every source file and fails on any string that reaches a
 * reader and still says Cup.
 *
 * ── Why an allowlist rather than a clever regex ──────────────────────────────────────────────────
 * Plenty of legitimate occurrences remain: the `'cup'` discriminant several unions turn on, the
 * `cups` prop the list component has always taken, `cupNumber`/`cupRecord` keys that URLs and saved
 * views depend on, and the generated-cups.json fixture filename. Renaming those breaks bookmarks
 * and migrations while changing no word anybody reads.
 *
 * The tempting shortcut is one broad exclusion — skip anything matching /cup[A-Z]/, say — which
 * silently swallows real failures the day somebody writes `cupLabel = 'Cup'`.
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
  { path: 'src/lib/tournaments/data', why: 'generated-cups.json and the fixtures read from it, keyed by filename' },
  { path: 'src/lib/creator/setup.ts', why: "the 'cup' record-type discriminant the Creator flow branches on" },
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
const WORD = /(?<![A-Za-z0-9_])[Cc]ups?(?![A-Za-z0-9_])/

/** Bodies that are internal even though they sit inside quotes, each with the reason. */
const EXEMPT_PATTERNS: { re: RegExp; why: string }[] = [
  { re: /^\s*(\/\/|\*|\/\*)/, why: 'a comment — explains internals to a developer, renders nowhere' },
  { re: /^\s*import|import\(/, why: 'a module specifier, not a sentence' },
]

/** String and JSX bodies that name something rather than describe it. */
const EXEMPT_BODIES: { re: RegExp; why: string }[] = [
  { re: /^\/?cups?\/?$/, why: 'the legacy route, which the permanent redirects cover' },
  { re: /^[@./]|^https?:/, why: 'a module specifier or a URL path' },
  { re: /^cup$|^cups$/, why: 'a discriminant or a filter value the UI switches on' },
  { re: /^cup[A-Z]/, why: 'a state or column key — cupRecord, cupChampionsOnly — that saved views carry' },
  { re: /generated-cups/, why: 'the fixture filename on disk' },
  { re: /^cups?[-_][a-z]/, why: 'a URL or state key — renaming it would break existing bookmarks' },
  { re: /^cup-$/, why: 'the export-filename fragment saved CSV links already carry' },
  { re: /^\[cups\]/, why: 'a server log prefix — read in a terminal, never by a visitor' },
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

section('No visible Cup labels remain')
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
  check('no unexplained Cup text in shipped source', offenders.length === 0, String(offenders.length))
}

section('The Tournament vocabulary is the one in use')
{
  const nav = readFileSync('src/lib/nav.ts', 'utf8')
  check('navigation offers Tournaments as a top-level tab', nav.includes("label: 'Tournaments', href: '/tournaments'"))
  check('...beside Seasons', nav.includes("label: 'Seasons', href: '/seasons'"))
  check('...and nothing is called Cups', !/label: 'Cups'/.test(nav))

  const cols = readFileSync('src/lib/stats/rankings-columns.ts', 'utf8')
  check('the Rankings record column is Tournament W–L', cols.includes("short: 'Tournament W–L'"))
  check('the Rankings titles column is Tournament Titles', cols.includes("label: 'Tournament Titles'"))
  // Stacked the same way Season Championships is: the full phrase in `short` too, so the header
  // wraps onto two lines instead of abbreviating to something narrower beside it.
  check('...stacked like Season Championships', cols.includes("short: 'Tournament Titles'"))
  check('...and Season Championships still is', cols.includes("short: 'Season Championships'"))
  check('nothing still says Cup Titles', !cols.includes('Cup Titles'))
  check('nothing still says Cup W–L', !cols.includes('Cup W–L'))

  // "Tournament Winner" is not the title — a Tournament has a titleholder.
  const all = ROOTS.flatMap((r) => walk(r))
    .filter((f) => !exemptFile(f))
    .map((f) => readFileSync(f, 'utf8'))
    .join('\n')
  check('no surface calls anybody a Cup Winner', !/Cup Winner/.test(all))
}

section('Legacy routes still resolve')
{
  const redirects = [
    // The Live and Archives sections were folded into /seasons and /tournaments. Their URLs are in
    // the wild — in bookmarks, in shared links — so every one of them still resolves.
    ['src/app/(frontend)/live/tournaments/route.ts', '/tournaments'],
    ['src/app/(frontend)/archives/tournaments/route.ts', '/tournaments'],
    ['src/app/(frontend)/live/seasons/route.ts', '/seasons'],
    ['src/app/(frontend)/live/cups/route.ts', '/tournaments'],
    ['src/app/(frontend)/archives/seasons/route.ts', '/seasons'],
    ['src/app/(frontend)/archives/cups/route.ts', '/tournaments'],
    // Creator's Tournament URLs land in the Tournaments section, translating the internal id.
    ['src/app/(frontend)/creator/tournaments/[id]/route.ts', '/tournaments'],
  ]
  for (const [file, target] of redirects) {
    let src = ''
    try { src = readFileSync(file, 'utf8') } catch { check(`${file} exists`, false, 'missing'); continue }
    check(`${file} redirects to ${target}`, src.includes(target), 'target not found')
    check(`${file} is permanent or a redirect`, /redirect|308|permanent/i.test(src))
  }

  /*
   * The /cups mapping lives in next.config, and nowhere else.
   *
   * It was once duplicated by route handlers under /tournaments pointing the other way; the two
   * aimed at each other and every public URL bounced until the browser gave up. Both halves are
   * pinned here: the config entries exist, and no route file competes with them.
   */
  const cfg = readFileSync('next.config.ts', 'utf8')
  check('/cups redirects to /tournaments', /source: '\/cups',\s*destination: '\/tournaments'/.test(cfg))
  check('...and every path beneath it', /source: '\/cups\/:path\*',\s*destination: '\/tournaments\/:path\*'/.test(cfg))
  check('...permanently', /permanent: true/.test(cfg))
  for (const gone of ['src/app/(frontend)/tournaments/route.ts', 'src/app/(frontend)/tournaments/[number]/route.ts']) {
    let exists = true
    try { readFileSync(gone, 'utf8') } catch { exists = false }
    check(`no handler at ${gone} to loop against the config`, !exists)
  }
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
