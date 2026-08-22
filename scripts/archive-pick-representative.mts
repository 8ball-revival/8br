/**
 * Is 2009 S5A the right Season to validate the whole chain on?
 *
 * The brief names it because it should exercise the newly created identities, the merged handles
 * resolving through aliases, a complete field, archived group data and Wayback-era playoff evidence.
 * This checks that against the manifest rather than assuming it, and reports what it would miss.
 */
import { readFileSync, existsSync } from 'node:fs'

import { prisma } from '../src/lib/prisma.ts'
import { assertLocalDatabase } from '../src/lib/db-guard.ts'
import { manifestEntry, loadManifest } from '../src/lib/archive/manifest.ts'

assertLocalDatabase()

const MAP = 'reports/archive-handle-map.json'
const map: Record<string, { status: string; mergedInto?: string }> =
  existsSync(MAP) ? JSON.parse(readFileSync(MAP, 'utf8')) : {}

const createdHandles = new Set(Object.entries(map).filter(([, v]) => v.status === 'created').map(([k]) => k))
const mergedHandles = new Set(Object.entries(map).filter(([, v]) => v.status === 'merged').map(([k]) => k))

console.log(`handle map: ${createdHandles.size} created identities, ${mergedHandles.size} merged handles`)

const man = loadManifest()
const entries = (man as unknown as { entries: ReturnType<typeof manifestEntry>[] }).entries ?? []

const seasons = await prisma.season.findMany({
  where: { archiveTemplateKey: { not: null }, lifecycleState: { not: 'COMPLETED' } },
  select: { id: true, number: true, division: true, competitionYear: true, archiveTemplateKey: true, lifecycleState: true },
})

const score = (key: string) => {
  const e = manifestEntry(key)
  if (!e) return null
  const handles = new Set(e.participants.map((p) => p.normalizedHandle.toLowerCase()))
  const playoffHandles = new Set(e.playoff.participants.map((p) => p.normalizedHandle.toLowerCase()))
  return {
    participants: handles.size,
    created: [...createdHandles].filter((h) => handles.has(h)).length,
    merged: [...mergedHandles].filter((h) => handles.has(h)).length,
    groupAssignments: e.groupAssignments,
    exactResults: e.exactResults,
    matches: e.matches.length,
    standings: e.standings.length,
    playoffPlacement: e.playoff.placement,
    playoffParticipants: playoffHandles.size,
    bracketSize: e.playoff.bracketSize,
  }
}

const target = seasons.find((s) => s.competitionYear === 2009 && s.number === 5 && s.division === 'A')
if (!target) {
  console.log('2009 S5A is not among the unfinished Seasons.')
} else {
  console.log(`\n2009 S5A → season ${target.id} (${target.lifecycleState}) ${target.archiveTemplateKey}`)
  console.log(JSON.stringify(score(target.archiveTemplateKey!), null, 2))
}

/*
 * The alternatives, ranked by how much of the chain they actually exercise.
 *
 * A representative Season is only useful if it can run every step: complete group assignments, exact
 * results to import, and a playoff topology to place. Anything missing one of those leaves that step
 * unvalidated no matter how many identities it covers.
 */
console.log('\ncandidates that exercise the full chain (complete groups + exact results + exact placement):')
const ranked = seasons
  .map((s) => ({ s, m: score(s.archiveTemplateKey!) }))
  .filter((x) => x.m && x.m.groupAssignments === 'complete' && x.m.exactResults === 'complete' && x.m.playoffPlacement === 'exact')
  .sort((a, b) => (b.m!.created + b.m!.merged) - (a.m!.created + a.m!.merged))

for (const { s, m } of ranked.slice(0, 8)) {
  console.log(`  ${s.competitionYear} S${s.number}${s.division} (${s.id}): participants=${m!.participants} created=${m!.created} merged=${m!.merged} matches=${m!.matches} playoff=${m!.playoffParticipants}/${m!.bracketSize}`)
}
console.log(`  … ${ranked.length} Season(s) qualify in total`)

await prisma.$disconnect()
