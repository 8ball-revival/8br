/**
 * A private Season is private everywhere.
 *
 * `publiclyVisible = false` has to mean the same thing on the detail route, in the page metadata and
 * anywhere else a Season can be reached. This checks the invariants that make that true — that one
 * shared rule exists, that every public surface consults it, and that the rule is not scoped to some
 * subset of private Seasons — and the live anonymous-versus-staff behaviour is proven for real in
 * verification/archive/visual.mjs against the running site.
 *
 * Run:  npx tsx --tsconfig scripts/tsconfig.verify.json --env-file=.env scripts/verify-season-privacy.mts
 */
import { readFileSync, existsSync } from 'node:fs'

import { prisma } from '../src/lib/prisma.ts'
import { assertLocalDatabase } from '../src/lib/db-guard.ts'

assertLocalDatabase('verify-season-privacy')

let pass = 0, fail = 0
const check = (n: string, c: boolean, d = '') => {
  if (c) { pass++ } else { fail++; console.log('  FAIL ' + n + (d ? ` — ${d}` : '')) }
}
const section = (s: string) => console.log(`\n${s}`)

const read = (f: string) => readFileSync(f, 'utf8')
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

const PAGE = 'src/app/(frontend)/seasons/[seasonId]/page.tsx'
/*
 * The gate moved with the work.
 *
 * These routes are redirect stubs now: creating and editing a competition happens in Creator, and
 * Creator's own page enforces the capability. Asserting the check on the OLD file would be asserting
 * that a redirect guards something it no longer does, so the assertion follows the work.
 */
const SETTINGS = 'src/app/(frontend)/creator/seasons/[id]/setup/page.tsx'
const RULE = 'src/lib/seasons/visibility.ts'

section('There is one rule, and it is not scoped to a subset')
{
  check('the shared rule exists', existsSync(RULE))
  const rule = read(RULE)
  const code = stripComments(rule)

  check('it decides on publiclyVisible', /publiclyVisible/.test(code))
  check('it lets staff through', /manage_competitions/.test(code))

  /*
   * The rule must not name a KIND of private Season.
   *
   * An earlier version keyed on `archiveTemplateKey`, which protected the generated shells and left
   * every other private Season — including the owner's own reconstructions — reachable. A rule that
   * mentions a category has an exception; a rule that only reads the flag cannot.
   */
  check('it does not single out archive shells', !/archiveTemplateKey/.test(code), 'the rule is scoped')
  check('it does not single out reconstructions', !/reconstruction/.test(code), 'the rule is scoped')

  // "Does not exist" and "exists but is private" must be indistinguishable to a visitor.
  check('a missing Season and a private one return the same shape',
    /allowed: false, hidden: false/.test(code) && /allowed: canManage/.test(code))
  check('it exports a metadata fallback that carries no title',
    /HIDDEN_SEASON_METADATA/.test(code) && /title: 'Season'/.test(code))
}

section('Every public Season surface consults it')
{
  const page = read(PAGE)
  const code = stripComments(page)

  check('the detail page imports the rule', /from '@\/lib\/seasons\/visibility'/.test(code))
  check('...and gates the body on it', /seasonAccess\([^)]*\)\)\.allowed\) notFound\(\)/.test(code))

  /*
   * Metadata runs even when the body 404s.
   *
   * Guarding only the body still puts the private Season's real title into the browser tab and the
   * head of the not-found response — the private name of a private thing, through the one part of
   * the page nobody thinks to check.
   */
  const metadata = code.slice(code.indexOf('generateMetadata'), code.indexOf('export default'))
  check('metadata is guarded too', /seasonAccess/.test(metadata))
  check('...and returns the titleless fallback', /HIDDEN_SEASON_METADATA/.test(metadata))
  check('...before it loads the Season',
    metadata.indexOf('seasonAccess') < metadata.indexOf('getSeasonView'))

  // The old scoped gate must be gone, not merely supplemented.
  check('no scoped gate remains in the page',
    !/archiveTemplateKey.*publiclyVisible|publiclyVisible.*archiveTemplateKey/.test(code))

  const settings = stripComments(read(SETTINGS))
  /*
   * `loadSeasonStage` gates this page: it calls `requireCreator`, which tests the capability and
   * renders a not-found to anybody without it. The guard is named rather than inlined, so the check
   * looks for the guard.
   */
  check('the settings route requires management', /loadSeasonStage|requireCreator/.test(settings))
  check('...and the legacy URL only forwards to it',
    (read('src/app/(frontend)/seasons/[seasonId]/settings/page.tsx') ?? '').includes('/creator/seasons/'))
}

