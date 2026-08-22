/**
 * Compare the three records of who was in each playoff, before anything is changed.
 *
 * There are three: the season manifest's list of qualifiers, the archived bracket page's entry
 * positions, and whatever the database currently has selected. They do not always agree, and the
 * disagreement is the point — a handle in the manifest but nowhere on a complete page qualified and
 * then did not enter, while the same absence on a truncated page means only that the capture is
 * short.
 *
 * This writes no competition data. It produces the report an import is then held to.
 *
 * Usage: tsx scripts/archive-playoff-reconcile.mts
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'

import { prisma } from '../src/lib/prisma.ts'
import { assertLocalDatabase } from '../src/lib/db-guard.ts'
import { parseWayback } from '../src/lib/archive/wayback.ts'
import { assessFieldCompleteness } from '../src/lib/archive/wayback-field.ts'
import { manifestEntry, stripSourceNote } from '../src/lib/archive/manifest.ts'

assertLocalDatabase()
mkdirSync('reports', { recursive: true })

const COVERAGE = 'reports/archive-wayback-playoff-coverage.json'
if (!existsSync(COVERAGE)) throw new Error('run archive-wayback-coverage.mts first')
const coverage = JSON.parse(readFileSync(COVERAGE, 'utf8')) as {
  sourceFile: string; competitionYear: number; seasonNumber: number
  seasonId: number | null; eligible: boolean; category: string
}[]

export interface HandleClass {
  handle: string
  inManifest: boolean
  inBracketEntry: boolean
  inCarriedForwardOnly: boolean
  currentlySelected: boolean
  entrantId: number | null
  playerId: string | null
  resolution: 'resolved' | 'unresolved' | 'ambiguous'
}

export interface ReconciliationRow {
  seasonId: number
  label: string
  sourceFile: string
  category: string
  bracketComplete: boolean
  completenessFailures: string[]
  manifestCount: number
  waybackEntryCount: number
  intersection: number
  manifestOnly: string[]
  waybackOnly: string[]
  currentlySelected: string[]
  proposedSelected: string[]
  unresolved: string[]
  ambiguous: string[]
  safeToReconcile: boolean
  reason: string
  handles: HandleClass[]
}

/** Resolve an archive handle to the entrant that represents that person in this Season. */
async function resolve(seasonId: number, handle: string) {
  const h = stripSourceNote(handle).toLowerCase()
  const direct = await prisma.seasonEntrant.findMany({
    where: { seasonId, cueverseId: { equals: h, mode: 'insensitive' } },
    select: { id: true, playerId: true },
  })
  if (direct.length === 1) return { entrantId: direct[0].id, playerId: direct[0].playerId, resolution: 'resolved' as const }
  if (direct.length > 1) return { entrantId: null, playerId: null, resolution: 'ambiguous' as const }

  const aliases = await prisma.playerAlias.findMany({
    where: { alias: { equals: stripSourceNote(handle), mode: 'insensitive' } },
    select: { playerId: true },
  })
  const ids = [...new Set(aliases.map((a) => a.playerId))]
  if (ids.length > 1) return { entrantId: null, playerId: null, resolution: 'ambiguous' as const }
  if (ids.length === 1) {
    const e = await prisma.seasonEntrant.findFirst({ where: { seasonId, playerId: ids[0] }, select: { id: true, playerId: true } })
    if (e) return { entrantId: e.id, playerId: e.playerId, resolution: 'resolved' as const }
  }
  /*
   * A bracket entrant who is not yet a Season entrant still counts as resolved.
   *
   * The page shows them playing in this Season; the database simply has not entered them, because
   * the manifest never listed them. Resolving to the Player is what lets the import add the entrant
   * afterwards. Only a handle that matches no Player at all is genuinely unresolved.
   */
  const player = await prisma.player.findMany({
    where: { cueverseIdNormalized: h },
    select: { id: true },
  })
  if (player.length === 1) return { entrantId: null, playerId: player[0].id, resolution: 'resolved' as const }
  if (player.length > 1) return { entrantId: null, playerId: null, resolution: 'ambiguous' as const }
  return { entrantId: null, playerId: null, resolution: 'unresolved' as const }
}

const rows: ReconciliationRow[] = []

