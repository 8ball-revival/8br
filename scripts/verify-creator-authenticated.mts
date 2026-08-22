/**
 * Creator, fetched as a signed-in administrator.
 *
 * ── Why this suite exists ────────────────────────────────────────────────────────────────────────
 * Every other suite checks Creator through its services, or checks the public pages anonymously. The
 * one thing neither can see is what an ADMINISTRATOR actually receives: the gate lets them through,
 * so the rendered page is different from the anonymous 404, and nothing was verifying that half.
 *
 * It needs a session, which it will not manufacture: pass a token in `CREATOR_TEST_TOKEN` and it
 * runs, otherwise it skips loudly. That keeps a suite that requires credentials from either failing
 * the build or quietly weakening authentication to avoid failing it.
 *
 * ── What it proves ───────────────────────────────────────────────────────────────────────────────
 * That the gate admits, that each route renders its own surface rather than somebody else's, and —
 * the part worth the most — that the anonymous request for the same URL still gets nothing. A
 * Creator route that renders for everybody would pass every check above this line.
 *
 * Read-only: it fetches pages and creates nothing.
 *
 * Run: CREATOR_TEST_TOKEN=<payload-token> npx tsx --tsconfig scripts/tsconfig.verify.json --env-file=.env scripts/verify-creator-authenticated.mts
 */
import { prisma } from '../src/lib/prisma.ts'
import { assertLocalDatabase } from '../src/lib/db-guard.ts'

assertLocalDatabase()

