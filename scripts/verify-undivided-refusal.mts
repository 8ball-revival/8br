/**
 * An undivided-source Season is refused before anything is written.
 *
 * ── The incident this prevents ───────────────────────────────────────────────────────────────────
 * The 2006 group stage ran undivided: one set of groups, one set of results, later split into a
 * Division A and a Division B shell. Applying those groups to both would count every match twice in
 * the Rankings, so the assignment service refuses it — correctly, and it did.
 *
 * The importer still put 196 entrants on the two Division B shells before that refusal arrived,
 * because it only checked one of the two manifest fields that mark the condition. The refusal has to
 * come FIRST: a Season that cannot be reconstructed should not accumulate half a reconstruction.
 *
 * ── What is asserted ─────────────────────────────────────────────────────────────────────────────
 * That the manifest still marks these Seasons, that the shells are empty, that the shared-stage
 * owners hold the data, and that the importer's guard reads both fields rather than one. Read-only:
 * it writes nothing.
 */
import { readFileSync } from 'node:fs'

import { prisma } from '../src/lib/prisma.ts'
import { assertLocalDatabase } from '../src/lib/db-guard.ts'
import { manifestEntry } from '../src/lib/archive/manifest.ts'

assertLocalDatabase()

let pass = 0
let fail = 0
const check = (label: string, ok: boolean, detail?: string) => {
  if (ok) { pass++; console.log(`  ✓ ${label}`) }
  else { fail++; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`) }
}
const section = (t: string) => console.log(`\n--- ${t} ---`)

try {
  section('The manifest still marks the undivided Seasons')
  const shells = await prisma.season.findMany({
    where: { competitionYear: 2006, division: 'B', number: { in: [1, 2] } },
    select: { id: true, number: true, archiveTemplateKey: true, lifecycleState: true, entrantsCount: true },
    orderBy: { number: 'asc' },
  })
  check('both 2006 Division B shells exist', shells.length === 2, String(shells.length))
  for (const s of shells) {
    const e = manifestEntry(s.archiveTemplateKey!)
    check(`S${s.number}B is marked undivided`,
      e?.groupAssignments === 'undivided-source' || !!e?.undividedSource,
      `groupAssignments=${e?.groupAssignments} undividedSource=${!!e?.undividedSource}`)
  }

  section('The shells carry no reconstruction')
  for (const s of shells) {
    const counts = {
      entrants: await prisma.seasonEntrant.count({ where: { seasonId: s.id } }),
      groups: await prisma.seasonGroup.count({ where: { seasonId: s.id } }),
      matches: await prisma.seasonMatch.count({ where: { seasonId: s.id } }),
      standings: await prisma.seasonStanding.count({ where: { seasonId: s.id } }),
      playoff: await prisma.seasonPlayoffMatch.count({ where: { seasonId: s.id } }),
      ledger: await prisma.ratingLedger.count({ where: { seasonId: s.id } }),
    }
    const total = Object.values(counts).reduce((a, b) => a + b, 0)
    check(`S${s.number}B holds no child rows at all`, total === 0, JSON.stringify(counts))
    check(`...and its stored entrant count is zero`, s.entrantsCount === 0, String(s.entrantsCount))
    check(`...and it never left registration`, String(s.lifecycleState) === 'REGISTRATION_OPEN', String(s.lifecycleState))
  }

  section('The shared stage still belongs to Division A')
  /*
   * The other half of the rule: refusing the shells is only correct because the matches are already
   * recorded once, on the Seasons that own them.
   */
  const owners = await prisma.season.findMany({
    where: { competitionYear: 2006, division: 'A', number: { in: [1, 2] } },
    select: { id: true, number: true, lifecycleState: true, championName: true },
    orderBy: { number: 'asc' },
  })
  check('both Division A owners exist', owners.length === 2)
  for (const o of owners) {
    check(`2006 S${o.number}A is completed`, String(o.lifecycleState) === 'COMPLETED')
    check(`...with a champion recorded`, !!o.championName, String(o.championName))
    check(`...and holds the group matches`,
      (await prisma.seasonMatch.count({ where: { seasonId: o.id } })) > 0)
  }

  section('The importer refuses before it writes')
  const src = readFileSync('scripts/import-archive-seasons.mts', 'utf8')
  const guardAt = src.indexOf("groupAssignments === 'undivided-source'")
  const entrantsAt = src.indexOf('applyAutoEntrants(')
  check('the guard reads both markers, not one',
    src.includes('entry.undividedSource || entry.groupAssignments === \'undivided-source\''))
  check('...and it runs before entrants are added', guardAt > -1 && entrantsAt > -1 && guardAt < entrantsAt,
    `guard@${guardAt} entrants@${entrantsAt}`)
  const assignAt = src.indexOf('applyGroupAssign(')
  check('...and before groups are assigned', guardAt > -1 && assignAt > -1 && guardAt < assignAt)

  section('The assignment service refuses independently')
  /*
   * Belt and braces: the importer's guard is the early exit, but the service is what makes the rule
   * true for every caller including the Creator button.
   */
  const assign = readFileSync('src/lib/archive/auto-assign.ts', 'utf8')
  check('the group assignment service knows about undivided sources', /undivided/i.test(assign))
  check('...and refuses rather than warning', /count every result twice|would count/i.test(assign))
} finally {
  console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
}

await prisma.$disconnect()
if (fail > 0) process.exitCode = 1
