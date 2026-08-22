/**
 * A group draft is invisible until the group stage goes live — proven against the served bytes.
 *
 * ── Why this test fetches pages ──────────────────────────────────────────────────────────────────
 * The usual way to check "members cannot see the draft" is to assert that a control is hidden behind
 * a permission flag. That proves the BUTTON is absent and nothing else. A server component that
 * renders the draft and merely styles it away still ships every entrant's group in the HTML, in the
 * flight payload, and in whatever a scraper reads — which is the same leak with a nicer screenshot.
 *
 * So this asks the running application for the public page as an anonymous visitor and searches the
 * response for things only the draft knows: the entrant names, and the group codes they were placed
 * into. If a name appears in the group section of the page before publication, the draft leaked,
 * whatever the buttons are doing.
 *
 * It also checks the direct group URL and the metadata, because "not on the page you were looking
 * at" is not the same as "not served".
 *
 * ── Needs the dev server ─────────────────────────────────────────────────────────────────────────
 * Skips with a loud message rather than failing if nothing is listening, so the suite still runs on
 * a machine where the app is not up.
 *
 * Fixtures only, all removed afterwards.
 *
 * Run: npx tsx --tsconfig scripts/tsconfig.verify.json --env-file=.env scripts/verify-group-draft-privacy.mts
 */
import { prisma } from '../src/lib/prisma.ts'
import { assertLocalDatabase } from '../src/lib/db-guard.ts'
import { createDraft } from '../src/lib/creator/setup.ts'
import { addSeasonEntrant, closeRegistration } from '../src/lib/seasons/service.ts'
import { transitionSeasonState } from '../src/lib/seasons/lifecycle.ts'
import { generateSeasonGroups, publishSeasonGroups } from '../src/lib/seasons/groups.ts'

assertLocalDatabase()