const BASE = process.env.VERIFY_BASE_URL ?? 'http://localhost:3000'
const TOKEN = process.env.CREATOR_TEST_TOKEN ?? ''
let pass = 0
let fail = 0
const check = (label: string, ok: boolean, detail?: string) => {
  if (ok) { pass++; console.log(`  ✓ ${label}`) }
  else { fail++; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`) }
}
const section = (t: string) => console.log(`\n--- ${t} ---`)

if (!TOKEN) {
  console.log('\n  ! CREATOR_TEST_TOKEN is not set — the authenticated checks are skipped.')
  console.log('    Sign in and pass the payload-token cookie value to exercise them.')
  console.log('\nRESULT: 0 passed, 0 failed (skipped)')
  await prisma.$disconnect()
  process.exit(0)
}

const authed = async (path: string) => {
  const res = await fetch(`${BASE}${path}`, {
    headers: { cookie: `payload-token=${TOKEN}`, 'cache-control': 'no-cache' },
  })
  return { status: res.status, body: await res.text() }
}
/** Whatever a Creator stage page shows, it shows one of these; a public page shows neither. */
const SHELL_MARKERS = ['Back to Creator', 'Save and Exit', 'Exit Creator']

const anon = async (path: string) => {
  const res = await fetch(`${BASE}${path}`, { headers: { 'cache-control': 'no-cache' } })
  return { status: res.status, body: await res.text() }
}

/*
 * Telling "admitted" from "denied" cannot be done by looking for the 404 wording.
 *
 * Next ships the not-found boundary inside the flight payload of EVERY page, so "Error 404" and "Off
 * the table" are present in the served bytes of a page that rendered perfectly well. A detector built
 * on that string calls every page denied.
 *
 * The honest signal is the page's own surface: admitted means the marker is there, denied means it is
 * not and the not-found boundary is what got rendered instead.
 */
const stripFlight = (body: string) => body.replace(/<script[\s\S]*?<\/script>/gi, '')

/*
 * The head is not evidence.
 *
 * A gated page still exports metadata, so its <title> flushes before the guard runs and carries the
 * page's name into a response whose body is empty. Testing the whole document for "Open Seasons"
 * therefore says "rendered" about a page that rendered nothing. Everything below looks at the body.
 */
const pageBody = (body: string) => {
  const i = body.indexOf('</head>')
  return stripFlight(i < 0 ? body : body.slice(i))
}
const rendered = (body: string, marker: string) => pageBody(body).includes(marker)

/*
 * Denied means the reader got none of it. Next cannot send a 3xx or a 404 status once the shell has
 * flushed, so refusal looks like an empty body rather than a status code — which is why absence, not
 * a status or a 404 string, is what gets asserted.
 */
const denied = (body: string, marker: string) => !pageBody(body).includes(marker)

try {
  section('The gate admits a signed-in administrator')
  const landing = await authed('/creator')
  check('/creator responds', landing.status === 200, `status ${landing.status}`)
  check('...and is the Creator landing, not a not-found', rendered(landing.body, 'Create New Season'))
  for (const label of ['Create New Season', 'Create New Tournament', 'Manage Open', 'Modify Completed']) {
    check(`...offering "${label}"`, landing.body.includes(label))
  }

  section('The same URL still gives an anonymous visitor nothing')
  const anonLanding = await anon('/creator')
  check('an anonymous /creator is denied', denied(anonLanding.body, 'Create New Season'))
  check('...and carries none of the Creator controls', !anonLanding.body.includes('Create New Season'))

  section('Each creation form renders its own surface')
  const newSeason = await authed('/creator/seasons/new')
  check('/creator/seasons/new renders', rendered(newSeason.body, 'Create New Season'))
  check('...with the structure choices', /Groups.*Playoffs/s.test(newSeason.body))
  check('...and the duplicate-safe identity fields',
    newSeason.body.includes('Season Number') && newSeason.body.includes('Division'))

  const newTournament = await authed('/creator/tournaments/new')
  check('/creator/tournaments/new renders', rendered(newTournament.body, 'Create New Tournament'))
  for (const fmt of ['Single Elimination', 'Double Elimination', 'Groups + Playoffs', 'Swiss System']) {
    check(`...offering ${fmt}`, newTournament.body.includes(fmt))
  }
  check('...with the team controls present but off by default',
    newTournament.body.includes('Players per team') && newTournament.body.includes('Individual 1v1'))

  section('The listings resolve')
  const LISTINGS: [string, string][] = [
    ['/creator/seasons', 'Open Seasons'],
    ['/creator/tournaments', 'Open Tournaments'],
    ['/creator/seasons/completed', 'Completed Seasons'],
    ['/creator/tournaments/completed', 'Completed Tournaments'],
  ]
  for (const [path, marker] of LISTINGS) {
    const r = await authed(path)
    check(`${path} renders for an administrator`, r.status === 200 && rendered(r.body, marker), `status ${r.status}`)
    const a = await anon(path)
    check(`...and is denied anonymously`, denied(a.body, marker))
  }

  section('A real Season opens at its own stage')
  const season = await prisma.season.findFirst({
    where: { lifecycleState: 'COMPLETED' },
    select: { id: true, number: true },
    orderBy: { id: 'asc' },
  })

  /*
   * A completed Season is opened at every stage it has passed through, so all four render. What it
   * does NOT have is a `/complete` segment: that stage's home is the record page, which is where the
   * corrections and the Danger Zone live. The workflow bar is checked against the same rule below.
   */
  if (!season) {
    console.log('  (no completed Season in this database to open)')
  } else {
    for (const stage of ['setup', 'groups', 'playoffs']) {
      const r = await authed(`/creator/seasons/${season.id}/${stage}`)
      const shell = SHELL_MARKERS.find((m) => rendered(r.body, m))
      check(`/creator/seasons/${season.id}/${stage} renders inside the Creator shell`,
        r.status === 200 && shell != null, `status ${r.status}`)
      const a = await anon(`/creator/seasons/${season.id}/${stage}`)
      check(`...and is denied anonymously`, SHELL_MARKERS.every((m) => denied(a.body, m)))
    }
  }

  section('Every stage the workflow bar offers actually resolves')
  /*
   * The bar is generated, so a stage whose page was never built produces a link that looks exactly
   * like the others and 404s. Following each one is the only way to notice.
   */
  if (season) {
    const { workflowFor } = await import('../src/lib/creator/workflow.ts')
    for (const stage of workflowFor('season', season.id, 'COMPLETED')) {
      const r = await authed(stage.href)
      const ok = r.status === 200 && !/Off the table/i.test(pageBody(r.body))
      check(`"${stage.label}" → ${stage.href}`, ok, `status ${r.status}`)
    }
  }

  section('A real Tournament opens at its own stage')
  const tournament = await prisma.tournament.findFirst({
    where: { number: { not: null } }, select: { id: true }, orderBy: { id: 'asc' },
  })
  if (!tournament) {
    console.log('  (no Tournament in this database to open)')
  } else {
    const r = await authed(`/creator/tournaments/${tournament.id}/setup`)
    check(`/creator/tournaments/${tournament.id}/setup renders inside the Creator shell`,
      r.status === 200 && SHELL_MARKERS.some((m) => rendered(r.body, m)), `status ${r.status}`)
    const a = await anon(`/creator/tournaments/${tournament.id}/setup`)
    check('...and is denied anonymously', SHELL_MARKERS.every((m) => denied(a.body, m)))
  }

  section('Public pages are unchanged for a signed-in administrator')
  /*
   * The whole point of the consolidation: being an administrator must not turn a public page into an
   * editor. This is the check that would have caught the old behaviour, where the same URL grew
   * score inputs for the right viewer.
   */
  const publicSeason = await prisma.season.findFirst({ where: { publiclyVisible: true }, select: { id: true } })
  if (publicSeason) {
    const asAdmin = await authed(`/seasons/${publicSeason.id}`)
    check('a public Season renders for an administrator', asAdmin.status === 200)
    for (const control of ['Save Group', 'Close Groups', 'Start Playoffs', 'Close Season & Crown Champion']) {
      check(`...still without "${control}"`, !asAdmin.body.includes(control))
    }
    /*
     * Not "no form on the page" — the site header signs people out with one, and it is there for
     * every reader. The claim being tested is that the SEASON gained no editing surface, so the
     * check names the controls that would represent one.
     */
    for (const control of ['Enter Result', 'Record Result', 'Save Score', 'Edit Match']) {
      check(`...still without "${control}"`, !asAdmin.body.includes(control))
    }
  }
} finally {
  console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
}

await prisma.$disconnect()
if (fail > 0) process.exitCode = 1