for (const cov of coverage.filter((c) => c.eligible && c.seasonId)) {
  const seasonId = cov.seasonId!
  const season = await prisma.season.findUniqueOrThrow({
    where: { id: seasonId },
    select: { competitionYear: true, number: true, division: true, archiveTemplateKey: true, lifecycleState: true },
  })
  const bracket = parseWayback(readFileSync(cov.sourceFile, 'utf8'), cov.sourceFile)
  const completeness = assessFieldCompleteness(bracket, {
    competitionYear: season.competitionYear, seasonNumber: season.number, division: season.division,
  })

  const entry = manifestEntry(season.archiveTemplateKey!)
  const manifestHandles = [...new Set((entry?.playoff.participants ?? []).map((p) => stripSourceNote(p.normalizedHandle)))]
  const entryHandles = [...new Set(completeness.entryHandles)]

  const carried = [...new Set(
    bracket.matches.filter((m) => m.round > 1).flatMap((m) => [m.home, m.away])
      .filter((s): s is NonNullable<typeof s> => Boolean(s) && !s!.bye)
      .map((s) => s.normalizedHandle),
  )].filter((h) => !entryHandles.some((e) => e.toLowerCase() === h.toLowerCase()))

  const selected = await prisma.seasonEntrant.findMany({
    where: { seasonId, playoffIncluded: true },
    select: { id: true, cueverseId: true, username: true },
  })
  const selectedHandles = selected.map((s) => String(s.cueverseId ?? s.username))

  /*
   * One entry per person, not per spelling.
   *
   * The same handle appears with different capitalisation across the three sources — SixohTwo in a
   * bracket, sixohtwo in a group table. Keeping both made a 28-place field propose 35 selections.
   */
  const universe: string[] = []
  for (const h of [...manifestHandles, ...entryHandles, ...carried, ...selectedHandles]) {
    if (!universe.some((u) => u.toLowerCase() === h.toLowerCase())) universe.push(h)
  }
  const handles: HandleClass[] = []
  for (const h of universe) {
    const low = h.toLowerCase()
    const r = await resolve(seasonId, h)
    handles.push({
      handle: h,
      inManifest: manifestHandles.some((m) => m.toLowerCase() === low),
      inBracketEntry: entryHandles.some((e) => e.toLowerCase() === low),
      inCarriedForwardOnly: carried.some((c) => c.toLowerCase() === low),
      currentlySelected: selectedHandles.some((s) => s.toLowerCase() === low),
      entrantId: r.entrantId,
      playerId: r.playerId,
      resolution: r.resolution,
    })
  }

  const manifestOnly = handles.filter((h) => h.inManifest && !h.inBracketEntry).map((h) => h.handle)
  const waybackOnly = handles.filter((h) => h.inBracketEntry && !h.inManifest).map((h) => h.handle)
  const intersection = handles.filter((h) => h.inManifest && h.inBracketEntry).length
  const unresolved = handles.filter((h) => h.inBracketEntry && h.resolution === 'unresolved').map((h) => h.handle)
  const ambiguous = handles.filter((h) => h.resolution === 'ambiguous').map((h) => h.handle)

  /*
   * Whether the page may be allowed to decide the field.
   *
   * It needs to be structurally whole AND every one of its entrants has to resolve to exactly one
   * person here — a page cannot be authoritative about a field containing somebody the database
   * cannot identify.
   */
  let safe = completeness.complete && unresolved.length === 0 && ambiguous.length === 0
  let reason: string
  if (!completeness.complete) reason = `the page is not a complete entry field: ${completeness.failed.join('; ')}`
  else if (unresolved.length > 0) reason = `${unresolved.length} bracket entrant(s) do not resolve: ${unresolved.slice(0, 4).join(', ')}`
  else if (ambiguous.length > 0) reason = `${ambiguous.length} handle(s) are ambiguous: ${ambiguous.slice(0, 4).join(', ')}`
  else reason = 'the page proves the whole entry field and every entrant resolves'

  const proposed = safe
    ? handles.filter((h) => h.inBracketEntry).map((h) => h.handle)
    : selectedHandles

  rows.push({
    seasonId,
    label: `${season.competitionYear} S${season.number}${season.division ?? ''}`,
    sourceFile: cov.sourceFile,
    category: cov.category,
    bracketComplete: completeness.complete,
    completenessFailures: completeness.failed,
    manifestCount: manifestHandles.length,
    waybackEntryCount: entryHandles.length,
    intersection,
    manifestOnly,
    waybackOnly,
    currentlySelected: selectedHandles,
    proposedSelected: proposed,
    unresolved,
    ambiguous,
    safeToReconcile: safe,
    reason,
    handles,
  })
}