const ACTOR = { userId: 2, username: 'verify-draft-privacy' }
const YEAR = 2093
const BASE = process.env.VERIFY_BASE_URL ?? 'http://localhost:3000'
let pass = 0
let fail = 0
const check = (label: string, ok: boolean, detail?: string) => {
  if (ok) { pass++; console.log(`  ✓ ${label}`) }
  else { fail++; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`) }
}
const section = (t: string) => console.log(`\n--- ${t} ---`)

const series = await prisma.competitionSeries.findFirstOrThrow({ select: { id: true } })

async function cleanup() {
  const rows = await prisma.season.findMany({ where: { competitionYear: YEAR }, select: { id: true } })
  for (const r of rows) {
    await prisma.seasonMatch.deleteMany({ where: { seasonId: r.id } })
    await prisma.seasonStanding.deleteMany({ where: { seasonId: r.id } })
    await prisma.seasonGroup.deleteMany({ where: { seasonId: r.id } })
    await prisma.seasonEntrant.deleteMany({ where: { seasonId: r.id } })
    await prisma.season.delete({ where: { id: r.id } }).catch(() => {})
  }
}
await cleanup()

/*
 * The group heading, as the standings matrix actually renders it.
 *
 * It emits `Group <span ...>A</span>`, so the literal string "Group A" never appears in the HTML.
 * Searching for that string would pass this test for the wrong reason: it would report "no group
 * named" on a page that names every group. Match the markup that is really there.
 */
const GROUP_HEADING = /Group <span[^>]*>([A-Z]+)<\/span>/

/** Anonymous, no cookies: exactly what a member or a stranger receives. */
async function getPublic(path: string): Promise<{ status: number; body: string }> {
  const res = await fetch(`${BASE}${path}`, { headers: { 'cache-control': 'no-cache' } })
  return { status: res.status, body: await res.text() }
}

let serverUp = true
try {
  const probe = await fetch(`${BASE}/seasons`, { signal: AbortSignal.timeout(8000) })
  serverUp = probe.ok
} catch {
  serverUp = false
}

try {
  section('A Season with a private group draft')
  const made = await createDraft(ACTOR, {
    type: 'season', competitionYear: YEAR, competitionSeriesId: series.id, purpose: 'live',
    structure: 'groups_playoffs', number: 1, division: null, accessMode: 'OPEN',
  })
  check('the Season is created', made.ok && made.id != null, made.error)
  const id = made.id!
  // Public, so a leak would be a real one rather than hidden behind the visibility rule.
  await prisma.season.update({ where: { id }, data: { publiclyVisible: true } })

  const players = await prisma.player.findMany({ where: { active: true }, take: 6, select: { id: true, primaryName: true, cueverseId: true } })
  check('six players are available to enter', players.length === 6, `${players.length}`)
  for (const p of players) await addSeasonEntrant(ACTOR, id, p.id)

  await closeRegistration(ACTOR, id)
  await transitionSeasonState(ACTOR, id, 'GROUP_SETUP')
  const gen = await generateSeasonGroups(ACTOR, id, 2)
  check('two groups are drafted', gen.ok === true, gen.error)

  const drafted = await prisma.seasonGroup.findMany({
    where: { seasonId: id },
    select: { code: true, published: true, players: { select: { entrant: { select: { displayName: true, username: true, cueverseId: true } } } } },
  })
  check('the draft exists in the database', drafted.length === 2)
  check('...and no group is published', drafted.every((g) => !g.published))
  check('...and every entrant is placed', drafted.flatMap((g) => g.players).length === 6)

  // The handles the draft placed. If any reaches a public byte stream, the draft leaked.
  const placedHandles = drafted
    .flatMap((g) => g.players.map((p) => p.entrant.cueverseId || p.entrant.displayName || p.entrant.username))
    .filter((h): h is string => !!h && h.length > 2)
  check('there are handles to look for', placedHandles.length > 0)

  if (!serverUp) {
    console.log(`\n  ! ${BASE} is not responding — the served-output checks are skipped.`)
    console.log('    Start the dev server and re-run to exercise them.')
  } else {
    section('Nothing about the draft is served publicly')
    for (const path of [`/seasons/${id}`, `/seasons/${id}?view=groups`, `/seasons/${id}?view=playoffs`]) {
      const { status, body } = await getPublic(path)
      check(`${path} responds`, status === 200, `status ${status}`)
      const leaked = placedHandles.filter((h) => body.includes(h))
      check(`${path} contains no drafted entrant`, leaked.length === 0, leaked.slice(0, 3).join(', '))
      check(`${path} does not name a group`, !GROUP_HEADING.test(body),
        GROUP_HEADING.exec(body)?.[0] ?? '')
      // Metadata is rendered even when the body is guarded; check the head too.
      const head = body.slice(0, body.indexOf('</head>') + 7)
      check(`${path} head leaks nothing`, !placedHandles.some((h) => head.includes(h)))
    }

    const closedCopy = await getPublic(`/seasons/${id}`)
    check('the page says registration is closed instead',
      /Registration Closed/i.test(closedCopy.body), 'copy not found')
    check('...and that groups are coming',
      /published shortly/i.test(closedCopy.body), 'copy not found')

    section('Publishing is what makes them public')
    const pub = await publishSeasonGroups(ACTOR, id)
    check('the groups publish', pub.ok === true, pub.error)
    check('the Season is live',
      (await prisma.season.findUniqueOrThrow({ where: { id }, select: { lifecycleState: true } })).lifecycleState === 'GROUP_STAGE_LIVE')

    const after = await getPublic(`/seasons/${id}?view=groups`)
    check('the public page now names the groups', GROUP_HEADING.test(after.body),
      'no group heading in the published page')
    const shown = placedHandles.filter((h) => after.body.includes(h))
    check('...and shows the entrants that were drafted', shown.length > 0, `${shown.length}/${placedHandles.length}`)

    section('...but still no management controls')
    for (const control of ['Close Groups', 'Save Group', 'Reopen Groups', 'Generate Groups', 'Number of Groups']) {
      check(`the public page has no "${control}"`, !after.body.includes(control))
    }
  }
} finally {
  await cleanup()
  check('every fixture Season is removed',
    (await prisma.season.count({ where: { competitionYear: YEAR } })) === 0)
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
await prisma.$disconnect()
if (fail > 0) process.exitCode = 1
