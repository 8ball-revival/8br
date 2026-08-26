/**
 * Compare the three records of who was in each playoff, by person rather than by spelling.
 *
 * There are three: the season manifest's list of qualifiers, the archived bracket page's entry
 * positions, and whatever the database currently has selected. They disagree, and the disagreement
 * is the point — a qualifier absent from every entry position on a complete page did not enter the
 * bracket, while the same absence on a truncated page means only that the capture is short.
 *
 * ── Everything is compared by canonical Player id ────────────────────────────────────────────────
 * Comparing raw handles made one person look like two. The manifest's `bigblue2k` seemed to be
 * missing from a bracket that seats `sixohtwo`, when a merge had already made those one account. The
 * consequence was worse than a bad report: the importer deselected the "missing" qualifier and then
 * selected the "new" entrant — two mutations on the same entrant row — and the player ended up out
 * of a playoff they had won matches in. Sets of Player ids cannot express that mistake.
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
import { resolveAll, selectionDelta } from '../src/lib/archive/canonical-identity.ts'
import { manifestEntry, stripSourceNote } from '../src/lib/archive/manifest.ts'

assertLocalDatabase()
mkdirSync('reports', { recursive: true })

const COVERAGE = 'reports/archive-wayback-playoff-coverage.json'
if (!existsSync(COVERAGE)) throw new Error('run archive-wayback-coverage.mts first')
const coverage = JSON.parse(readFileSync(COVERAGE, 'utf8')) as {
  sourceFile: string; competitionYear: number; seasonNumber: number
  seasonId: number | null; eligible: boolean; category: string
}[]

export interface PersonRow {
  playerId: string
  entrantId: number | null
  cueverseId: string | null
  manifestSpellings: string[]
  bracketSpellings: string[]
  selectedNow: boolean
  sameCanonicalIdentity: boolean
  classification: 'in both sources' | 'manifest only' | 'bracket only' | 'same canonical identity' | 'selected only'
}

export interface ReconciliationRow {
  seasonId: number
  label: string
  sourceFile: string
  category: string
  bracketComplete: boolean
  completenessFailures: string[]
  manifestPeople: number
  bracketPeople: number
  intersection: number
  manifestOnly: string[]
  bracketOnly: string[]
  sameCanonicalIdentity: { manifest: string; bracket: string; playerId: string }[]
  currentlySelected: number
  proposedSelected: number
  toSelect: string[]
  toDeselect: string[]
  unchanged: number
  unresolved: string[]
  ambiguous: string[]
  safeToReconcile: boolean
  reason: string
  people: PersonRow[]
}

const rows: ReconciliationRow[] = []

for (const cov of coverage.filter((c) => c.eligible && c.seasonId)) {
  const seasonId = cov.seasonId!
  const season = await prisma.season.findUniqueOrThrow({
    where: { id: seasonId },
    select: { competitionYear: true, number: true, division: true, archiveTemplateKey: true },
  })
  const bracket = parseWayback(readFileSync(cov.sourceFile, 'utf8'), cov.sourceFile)
  const completeness = assessFieldCompleteness(bracket, {
    competitionYear: season.competitionYear, seasonNumber: season.number, division: season.division,
  })

  const entry = manifestEntry(season.archiveTemplateKey!)
  const manifestHandles = (entry?.playoff.participants ?? []).map((p) => stripSourceNote(p.normalizedHandle))
  const bracketHandles = completeness.entryHandles

  const selectedEntrants = await prisma.seasonEntrant.findMany({
    where: { seasonId, playoffIncluded: true },
    select: { id: true, playerId: true, cueverseId: true, username: true },
  })

  // ── Everything resolved to people ─────────────────────────────────────────────────────────────
  const man = await resolveAll(seasonId, manifestHandles)
  const brk = await resolveAll(seasonId, bracketHandles)

  const selectedPlayers = new Map<string, { entrantId: number; handle: string }>()
  for (const e of selectedEntrants) {
    if (!e.playerId) continue
    selectedPlayers.set(e.playerId, { entrantId: e.id, handle: String(e.cueverseId ?? e.username) })
  }

  const manSet = new Set(man.byPlayer.keys())
  const brkSet = new Set(brk.byPlayer.keys())
  const selSet = new Set(selectedPlayers.keys())

  /*
   * The field the page proves, as people.
   *
   * Only a complete page may decide it. On anything else the current selection stands, because an
   * absent handle there is a gap in the capture rather than a player who did not enter.
   */
  /*
   * Resolving to a Player is not enough; they must be an entrant in this Season.
   *
   * A bracket entrant with no entrant row cannot be seated, and entering somebody is only possible
   * while registration is open — long closed for these Seasons. Declaring the field replaceable
   * when part of it cannot be placed produced a bracket with holes and a playoff that would not
   * start, which is a worse outcome than leaving the manifest selection alone.
   */
  const notEntered = [...brk.byPlayer.values()].filter((x) => x.entrantId === null)
  const safe = completeness.complete && brk.unresolved.length === 0 && brk.ambiguous.length === 0
    && notEntered.length === 0
  const desired = safe ? brkSet : selSet
  const delta = selectionDelta(desired, selSet)

  const everyone = new Set([...manSet, ...brkSet, ...selSet])
  const people: PersonRow[] = []
  for (const playerId of everyone) {
    const p = await prisma.player.findUnique({ where: { id: playerId }, select: { cueverseId: true } })
    const inMan = manSet.has(playerId)
    const inBrk = brkSet.has(playerId)
    const manSpellings = man.byPlayer.get(playerId)?.spellings ?? []
    const brkSpellings = brk.byPlayer.get(playerId)?.spellings ?? []
    const differing = inMan && inBrk &&
      !manSpellings.some((a) => brkSpellings.some((b) => a.toLowerCase() === b.toLowerCase()))
    people.push({
      playerId,
      entrantId: man.byPlayer.get(playerId)?.entrantId ?? brk.byPlayer.get(playerId)?.entrantId
        ?? selectedPlayers.get(playerId)?.entrantId ?? null,
      cueverseId: p?.cueverseId ?? null,
      manifestSpellings: manSpellings,
      bracketSpellings: brkSpellings,
      selectedNow: selSet.has(playerId),
      sameCanonicalIdentity: differing,
      classification: differing ? 'same canonical identity'
        : inMan && inBrk ? 'in both sources'
        : inMan ? 'manifest only'
        : inBrk ? 'bracket only'
        : 'selected only',
    })
  }

  const sameIdentity = people.filter((p) => p.sameCanonicalIdentity).map((p) => ({
    manifest: p.manifestSpellings[0] ?? '', bracket: p.bracketSpellings[0] ?? '', playerId: p.playerId,
  }))

  let reason: string
  if (!completeness.complete) reason = `the page is not a complete entry field: ${completeness.failed.join('; ')}`
  else if (brk.unresolved.length > 0) reason = `${brk.unresolved.length} bracket entrant(s) do not resolve: ${brk.unresolved.slice(0, 4).join(', ')}`
  else if (brk.ambiguous.length > 0) reason = `${brk.ambiguous.length} handle(s) are ambiguous: ${brk.ambiguous.slice(0, 4).join(', ')}`
  else if (notEntered.length > 0) reason = `${notEntered.length} bracket entrant(s) resolve to a Player with no entrant row in this Season: ${notEntered.slice(0, 4).map((x) => x.spellings[0]).join(', ')}`
  else reason = 'the page proves the whole entry field and every entrant is entered here'

  rows.push({
    seasonId,
    label: `${season.competitionYear} S${season.number}${season.division ?? ''}`,
    sourceFile: cov.sourceFile,
    category: cov.category,
    bracketComplete: completeness.complete,
    completenessFailures: completeness.failed,
    manifestPeople: manSet.size,
    bracketPeople: brkSet.size,
    intersection: [...manSet].filter((p) => brkSet.has(p)).length,
    manifestOnly: people.filter((p) => p.classification === 'manifest only').map((p) => p.manifestSpellings[0] ?? p.cueverseId ?? p.playerId),
    bracketOnly: people.filter((p) => p.classification === 'bracket only').map((p) => p.bracketSpellings[0] ?? p.cueverseId ?? p.playerId),
    sameCanonicalIdentity: sameIdentity,
    currentlySelected: selSet.size,
    proposedSelected: desired.size,
    toSelect: delta.add,
    toDeselect: delta.remove,
    unchanged: delta.unchanged.length,
    unresolved: brk.unresolved,
    ambiguous: brk.ambiguous,
    safeToReconcile: safe,
    reason,
    people,
  })
}