writeFileSync('reports/archive-playoff-field-reconciliation.json', JSON.stringify(rows, null, 2))

const md: string[] = []
md.push('# Playoff field reconciliation', '')
md.push('Three records of who was in each playoff: the manifest\'s qualifiers, the archived bracket')
md.push('page\'s entry positions, and what the database currently has selected.', '')
md.push('A complete page outranks the manifest, because a drawing of the draw is a better record of')
md.push('who entered it than a roster of who qualified. An incomplete one does not, because an absent')
md.push('handle then means the capture is short rather than that the player was missing.', '')
md.push('| Season | DB id | Category | Page complete | Manifest | Wayback entries | Both | Manifest-only | Wayback-only | Selected now | Proposed | Safe | Reason |')
md.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|')
for (const r of rows) {
  md.push(`| ${r.label} | ${r.seasonId} | ${r.category} | ${r.bracketComplete ? 'yes' : 'no'} | ${r.manifestCount} | ${r.waybackEntryCount} | ${r.intersection} | ${r.manifestOnly.length} | ${r.waybackOnly.length} | ${r.currentlySelected.length} | ${r.proposedSelected.length} | ${r.safeToReconcile ? '**yes**' : 'no'} | ${r.reason} |`)
}

md.push('', '## Manifest-listed qualifiers absent from a complete bracket', '')
md.push('These people qualified and do not occupy an entry position on a page that proves the whole')
md.push('field. They are deselected from the playoff field only, and keep their Season entry and all')
md.push('their group history. Nothing calls them losers or forfeits — the record simply does not show')
md.push('them entering the bracket.', '')
let anyExcluded = false
for (const r of rows.filter((x) => x.safeToReconcile && x.manifestOnly.length > 0)) {
  anyExcluded = true
  md.push(`- **${r.label}** (Season ${r.seasonId}): ${r.manifestOnly.map((h) => `\`${h}\``).join(', ')}`)
}
if (!anyExcluded) md.push('_None._')

md.push('', '## Seasons where the page may not decide the field', '')
for (const r of rows.filter((x) => !x.safeToReconcile)) {
  md.push(`- **${r.label}** (Season ${r.seasonId}) — ${r.reason}`)
}

md.push('', '## Totals', '')
md.push(`- Seasons examined: **${rows.length}**`)
md.push(`- Pages proving a complete entry field: **${rows.filter((r) => r.bracketComplete).length}**`)
md.push(`- Safe to reconcile: **${rows.filter((r) => r.safeToReconcile).length}**`)
md.push(`- Manifest-only qualifiers that would be deselected: **${rows.filter((r) => r.safeToReconcile).reduce((a, r) => a + r.manifestOnly.length, 0)}**`)
md.push(`- Wayback-only entrants that would be selected: **${rows.filter((r) => r.safeToReconcile).reduce((a, r) => a + r.waybackOnly.length, 0)}**`)
writeFileSync('reports/archive-playoff-field-reconciliation.md', md.join('\n') + '\n')

console.log(JSON.stringify({
  seasons: rows.length,
  completePages: rows.filter((r) => r.bracketComplete).length,
  safeToReconcile: rows.filter((r) => r.safeToReconcile).length,
  manifestOnlyDeselected: rows.filter((r) => r.safeToReconcile).reduce((a, r) => a + r.manifestOnly.length, 0),
  waybackOnlySelected: rows.filter((r) => r.safeToReconcile).reduce((a, r) => a + r.waybackOnly.length, 0),
}, null, 2))
for (const r of rows) {
  console.log(`  ${r.label} (${r.seasonId}) complete=${r.bracketComplete} safe=${r.safeToReconcile} manifest=${r.manifestCount} entries=${r.waybackEntryCount} selected=${r.currentlySelected.length}→${r.proposedSelected.length} — ${r.reason.slice(0, 80)}`)
}

await prisma.$disconnect()
