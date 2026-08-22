/**
 * The public Tournament page is the same page for everybody.
 *
 * ── Why the check is structural ──────────────────────────────────────────────────────────────────
 * The obvious test is to fetch the page as five different people and diff the results. That proves
 * the five cases somebody thought to try, and says nothing about the sixth. A page that cannot
 * determine the viewer's role cannot vary by it — so what is asserted here is the absence of the
 * capability, which covers every role including ones that do not exist yet.
 *
 * That absence is real and recent. This page used to be the management interface: rosters, groups,
 * brackets, score entry and Settings all rendered on a public URL behind a flag on a component. The
 * last remnant was worse than a leftover control — the public view was built ONLY for viewers who
 * could not manage, so an administrator opening a Tournament got a note pointing at Creator instead
 * of the Tournament. There was no content for them at all.
 *
 * The anonymous fetch below is the corroborating half: the page still renders, and none of the
 * administrator-only wording survives anywhere in it.
 */
import { readFileSync } from 'node:fs'

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

const PAGE = 'src/app/(frontend)/tournaments/[number]/page.tsx'

try {
  const src = readFileSync(PAGE, 'utf8')
  /*
   * Comments are not behaviour.
   *
   * The file explains where management moved to, which mentions the Creator path — a check that
   * greps the raw text calls that a link. What matters is what the page renders.
   */
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')

  section('The page cannot tell who is looking at it')
  check('it does not resolve staff access', !/resolveStaffAccess/.test(code))
  check('...and does not import it either', !/staff-auth/.test(code))
  check('no manage capability is tested', !/manage_competitions/.test(code))
  /*
   * `canManage={false}` still appears as a prop on the playoff disclaimer. That is the point: it is
   * hard-wired off rather than passed a value, so there is nothing for it to vary with. What must
   * not exist is a VARIABLE the page computes and branches on.
   */
  check('no canManage flag is computed', !/(const|let|var)\s+canManage/.test(code))
  check('...and every canManage prop is hard-wired off',
    (code.match(/canManage=\{[^}]*\}/g) ?? []).every((m) => m === 'canManage={false}'),
    (code.match(/canManage=\{[^}]*\}/g) ?? []).join(', '))
  check('no owner or admin role is read', !/\bisOwner\b|\bisAdmin\b|role ===/.test(code))

  section('The administrator-only wording is gone')
  for (const phrase of [
    'Managing this Tournament happens in',
    'Correcting this Tournament happens in',
  ]) {
    check(`"${phrase}…" is not in the source`, !src.includes(phrase))
  }
  check('no Edit control was added in its place', !/>\s*Edit\s*</.test(code))
  check('...nor an "Open in Creator" link', !/Open in Creator/i.test(code))
  check('nothing it renders links to Creator', !/\/creator\//.test(code))

  section('The public view is built for every viewer')
  /*
   * The bug was the guard, not the banner. `if (!canManage)` around the block that builds the page
   * meant the content simply did not exist for anybody who could manage.
   */
  check('the view is no longer built only for non-managers', !/if \(!canManage\)/.test(code))
  check('...it is built unconditionally', /let publicView: ReactNode = null\s*\n\s*\{/.test(code))

  section('It still renders for an anonymous visitor')
  const t = await prisma.tournament.findFirst({
    where: { number: { not: null }, publiclyVisible: true },
    select: { number: true, name: true },
    orderBy: { id: 'asc' },
  })
  if (!t?.number) {
    console.log('  (no publicly visible Tournament with a number to fetch)')
  } else {
    const res = await fetch(`${BASE}/tournaments/${t.number}`, { headers: { 'cache-control': 'no-cache' } })
    const body = await res.text()
    check(`/tournaments/${t.number} responds`, res.status === 200, `status ${res.status}`)
    check('...showing the Tournament', body.includes(t.name), t.name)
    check('...with no administrator note', !/happens in\s*<?\/?[a-z]*>?\s*Creator/i.test(body))
    check('...and no Creator link in the content', !body.includes('/creator/tournaments/'))
  }

  section('Management still exists — somewhere else')
  /*
   * Removing the signpost must not mean removing the destination. The Creator route is where the
   * work happens, and it is gated there rather than here.
   */
  const creatorPage = readFileSync('src/app/(frontend)/creator/tournaments/[id]/[stage]/page.tsx', 'utf8')
  check('the Creator Tournament workspace still exists', creatorPage.length > 0)
  check('...and enforces access itself', /loadTournamentStage|requireCreator/.test(creatorPage))
} finally {
  console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
}

await prisma.$disconnect()
if (fail > 0) process.exitCode = 1