writeFileSync('reports/archive-playoff-field-reconciliation.json', JSON.stringify(rows, null, 2))

const md: string[] = []
md.push('# Playoff field reconciliation', '')
md.push('Three records of who was in each playoff — the manifest\'s qualifiers, the bracket page\'s')
md.push('entry positions, and the current selection — compared by canonical Player, not by spelling.', '')
md.push('Two spellings that resolve to one person after a merge are one member of the set. Counting')
md.push('them separately made a player look both missing and new at once, and acting on that removed')
md.push('them from a playoff they had won matches in.', '')
md.push('| Season | DB id | Category | Page complete | Manifest | Bracket | Both | Manifest-only | Bracket-only | Same person | Selected | Proposed | +/− | Safe |')
md.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|')
for (const r of rows) {
  md.push(`| ${r.label} | ${r.seasonId} | ${r.category} | ${r.bracketComplete ? 'yes' : 'no'} | ${r.manifestPeople} | ${r.bracketPeople} | ${r.intersection} | ${r.manifestOnly.length} | ${r.bracketOnly.length} | ${r.sameCanonicalIdentity.length} | ${r.currentlySelected} | ${r.proposedSelected} | +${r.toSelect.length}/−${r.toDeselect.length} | ${r.safeToReconcile ? '**yes**' : 'no'} |`)
}

