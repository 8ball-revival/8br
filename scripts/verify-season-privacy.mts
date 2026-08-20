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
const SETTINGS = 'src/app/(frontend)/seasons/[seasonId]/settings/page.tsx'
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
  check('the settings route requires management', /manage_competitions/.test(settings))
  check('...and 404s without it', /notFound\(\)/.test(settings))
}

section('The public listings still exclude private Seasons')
{
  const surface = stripComments(read('src/lib/competition/surface.ts'))
  check('live Seasons filter on visibility', /publiclyVisible/.test(surface))

  const live = await prisma.season.count({ where: { publiclyVisible: false } })
  const shells = await prisma.season.count({ where: { archiveTemplateKey: { not: null } } })
  console.log(`  (${live} private Seasons, of which ${shells} are generated shells)`)
  check('every generated shell is private',
    (await prisma.season.count({ where: { archiveTemplateKey: { not: null }, publiclyVisible: true } })) === 0)

  // The owner's own private reconstructions are covered by the same rule now.
  const owner = await prisma.season.findMany({
    where: { publiclyVisible: false, archiveTemplateKey: null },
    select: { id: true },
  })
  check('the owner\'s private Seasons exist and are covered', owner.length >= 2, String(owner.length))
  check('...including Season 3732', owner.some((s) => s.id === 3732))
  check('...and Season 4106', owner.some((s) => s.id === 4106))
}

section('Public Seasons are untouched')
{
  const publicSeasons = await prisma.season.findMany({
    where: { publiclyVisible: true }, select: { id: true },
  })
  check('there are still public Seasons to serve', publicSeasons.length >= 2, String(publicSeasons.length))
  check('...including Season 443', publicSeasons.some((s) => s.id === 443))
  check('...and Season 2187', publicSeasons.some((s) => s.id === 2187))
  check('no Season had its visibility changed to satisfy a test',
    publicSeasons.length === 2, `${publicSeasons.length} public — expected the original two`)
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
await prisma.$disconnect()
process.exit(fail === 0 ? 0 : 1)
