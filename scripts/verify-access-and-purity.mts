/**
 * Three guarantees about the redesigned pages: who can reach them, who enforces that, and that
 * rendering them changes nothing.
 *
 * ── Why rendering-purity is worth a test ─────────────────────────────────────────────────────────
 * A redesign touches the code that reads data, and the easiest way to make a page faster or a figure
 * more convenient is to cache something INTO the database while rendering it. That is invisible in
 * review, invisible in the UI, and turns a page view into a write — so a bot crawling the archive
 * starts mutating it. The check is blunt and total: fingerprint every canonical table, render every
 * page, fingerprint again, and require the two to be identical.
 *
 * ── Why the access checks are source-level AND live ──────────────────────────────────────────────
 * The live half proves an anonymous reader is refused today. The source half proves the refusal is
 * decided on the SERVER — a page that renders its admin surface and hides it with CSS, or decides in
 * a client component, would pass the live check while shipping the whole thing to the browser.
 */
import { prisma } from '../src/lib/prisma.ts'
import { assertLocalDatabase } from '../src/lib/db-guard.ts'
import { readFileSync, readdirSync, existsSync } from 'node:fs'

assertLocalDatabase()

let pass = 0
let fail = 0
const check = (label: string, ok: boolean, detail?: string) => {
  if (ok) { pass++; console.log(`  ✓ ${label}`) }
  else { fail++; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`) }
}
const section = (t: string) => console.log(`\n--- ${t} ---`)

const BASE = process.env.VERIFY_BASE_URL ?? 'http://localhost:3000'

/** Every canonical table, counted, plus a checksum over the ledger's ratings. */
async function fingerprint() {
  const [
    player, season, seasonEntrant, seasonMatch, seasonStanding, seasonPlayoffMatch,
    tournament, ratingLedger, article, playerAlias,
  ] = await Promise.all([
    prisma.player.count(), prisma.season.count(), prisma.seasonEntrant.count(),
    prisma.seasonMatch.count(), prisma.seasonStanding.count(), prisma.seasonPlayoffMatch.count(),
    prisma.tournament.count(), prisma.ratingLedger.count(), prisma.article.count(),
    prisma.playerAlias.count(),
  ])
  const sum = await prisma.$queryRawUnsafe<{ s: bigint | null }[]>(
    'SELECT SUM("postRating")::bigint AS s FROM rating_ledger')
  return JSON.stringify({
    player, season, seasonEntrant, seasonMatch, seasonStanding, seasonPlayoffMatch,
    tournament, ratingLedger, article, playerAlias, ratingChecksum: String(sum[0].s),
  })
}

const PAGES = [
  '/', '/seasons', '/seasons/443?view=groups', '/seasons/443?view=playoffs',
  '/tournaments', '/tournaments/1', '/tournaments/2',
  '/rankings?platform=YAHOO', '/rankings?platform=CUEVERSE', '/achievements',
  '/the-break', '/players/deep.cerebro', '/login', '/privacy', '/terms', '/contact',
]

/** Routes that must refuse an anonymous reader. */
const GATED = ['/creator', '/staff', '/account', '/seasons/new', '/tournaments/new']

let reachable = true
try {
  const probe = await fetch(BASE, { redirect: 'manual' })
  reachable = probe.status < 500
} catch { reachable = false }

section('Rendering a page writes nothing')
if (!reachable) {
  console.log(`  (dev server not reachable at ${BASE}; the live half is skipped)`)
} else {
  const before = await fingerprint()
  const statuses: string[] = []
  for (const p of PAGES) {
    const res = await fetch(BASE + p, { redirect: 'manual' })
    if (res.status >= 400) statuses.push(`${p}=${res.status}`)
    await res.text()
  }
  check('every public page renders', statuses.length === 0, statuses.join(', '))
  const after = await fingerprint()
  check('the canonical data is byte-identical after rendering all of them',
    before === after, `${before}\n      vs ${after}`)
}

section('Anonymous readers are refused Creator and Admin')
if (!reachable) {
  console.log('  (dev server not reachable; skipped)')
} else {
  for (const p of GATED) {
    const res = await fetch(BASE + p, { redirect: 'manual' })
    const body = res.status < 400 ? await res.text() : ''
    /*
     * A refusal can legitimately look like a redirect, a 403, or a 200 carrying a sign-in prompt —
     * this app uses the last of those. What must NOT appear is the management surface itself.
     */
    const refused = res.status === 302 || res.status === 307 || res.status === 401 || res.status === 403
      || /forbidden|sign in|Sign In/i.test(body)
    const leaked = /Create Season|Member Management|Close Season|Save Group|Delete Season/i.test(body)
    check(`${p} refuses an anonymous reader`, refused, `status ${res.status}`)
    check(`...and leaks no management surface`, !leaked)
  }
}

section('The refusal is decided on the server')
{
  function walk(root: string): string[] {
    if (!existsSync(root)) return []
    const out: string[] = []
    const go = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const full = `${dir}/${e.name}`
        if (e.isDirectory()) go(full)
        else if (/page\.tsx$/.test(e.name)) out.push(full)
      }
    }
    go(root)
    return out
  }

  const guarded = [...walk('src/app/(frontend)/creator'), ...walk('src/app/(frontend)/staff')]
  check('there are gated pages to audit', guarded.length > 0, `${guarded.length}`)

  const clientPages = guarded.filter((f) => /^\s*['"]use client['"]/m.test(readFileSync(f, 'utf8')))
  check('no gated page is a client component', clientPages.length === 0,
    clientPages.map((f) => f.replace('src/', '')).join(', '))

  /*
   * A page is gated if it calls a gate, OR calls a loader that calls one.
   *
   * The four Creator season stages gate through `loadSeasonStage`, whose first line is
   * `await requireCreator()`. A check that only looked for the gate's own name inside the page file
   * reported all four as ungated — a false alarm that, taken at face value, would have had somebody
   * add a second redundant gate to code that was already correct.
   *
   * So the set of gating helpers is DERIVED: any exported function in src/lib whose body calls a
   * primitive gate counts as one. That way a new loader that gates is recognised automatically, and
   * a new page that gates through nothing at all is still caught.
   */
  const PRIMITIVE_GATE = /requireCreator|resolveStaffAccess|resolveCreatorAccess|requireStaff/
  const gatingHelpers = new Set<string>()
  const libFiles: string[] = []
  const collect = (dir: string) => {
    if (!existsSync(dir)) return
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = `${dir}/${e.name}`
      if (e.isDirectory()) collect(full)
      else if (/\.tsx?$/.test(e.name)) libFiles.push(full)
    }
  }
  collect('src/lib')
  for (const f of libFiles) {
    const src = readFileSync(f, 'utf8')
    if (!PRIMITIVE_GATE.test(src)) continue
    for (const m of src.matchAll(/export\s+(?:async\s+)?function\s+(\w+)/g)) {
      const body = src.slice(m.index ?? 0, (m.index ?? 0) + 1200)
      if (PRIMITIVE_GATE.test(body)) gatingHelpers.add(m[1])
    }
  }
  check('gating helpers were discovered', gatingHelpers.size > 0,
    [...gatingHelpers].slice(0, 6).join(', '))

  const ungated = guarded.filter((f) => {
    const src = readFileSync(f, 'utf8')
    if (PRIMITIVE_GATE.test(src)) return false
    /*
     * `\\b` in the template literal, not `\b`.
     *
     * Inside a template string `\b` is the BACKSPACE character, so the pattern became a literal
     * control code either side of the helper name and matched nothing at all — which is why this
     * still reported four correctly-gated pages as ungated after the indirection was handled. The
     * escape has to survive into the regex source.
     */
    return ![...gatingHelpers].some((h) => new RegExp(`\\b${h}\\b`).test(src))
  })
  check('every gated page resolves access before rendering', ungated.length === 0,
    ungated.map((f) => f.replace('src/', '')).join(', '))
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
await prisma.$disconnect()
process.exit(fail === 0 ? 0 : 1)
