/**
 * Move a Season whose group stage the archive never recorded into playoff setup.
 *
 * ── The one Season this is for ───────────────────────────────────────────────────────────────────
 * 2009 S5A has a complete, identity-resolved bracket page and no group stage at all: the manifest
 * records no groups, no group matches and no standings for it. Every other Season reaches playoff
 * setup by closing its groups, so this one never left registration, and the importer could not draw
 * a bracket — "Generate the bracket during playoff setup" — for a Season that has a bracket on the
 * page and nothing else.
 *
 * ── Why this is not inventing anything ───────────────────────────────────────────────────────────
 * It asserts nothing about a group stage. It does not create groups, standings or group matches, and
 * it does not claim the Season had none — only that the archive does not record one, which is the
 * same thing the empty tables already say. The transition is the lifecycle's own recovery route,
 * audited as such, and everything that follows is seated from the page like any other Season.
 *
 * ── What it will not do ──────────────────────────────────────────────────────────────────────────
 * It refuses a Season that has a group stage, that has contributed a result, or whose bracket page
 * is not one the field-completeness test accepts. A Season that merely failed to import its groups
 * is a different problem and must not be quietly turned into a playoff-only one.
 *
 * Usage: tsx scripts/archive-playoff-only-season.mts --season ID [--apply]
 */
import { readFileSync, existsSync } from 'node:fs'

import { prisma } from '../src/lib/prisma.ts'
import { assertLocalDatabase } from '../src/lib/db-guard.ts'
import { parseWayback } from '../src/lib/archive/wayback.ts'
import { assessFieldCompleteness } from '../src/lib/archive/wayback-field.ts'
import { transitionSeasonState } from '../src/lib/seasons/lifecycle.ts'
import { resolveCanonical } from '../src/lib/archive/canonical-identity.ts'

assertLocalDatabase()

const ARGS = process.argv.slice(2)
const APPLY = ARGS.includes('--apply')
const seasonId = Number(ARGS[ARGS.indexOf('--season') + 1])
if (!Number.isFinite(seasonId)) throw new Error('usage: --season ID [--apply]')

const ACTOR = { userId: 2, username: 'archive-import' }

const s = await prisma.season.findUniqueOrThrow({
  where: { id: seasonId },
  select: {
    id: true, number: true, division: true, competitionYear: true, archiveTemplateKey: true,
    lifecycleState: true, championName: true, ladderAppliedAt: true, reconstruction: true,
  },
})
const label = `${s.competitionYear} S${s.number}${s.division ?? ''}`

const [groups, matches, standings, entrants, ledger] = await Promise.all([
  prisma.seasonGroup.count({ where: { seasonId } }),
  prisma.seasonMatch.count({ where: { seasonId } }),
  prisma.seasonStanding.count({ where: { seasonId } }),
  prisma.seasonEntrant.count({ where: { seasonId } }),
  prisma.ratingLedger.count({ where: { seasonId } }),
])

const refuse: string[] = []
if (!s.archiveTemplateKey) refuse.push('not an archive-linked Season')
if (!s.reconstruction) refuse.push('not a reconstruction')
if (!['REGISTRATION_OPEN', 'PLAYOFF_SETUP'].includes(String(s.lifecycleState))) refuse.push(`unexpected state ${s.lifecycleState}`)
if (s.championName) refuse.push(`a champion is recorded (${s.championName})`)
if (s.ladderAppliedAt) refuse.push('a ranking contribution was applied')
if (ledger > 0) refuse.push(`${ledger} rating-ledger row(s) exist`)
if (groups + matches + standings > 0) {
  refuse.push(`this Season HAS a group stage (${groups} group(s), ${matches} match(es), ${standings} standing(s)) — it is not playoff-only`)
}
if (entrants === 0) refuse.push('no entrants — enter the bracket field first')

const file = `archive/wayback-seasons/${s.competitionYear}/${s.competitionYear} s${s.number}.txt`
if (!existsSync(file)) refuse.push(`no bracket source at ${file}`)
else {
  const bracket = parseWayback(readFileSync(file, 'utf8'), file)
  const field = assessFieldCompleteness(bracket, { competitionYear: s.competitionYear, seasonNumber: s.number, division: s.division })
  if (!field.complete) refuse.push(`the bracket page does not prove the field: ${field.conditions.filter((c) => !c.ok).map((c) => c.name).join('; ')}`)
  else console.log(`${label}: bracket ${bracket.bracketSize}-draw, ${bracket.validation.category}, champion ${bracket.champion ?? '—'}`)
}

console.log(`${label} (${seasonId}) — ${s.lifecycleState}, ${entrants} entrant(s), no group stage recorded`)

if (refuse.length > 0) {
  console.log(`REFUSED: ${refuse.join('; ')}`)
  await prisma.$disconnect()
  process.exit(1)
}
if (!APPLY) {
  console.log('\nDRY RUN — would move to PLAYOFF_SETUP so the bracket can be seated from the page.')
  await prisma.$disconnect()
  process.exit(0)
}

if (String(s.lifecycleState) !== 'PLAYOFF_SETUP') {
  const r = await transitionSeasonState(ACTOR, seasonId, 'PLAYOFF_SETUP', {
    recovery: true,
    reason: 'archive reconstruction: the archive records no group stage for this Season, and its bracket page is complete',
  })
  if (!r.ok) { console.log(`  FAILED: ${r.error}`); await prisma.$disconnect(); process.exit(1) }
  console.log('  moved to PLAYOFF_SETUP')
}

/*
 * Record the seeds the page prints.
 *
 * Seeding is normally derived from group standings, and this Season has none — so without these the
 * bracket generator has nothing to order the draw by. They are not invented: the capture prints a
 * seed against every named player, which is where they come from and the only place they come from.
 */
const bracket = parseWayback(readFileSync(file, 'utf8'), file)
let seeded = 0
const unresolved: string[] = []
for (const m of bracket.matches.filter((x) => x.round === 1)) {
  for (const player of [m.home, m.away]) {
    if (!player || player.bye || player.seed == null) continue
    const id = await resolveCanonical(seasonId, player.rawHandle)
    if (!id.entrantId) { unresolved.push(player.normalizedHandle); continue }
    await prisma.seasonEntrant.update({ where: { id: id.entrantId }, data: { playoffSeed: player.seed } })
    seeded++
  }
}
console.log(`  recorded ${seeded} seed(s) from the page${unresolved.length ? `; ${unresolved.length} unresolved: ${unresolved.join(', ')}` : ''}`)
console.log(`  now run archive-import-playoffs.mts --apply --season ${seasonId}`)

await prisma.$disconnect()
