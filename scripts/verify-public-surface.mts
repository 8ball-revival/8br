/**
 * Public pages browse. Creator manages. Nothing crosses over.
 *
 * ── Checked against the served bytes ─────────────────────────────────────────────────────────────
 * The usual way to verify this is to look for a hidden button, which proves only that a button is
 * hidden. A server component that renders a management form and styles it away still ships the form,
 * its action, and whatever private data it was populated with. So this fetches each public page as
 * an anonymous visitor and reads what actually arrives.
 *
 * ── And the routes themselves ────────────────────────────────────────────────────────────────────
 * The legacy creation and settings URLs were the way to do this work for a long time, so they
 * redirect into Creator rather than 404 — a bookmark should land somewhere useful. What they must
 * not do is keep working as a second management surface.
 *
 * Read-only against whatever the database already holds; creates nothing and deletes nothing.
 *
 * Run: npx tsx --tsconfig scripts/tsconfig.verify.json --env-file=.env scripts/verify-public-surface.mts
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { prisma } from '../src/lib/prisma.ts'
import { assertLocalDatabase } from '../src/lib/db-guard.ts'

assertLocalDatabase()

const BASE = process.env.VERIFY_BASE_URL ?? 'http://localhost:3000'
let pass = 0
let fail = 0
const check = (label: string, ok: boolean, detail?: string) => {
  if (ok) { pass++; console.log(`  ✓ ${label}`) }
  else { fail++; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`) }
}
const section = (t: string) => console.log(`\n--- ${t} ---`)

const get = async (path: string, redirect: RequestRedirect = 'follow') => {
  const res = await fetch(`${BASE}${path}`, { redirect, headers: { 'cache-control': 'no-cache' } })
  return { status: res.status, url: res.url, body: redirect === 'manual' ? '' : await res.text(), location: res.headers.get('location') }
}

let serverUp = true
try { serverUp = (await fetch(`${BASE}/seasons`, { signal: AbortSignal.timeout(8000) })).ok } catch { serverUp = false }
if (!serverUp) {
  console.log(`\n  ! ${BASE} is not responding — this suite needs the dev server.`)
  console.log('RESULT: 0 passed, 1 failed')
  process.exitCode = 1
  await prisma.$disconnect()
  process.exit()
}

/** Controls that must never appear on a public page, whoever is looking. */
const MANAGEMENT_CONTROLS = [
  'Save Group', 'Close Groups', 'Reopen Groups', 'Generate Groups', 'Number of Groups',
  'Generate Bracket', 'Regenerate Bracket', 'Start Playoffs', 'Place Entrants',
  'Build Playoff Bracket', 'Close Season & Crown Champion', 'Close Registration',
  'Private Draft', 'Needs Review', 'Permanently Delete', 'Danger Zone',
  'Save and Exit', 'Back to Creator',
]