section('Completed Seasons are public; unfinished ones are not')
{
  const surface = stripComments(read('src/lib/competition/surface.ts'))
  check('live Seasons filter on visibility', /publiclyVisible/.test(surface))

  /*
   * The rule, restated once the archive was published.
   *
   * This used to assert that every generated shell was private, and that the owner's own
   * reconstructions -- 3732 and 4106 among them -- were private too. That described a moment, not a
   * rule: an archive nobody outside the owner could read. A COMPLETED Season is a finished
   * competition with a champion and a full record, and hiding it serves nobody, so all of them are
   * public.
   *
   * What privacy still protects, and what these checks defend, is the UNFINISHED work: a
   * registration-open Season stays private unless somebody deliberately publishes it. The
   * discriminator is `lifecycleState` -- not an id list, and not `archiveTemplateKey` -- so the
   * assertion keeps applying as Seasons are added rather than quietly describing a smaller and
   * smaller subset.
   */
  const privateTotal = await prisma.season.count({ where: { publiclyVisible: false } })
  const completedPrivate = await prisma.season.count({
    where: { lifecycleState: 'COMPLETED' as never, publiclyVisible: false },
  })
  const openPrivate = await prisma.season.count({
    where: { lifecycleState: 'REGISTRATION_OPEN' as never, publiclyVisible: false },
  })
  console.log(`  (${privateTotal} private Seasons: ${openPrivate} registration-open, ${completedPrivate} completed)`)

  check('no completed Season is private', completedPrivate === 0, `${completedPrivate} still private`)
  check('unfinished Seasons are still private', openPrivate > 0, String(openPrivate))
  check('...and unfinished work is the ONLY thing privacy is hiding', privateTotal === openPrivate,
    `${privateTotal} private, ${openPrivate} of them unfinished`)
}

section('Public Seasons are the finished ones, and nothing drifted public')
{
  const publicSeasons = await prisma.season.findMany({
    where: { publiclyVisible: true }, select: { id: true, lifecycleState: true },
  })
  check('there are public Seasons to serve', publicSeasons.length >= 2, String(publicSeasons.length))
  /*
   * Naming Seasons 443 and 2187 here was a mistake I made writing this: they are rows in the live
   * archive, and depending on them made a behaviour suite unable to run without production. What the
   * rule needs is that FINISHED work is public, whichever Seasons those happen to be.
   *
   * Their continued existence is audited in scripts/audit/audit-production.mts.
   */
  check('...and the finished ones are among them',
    publicSeasons.some((s) => s.lifecycleState === ('COMPLETED' as never)))

  /*
   * The guard that had to survive the change.
   *
   * What must never happen is a TEST making a Season public as a side effect of running. That was
   * written as "exactly 443 and 2187 among the pre-existing Seasons", which cannot outlive the
   * archive being published on purpose. It is written here as a statement about which UNFINISHED
   * Seasons are public, because that is the set a fixture would pollute: finished Seasons are all
   * public by rule now, so they can no longer tell you anything.
   *
   * Pinned to the one Season the owner published deliberately. If another is published on purpose,
   * this line is the place to say so -- deliberately, in a commit, rather than by a test quietly
   * flipping a column.
   */
  const OWNER_PUBLISHED_OPEN_SEASON = 13152
  const openPublic = publicSeasons
    .filter((s) => s.lifecycleState === ('REGISTRATION_OPEN' as never))
    .map((s) => s.id)
    .sort((a, b) => a - b)
  check('the only unfinished Season that is public is the one the owner published',
    openPublic.length === 1 && openPublic[0] === OWNER_PUBLISHED_OPEN_SEASON,
    `registration-open and public: ${openPublic.join(', ') || 'none'}`)

  const completedPublic = publicSeasons.filter((s) => s.lifecycleState === ('COMPLETED' as never)).length
  console.log(`    (${completedPublic} completed Seasons public, ${openPublic.length} unfinished)`)
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
await prisma.$disconnect()
process.exit(fail === 0 ? 0 : 1)