md.push('', '## One person, two spellings', '')
md.push('The manifest and the bracket name the same player differently. No selection changes for these:')
md.push('the person is in both sources, and both spellings are kept — the non-canonical one as an alias.', '')
let anySame = false
for (const r of rows.filter((x) => x.sameCanonicalIdentity.length > 0)) {
  anySame = true
  for (const s of r.sameCanonicalIdentity) {
    md.push(`- **${r.label}**: manifest \`${s.manifest}\` and bracket \`${s.bracket}\` are one Player (\`${s.playerId}\`)`)
  }
}
if (!anySame) md.push('_None._')

md.push('', '## Qualifiers absent from a complete bracket', '')
md.push('Deselected from the playoff field only. Season entry and every group result are untouched, and')
md.push('nothing records them as losing or forfeiting — the source says only that they are not in the draw.', '')
let anyOut = false
for (const r of rows.filter((x) => x.safeToReconcile && x.toDeselect.length > 0)) {
  anyOut = true
  const names = r.people.filter((p) => r.toDeselect.includes(p.playerId)).map((p) => p.cueverseId ?? p.playerId)
  md.push(`- **${r.label}** (Season ${r.seasonId}): ${names.map((n) => `\`${n}\``).join(', ')}`)
}
if (!anyOut) md.push('_None._')

md.push('', '## Seasons where the page may not decide the field', '')
for (const r of rows.filter((x) => !x.safeToReconcile)) {
  md.push(`- **${r.label}** (Season ${r.seasonId}) — ${r.reason}`)
}

md.push('', '## Totals', '')
md.push(`- Seasons examined: **${rows.length}**`)
md.push(`- Pages proving a complete entry field: **${rows.filter((r) => r.bracketComplete).length}**`)
md.push(`- Safe to reconcile: **${rows.filter((r) => r.safeToReconcile).length}**`)
md.push(`- Selections to add: **${rows.reduce((a, r) => a + r.toSelect.length, 0)}**`)
md.push(`- Selections to remove: **${rows.reduce((a, r) => a + r.toDeselect.length, 0)}**`)
md.push(`- Same-person spelling pairs: **${rows.reduce((a, r) => a + r.sameCanonicalIdentity.length, 0)}**`)
writeFileSync('reports/archive-playoff-field-reconciliation.md', md.join('\n') + '\n')

console.log(JSON.stringify({
  seasons: rows.length,
  completePages: rows.filter((r) => r.bracketComplete).length,
  safeToReconcile: rows.filter((r) => r.safeToReconcile).length,
  toSelect: rows.reduce((a, r) => a + r.toSelect.length, 0),
  toDeselect: rows.reduce((a, r) => a + r.toDeselect.length, 0),
  sameCanonicalPairs: rows.reduce((a, r) => a + r.sameCanonicalIdentity.length, 0),
}, null, 2))
for (const r of rows) {
  console.log(`  ${r.label} (${r.seasonId}) complete=${r.bracketComplete} safe=${r.safeToReconcile} people ${r.manifestPeople}/${r.bracketPeople} sel ${r.currentlySelected}→${r.proposedSelected} (+${r.toSelect.length}/−${r.toDeselect.length}) same=${r.sameCanonicalIdentity.length}`)
}

await prisma.$disconnect()