try {
  section('The legacy management routes send the reader into Creator')
  /*
   * Checked by OUTCOME, not by status code.
   *
   * Next serves a `redirect()` from a streamed Server Component as a 200 carrying the destination in
   * its payload rather than as a 3xx, so asserting on the status would fail a redirect that works
   * perfectly. What matters is that the reader ends up in Creator and does NOT get the old form.
   */
  const season = await prisma.season.findFirst({ where: { publiclyVisible: true }, select: { id: true } })
  const legacy: [string, string][] = [
    ['/seasons/new', '/creator/seasons/new'],
    ['/tournaments/new', '/creator/tournaments/new'],
  ]
  if (season) legacy.push([`/seasons/${season.id}/settings`, `/creator/seasons/${season.id}/setup`])

  for (const [from, to] of legacy) {
    const r = await get(from)
    const landed = r.url.includes(to) || r.body.includes(to)
    check(`${from} leads to ${to}`, landed, `ended at ${r.url}`)
    // The old page must not still be doing the job it was moved out of.
    check(`...and no longer renders its own form`, !/<form/i.test(r.body))
  }

  section('Public pages carry no management control')
  const pages = ['/seasons', '/tournaments', '/rankings', '/']
  if (season) pages.push(`/seasons/${season.id}`, `/seasons/${season.id}?view=playoffs`)
  const tournament = await prisma.tournament.findFirst({
    where: { publiclyVisible: true, number: { not: null } }, select: { number: true },
  })
  if (tournament?.number != null) pages.push(`/tournaments/${tournament.number}`)

  for (const path of pages) {
    const { status, body } = await get(path)
    check(`${path} responds`, status === 200, `status ${status}`)
    const found = MANAGEMENT_CONTROLS.filter((c) => body.includes(c))
    check(`${path} has no management control`, found.length === 0, found.join(', '))
  }

  section('No public page ships a mutation form')
  for (const path of pages) {
    const { body } = await get(path)
    /*
     * A <form> on a public competition page is the shape of the problem: it is how a score or a
     * lifecycle change would be posted. The registration control is the one legitimate exception,
     * and it is a button in a client component rather than a server form.
     */
    const forms = [...body.matchAll(/<form[^>]*>/gi)].map((m) => m[0])
    check(`${path} renders no form element`, forms.length === 0, forms.slice(0, 2).join(' '))
    check(`${path} exposes no score input`,
      !/<input[^>]+aria-label="[^"]*score/i.test(body))
  }

  section('Draft data is absent from public HTML')
  const drafting = await prisma.season.findFirst({
    where: { publiclyVisible: true, lifecycleState: { in: ['GROUP_SETUP', 'REGISTRATION_CLOSED', 'PLAYOFF_SETUP'] } },
    select: { id: true },
  })
  if (!drafting) {
    console.log('  (no publicly visible Season is mid-draft right now — covered by verify-group-draft-privacy)')
  } else {
    const { body } = await get(`/seasons/${drafting.id}`)
    check('a drafting Season shows no group heading', !/Group <span[^>]*>[A-Z]+<\/span>/.test(body))
    check('...and no bracket round names', !/Quarter-final|Semi-final/.test(body))
  }

  section('The source carries no public management component')
  /*
   * A structural check as well as a rendered one: a component can be present and conditionally
   * hidden today, then unhidden by a later edit. The public Season and Tournament pages should not
   * import the Creator boards at all.
   */
  const publicPages = [
    'src/app/(frontend)/seasons/[seasonId]/page.tsx',
    'src/app/(frontend)/tournaments/[number]/page.tsx',
    'src/app/(frontend)/seasons/page.tsx',
    'src/app/(frontend)/tournaments/page.tsx',
  ]
  const forbidden = [
    'components/creator/', 'season-group-setup', 'tournament-workspace', 'playoff-workspace',
    'playoff-scoring', 'season-completion',
  ]
  for (const file of publicPages) {
    const src = readFileSync(file, 'utf8')
    const hits = forbidden.filter((f) => src.includes(f))
    check(`${file.split('/').pop()} imports no management component`, hits.length === 0, hits.join(', '))
  }

  section('Every Creator route is behind the Creator gate')
  const creatorDir = 'src/app/(frontend)/creator'
  const pageFiles: string[] = []
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name)
      if (statSync(p).isDirectory()) walk(p)
      else if (name === 'page.tsx') pageFiles.push(p)
    }
  }
  walk(creatorDir)
  check('there are Creator pages to check', pageFiles.length > 0, String(pageFiles.length))
  const ungated = pageFiles.filter((f) => {
    const src = readFileSync(f, 'utf8')
    // Either the page gates directly, or it uses a stage loader that gates on its behalf.
    return !/requireCreator|loadSeasonStage|loadTournamentStage/.test(src)
  })
  check('every Creator page gates on the Creator capability', ungated.length === 0, ungated.join(', '))
} finally {
  console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
}

await prisma.$disconnect()
if (fail > 0) process.exitCode = 1
