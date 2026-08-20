/**
 * A read-only inventory of the offline 8BRCAM archive, 2006–2014.
 *
 * ── What this is for ─────────────────────────────────────────────────────────────────────────────
 * Before anything is written to the database, the source has to be counted and classified: which
 * archive entries are standard Seasons that belong as reconstruction shells, which are not, and
 * which cannot be decided from the source at all. This produces both a machine-readable inventory
 * and a report meant to be read, and it writes nothing but those two files.
 *
 * ── The rule about guessing ──────────────────────────────────────────────────────────────────────
 * Nothing here infers a fact the archive does not state. Where the source is silent or ambiguous the
 * entry is marked as such and carried forward with its raw values intact, because an unresolved note
 * can be resolved later and a fabricated value cannot be told from a real one afterwards.
 *
 *   npx tsx --tsconfig scripts/tsconfig.verify.json --env-file=.env scripts/archive-inventory-8brcam.mts
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'

const ARCHIVE_DIR = 'C:/Claude/Archive Viewer/8BRCAM'
const JSON_SOURCE = `${ARCHIVE_DIR}/8brcam-season-archive.json`
const HTML_SOURCE = `${ARCHIVE_DIR}/8brcam-season-archive.html`
const OUT_DIR = 'verification/archive-8brcam'

const FROM_YEAR = 2006
const TO_YEAR = 2014

interface ArchiveMatch { a: string; b: string; sa: number | null; sb: number | null; w: string | null }
interface ArchiveRow { pid: string; slot: number; played?: number; wins?: number; losses?: number; draws?: number; points?: number; total?: number; adv?: boolean }
interface ArchiveGroup { id: string; letter: string; scoreModel?: string; rows: ArchiveRow[]; matches: ArchiveMatch[] }
interface ArchiveSeason {
  key: string
  seasonId: string
  year: number
  period: number
  division: 'A' | 'B' | 'single'
  label: string
  divisionLabel?: string
  era?: string
  groupStatus?: string
  playoffStatus?: string
  completeness?: string
  notes?: string
  gamesPerMatch?: number
  entrants?: number
  groups: ArchiveGroup[]
  playoff?: { champion?: { pid: string; handle: string } | null; rounds?: unknown[] } | null
}
interface ArchiveFile {
  meta: { title: string; source: string; note: string; counts: Record<string, unknown> }
  players: Record<string, { id: string; name: string; handle: string }>
  seasons: ArchiveSeason[]
}

type Classification =
  | 'included'
  | 'excluded-out-of-range'
  | 'excluded-not-divisional'
  | 'excluded-prize-event'
  | 'excluded-2v2'
  | 'excluded-cup-or-side-event'
  | 'excluded-non-group-format'
  | 'excluded-duplicate'
  | 'ambiguous'
  | 'missing-identity'

const sha256 = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex')

/**
 * Titles that would mean this is not a standard Season.
 *
 * Searched against the raw label. The archive labels standard Seasons plainly — "2007 Season 1 ·
 * Division A" — so anything carrying one of these words is something else and is excluded by name
 * rather than by a judgement about its shape.
 */
const NON_SEASON_MARKERS: { pattern: RegExp; classification: Classification }[] = [
  { pattern: /\bprize\b/i, classification: 'excluded-prize-event' },
  { pattern: /\b2\s*v\s*2\b|\bdoubles\b|\bteams?\b/i, classification: 'excluded-2v2' },
  { pattern: /\bcup\b|\binvitational\b|\bside\b|\bspecial\b|\bexhibition\b/i, classification: 'excluded-cup-or-side-event' },
]

interface InventoryEntry {
  templateKey: string
  sourceKey: string
  classification: Classification
  reason: string
  competition: 'CUEVERSE_8BRCAM'
  year: number
  /** The archive's own Season number within the year. */
  seasonNumber: number
  division: string
  rawLabel: string
  /** The archive documents no month anywhere in this source — recorded, not invented. */
  competitionMonth: number | null
  monthConfidence: 'documented' | 'not-documented'
  groupCount: number
  participantCount: number
  exactMatchCount: number
  standingsRowCount: number
  /** Group data held under a DIFFERENT archive key, where the season's group stage was undivided. */
  groupsSourcedFrom: string | null
  groupAssignments: 'complete' | 'partial' | 'missing' | 'undivided-source'
  exactResults: 'complete' | 'partial' | 'missing'
  hasPlayoffData: boolean
  unresolved: string[]
  provenance: {
    sourceFile: string
    sourceSection: string
    rawSeasonTitle: string
    rawDivision: string
    sourceYear: number
    sourceMonth: number | null
    confidence: string
  }
}

function main() {
  for (const f of [JSON_SOURCE, HTML_SOURCE]) {
    if (!existsSync(f)) throw new Error(`Archive source missing: ${f}`)
  }

  const hashes = {
    '8brcam-season-archive.json': sha256(JSON_SOURCE),
    '8brcam-season-archive.html': sha256(HTML_SOURCE),
  }
  const archive = JSON.parse(readFileSync(JSON_SOURCE, 'utf8')) as ArchiveFile

  /*
   * Where an undivided group stage lives.
   *
   * In 2006 the group stage ran as one undivided field and only the PLAYOFFS split into Division A
   * and Division B — the archive records that as three entries: a "single" key holding the groups
   * with no playoff, and A and B keys holding the playoffs with no groups. That is a documented
   * structure rather than a duplicate, so the A and B Seasons are real. What cannot be decided from
   * the source is which of the undivided groups belonged to which division, so their group
   * assignments are recorded as unresolved rather than split by guesswork.
   */
  const singles = new Map<string, ArchiveSeason>()
  for (const s of archive.seasons) {
    if (s.division === 'single') singles.set(s.seasonId, s)
  }

  const entries: InventoryEntry[] = []

  for (const s of archive.seasons) {
    const unresolved: string[] = []
    const groupCount = s.groups?.length ?? 0
    const matches = (s.groups ?? []).flatMap((g) => g.matches ?? [])
    const rows = (s.groups ?? []).flatMap((g) => g.rows ?? [])
    const exact = matches.filter((m) => typeof m.sa === 'number' && typeof m.sb === 'number')
    const participants = new Set(rows.map((r) => r.pid))

    let classification: Classification = 'included'
    let reason = 'standard Season: group stage then Season playoffs'

    if (s.year < FROM_YEAR || s.year > TO_YEAR) {
      classification = 'excluded-out-of-range'
      reason = `competition year ${s.year} is outside ${FROM_YEAR}–${TO_YEAR}`
    } else if (s.division !== 'A' && s.division !== 'B') {
      /*
       * The undivided entries are not Seasons to create.
       *
       * They are the group-stage half of a Season whose A and B halves are separate entries, so
       * creating a shell for them as well would produce a third Season that never existed.
       */
      classification = 'excluded-not-divisional'
      reason = singles.has(s.seasonId)
        ? 'undivided group-stage record; its Division A and B Seasons are listed separately'
        : 'no Division A or B recorded'
    } else {
      const marker = NON_SEASON_MARKERS.find((m) => m.pattern.test(s.label))
      if (marker) {
        classification = marker.classification
        reason = `title matched ${marker.pattern} — not a standard Season`
      }
    }

    // Group data: present, absent, or living under the undivided key.
    const undivided = groupCount === 0 ? singles.get(s.seasonId) : undefined
    let groupAssignments: InventoryEntry['groupAssignments'] =
      groupCount > 0 ? (s.groupStatus === 'complete' ? 'complete' : 'partial') : 'missing'
    let groupsSourcedFrom: string | null = null

    if (groupCount === 0 && undivided && (undivided.groups?.length ?? 0) > 0) {
      groupAssignments = 'undivided-source'
      groupsSourcedFrom = undivided.key
      unresolved.push(
        `Group stage was undivided under "${undivided.key}" (${undivided.groups.length} groups, `
        + `${new Set(undivided.groups.flatMap((g) => g.rows.map((r) => r.pid))).size} participants). `
        + 'The archive does not record which division each group belonged to, so group assignments '
        + 'cannot be attributed to this Season without guessing.',
      )
    } else if (groupCount === 0) {
      unresolved.push('No group data in the archive for this Season.')
    }

    if (classification === 'included' && groupCount > 0 && exact.length < matches.length) {
      unresolved.push(`${matches.length - exact.length} group match(es) have no exact score recorded.`)
    }
    if (classification === 'included' && groupCount > 0 && matches.length === 0 && rows.length > 0) {
      unresolved.push('Standings available; exact match-level scores unavailable.')
    }

    const exactResults: InventoryEntry['exactResults'] =
      matches.length === 0 ? 'missing' : exact.length === matches.length ? 'complete' : 'partial'

    entries.push({
      templateKey: `8brcam-${s.year}-s${s.period}-${String(s.division).toLowerCase()}`,
      sourceKey: s.key,
      classification,
      reason,
      competition: 'CUEVERSE_8BRCAM',
      year: s.year,
      seasonNumber: s.period,
      division: s.division,
      rawLabel: s.label,
      // The archive records no month for any Season. Recorded as absent rather than inferred from a
      // playoff date or an import timestamp, both of which would be a different fact.
      competitionMonth: null,
      monthConfidence: 'not-documented',
      groupCount,
      participantCount: participants.size || (s.entrants ?? 0),
      exactMatchCount: exact.length,
      standingsRowCount: rows.length,
      groupsSourcedFrom,
      groupAssignments,
      exactResults,
      hasPlayoffData: ((s.playoff?.rounds as unknown[] | undefined)?.length ?? 0) > 0,
      unresolved,
      provenance: {
        sourceFile: '8brcam-season-archive.json',
        sourceSection: `seasons[key=${s.key}]`,
        rawSeasonTitle: s.label,
        rawDivision: s.divisionLabel ?? s.division,
        sourceYear: s.year,
        sourceMonth: null,
        confidence: s.completeness ?? 'unknown',
      },
    })
  }

  const included = entries.filter((e) => e.classification === 'included')
  const tally = (pred: (e: InventoryEntry) => boolean) => entries.filter(pred).length

  const summary = {
    generatedAt: new Date().toISOString(),
    sourceFiles: hashes,
    archiveMeta: archive.meta.counts,
    range: `${FROM_YEAR}–${TO_YEAR}`,
    candidateArchiveEvents: entries.length,
    includedSeasonShells: included.length,
    divisionA: included.filter((e) => e.division === 'A').length,
    divisionB: included.filter((e) => e.division === 'B').length,
    excludedOutOfRange: tally((e) => e.classification === 'excluded-out-of-range'),
    excludedNotDivisional: tally((e) => e.classification === 'excluded-not-divisional'),
    excludedPrizeEvents: tally((e) => e.classification === 'excluded-prize-event'),
    excluded2v2: tally((e) => e.classification === 'excluded-2v2'),
    excludedCupOrSide: tally((e) => e.classification === 'excluded-cup-or-side-event'),
    excludedNonGroupFormat: tally((e) => e.classification === 'excluded-non-group-format'),
    excludedDuplicate: tally((e) => e.classification === 'excluded-duplicate'),
    ambiguous: tally((e) => e.classification === 'ambiguous'),
    knownMonths: included.filter((e) => e.competitionMonth != null).length,
    unknownMonths: included.filter((e) => e.competitionMonth == null).length,
    groupAssignmentsComplete: included.filter((e) => e.groupAssignments === 'complete').length,
    groupAssignmentsPartial: included.filter((e) => e.groupAssignments === 'partial').length,
    groupAssignmentsUndividedSource: included.filter((e) => e.groupAssignments === 'undivided-source').length,
    groupAssignmentsMissing: included.filter((e) => e.groupAssignments === 'missing').length,
    exactResultsComplete: included.filter((e) => e.exactResults === 'complete').length,
    exactResultsPartial: included.filter((e) => e.exactResults === 'partial').length,
    exactResultsMissing: included.filter((e) => e.exactResults === 'missing').length,
    totalExactGroupMatches: included.reduce((n, e) => n + e.exactMatchCount, 0),
    seasonsWithUnresolvedNotes: included.filter((e) => e.unresolved.length > 0).length,
    byYear: Object.fromEntries(
      [...new Set(included.map((e) => e.year))].sort().map((y) => [y, included.filter((e) => e.year === y).length]),
    ),
  }

  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true })
  writeFileSync(`${OUT_DIR}/inventory.json`, JSON.stringify({ summary, entries }, null, 2))

  const lines: string[] = []
  lines.push('8BRCAM ARCHIVE INVENTORY — 2006 to 2014')
  lines.push('='.repeat(78))
  lines.push('')
  lines.push('Read-only. No database was touched to produce this.')
  lines.push('')
  lines.push('SOURCE')
  for (const [f, h] of Object.entries(hashes)) lines.push(`  ${f}`), lines.push(`    sha256 ${h}`)
  lines.push('')
  lines.push('TOTALS')
  lines.push(`  Candidate archive entries        ${summary.candidateArchiveEvents}`)
  lines.push(`  Included Season shells           ${summary.includedSeasonShells}`)
  lines.push(`    Division A                     ${summary.divisionA}`)
  lines.push(`    Division B                     ${summary.divisionB}`)
  lines.push(`  Excluded — outside 2006-2014     ${summary.excludedOutOfRange}`)
  lines.push(`  Excluded — not A/B divisional    ${summary.excludedNotDivisional}`)
  lines.push(`  Excluded — prize events          ${summary.excludedPrizeEvents}`)
  lines.push(`  Excluded — 2v2                   ${summary.excluded2v2}`)
  lines.push(`  Excluded — Cup / side events     ${summary.excludedCupOrSide}`)
  lines.push(`  Ambiguous                        ${summary.ambiguous}`)
  lines.push('')
  lines.push('MONTHS')
  lines.push(`  Documented                       ${summary.knownMonths}`)
  lines.push(`  Not documented (remain null)     ${summary.unknownMonths}`)
  lines.push('  The archive records no month for any Season. Nothing was inferred from a playoff')
  lines.push('  date or an import timestamp: those are different facts.')
  lines.push('')
  lines.push('GROUP ASSIGNMENT COVERAGE')
  lines.push(`  Complete                         ${summary.groupAssignmentsComplete}`)
  lines.push(`  Partial                          ${summary.groupAssignmentsPartial}`)
  lines.push(`  Undivided source (see below)     ${summary.groupAssignmentsUndividedSource}`)
  lines.push(`  Missing                          ${summary.groupAssignmentsMissing}`)
  lines.push('')
  lines.push('EXACT GROUP RESULT COVERAGE')
  lines.push(`  Complete                         ${summary.exactResultsComplete}`)
  lines.push(`  Partial                          ${summary.exactResultsPartial}`)
  lines.push(`  Missing                          ${summary.exactResultsMissing}`)
  lines.push(`  Exact group matches available    ${summary.totalExactGroupMatches}`)
  lines.push('')
  lines.push('PER YEAR (included)')
  for (const [y, n] of Object.entries(summary.byYear)) lines.push(`  ${y}  ${n}`)
  lines.push('')
  lines.push('INCLUDED SEASONS')
  lines.push('-'.repeat(78))
  for (const e of included) {
    lines.push(`${e.templateKey}   ${e.rawLabel}`)
    lines.push(`    groups ${e.groupCount}  participants ${e.participantCount}  exact results ${e.exactMatchCount}`
      + `  standings rows ${e.standingsRowCount}`)
    lines.push(`    assignments ${e.groupAssignments}   results ${e.exactResults}   playoffs ${e.hasPlayoffData ? 'yes' : 'no'}`)
    for (const u of e.unresolved) lines.push(`    UNRESOLVED: ${u}`)
  }
  lines.push('')
  lines.push('EXCLUDED')
  lines.push('-'.repeat(78))
  for (const e of entries.filter((x) => x.classification !== 'included')) {
    lines.push(`${e.sourceKey}  [${e.classification}]  ${e.rawLabel}`)
    lines.push(`    ${e.reason}`)
  }

  writeFileSync(`${OUT_DIR}/inventory-report.txt`, lines.join('\n'))

  console.log(lines.slice(0, 60).join('\n'))
  console.log(`\n… full report → ${OUT_DIR}/inventory-report.txt`)
  console.log(`machine-readable → ${OUT_DIR}/inventory.json`)
}

main()
