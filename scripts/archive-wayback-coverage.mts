/**
 * What the archived bracket pages can actually contribute, Season by Season.
 *
 * The parser says what each page contains; this says what may be done with it. A page can be
 * perfectly readable and still be unusable here — because the Season it describes was completed
 * years ago and its record is canonical, because its group stage was shared between divisions, or
 * because the page disagrees with itself.
 *
 * Nothing is written. This produces the inventory an import is then held to.
 *
 * Usage: tsx scripts/archive-wayback-coverage.mts
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

import { prisma } from '../src/lib/prisma.ts'
import { assertLocalDatabase } from '../src/lib/db-guard.ts'
import { parseWayback, type WaybackBracket } from '../src/lib/archive/wayback.ts'

assertLocalDatabase()
mkdirSync('reports', { recursive: true })

const ROOT = 'archive/wayback-seasons'

export interface CoverageRow {
  sourceFile: string
  competitionYear: number
  seasonNumber: number
  division: 'A'
  seasonId: number | null
  archiveTemplateKey: string | null
  lifecycleState: string | null
  alreadyCompleted: boolean
  bracketSize: number
  totalMatches: number
  provenMatches: number
  round1Proven: number
  round1Total: number
  laterRoundsProven: number
  finalProven: boolean
  championParsed: string | null
  championInDatabase: string | null
  championAgrees: boolean | null
  category: WaybackBracket['validation']['category']
  provenThroughRound: number
  firstUnsupported: string | null
  eligible: boolean
  blockReason: string | null
}

const files: string[] = []
if (existsSync(ROOT)) {
  // Only the year folders hold sources; anything else beside them is documentation.
  for (const year of readdirSync(ROOT).filter((y) => /^\d{4}$/.test(y))) {
    const dir = join(ROOT, year)
    for (const f of readdirSync(dir)) files.push(join(dir, f))
  }
}

const rows: CoverageRow[] = []
const anomalies: string[] = []

for (const file of files.sort()) {
  const bracket = parseWayback(readFileSync(file, 'utf8'), file)

  /*
   * Matching a page to a Season.
   *
   * These captures are Division A only — no file mentions Division B — so the lookup is pinned to
   * division A. Applying a Division A bracket to its Division B counterpart would be inventing that
   * Season's playoffs wholesale.
   */
  const season = bracket.competitionYear
    ? await prisma.season.findFirst({
        where: { competitionYear: bracket.competitionYear, number: bracket.seasonNumber, division: 'A' },
        select: { id: true, archiveTemplateKey: true, lifecycleState: true, championName: true },
      })
    : null

  const r1 = bracket.matches.filter((m) => m.round === 1)
  const later = bracket.matches.filter((m) => m.round > 1)
  const finalMatch = bracket.matches.find((m) => m.advancesTo === null && m.position === 0) ?? null

  const alreadyCompleted = String(season?.lifecycleState) === 'COMPLETED'
  const championAgrees = bracket.champion && season?.championName
    ? bracket.champion.toLowerCase() === season.championName.toLowerCase()
    : null

  let blockReason: string | null = null
  if (!season) blockReason = 'no Division A Season in the database for this page'
  else if (alreadyCompleted) blockReason = 'this Season is already complete; its record is canonical and read-only here'
  else if (bracket.validation.category === 'placement-only') blockReason = 'the page records no result'
  else if (bracket.validation.category === 'unusable') blockReason = 'the page does not parse as a bracket'
  else if (bracket.validation.category === 'contradictory') blockReason = 'the page disagrees with itself'
  else if (bracket.matches.filter((m) => m.proven && !m.bye).length === 0) blockReason = 'no match is individually proven'

  if (bracket.validation.category === 'contradictory') {
    anomalies.push(
      `- **${bracket.competitionYear} S${bracket.seasonNumber}A** (${file})\n` +
      bracket.validation.problems.map((p) => `  - ${p}`).join('\n'),
    )
  }
  if (season && !alreadyCompleted && championAgrees === false) {
    anomalies.push(`- **${bracket.competitionYear} S${bracket.seasonNumber}A** page names ${bracket.champion}, the database records ${season.championName}`)
  }
  if (alreadyCompleted && championAgrees === false) {
    anomalies.push(
      `- **${bracket.competitionYear} S${bracket.seasonNumber}A** (completed, left untouched): the page names ` +
      `${bracket.champion} as champion, the canonical record says ${season?.championName}`,
    )
  }

  rows.push({
    sourceFile: file.replace(/\\/g, '/'),
    competitionYear: bracket.competitionYear,
    seasonNumber: bracket.seasonNumber,
    division: 'A',
    seasonId: season?.id ?? null,
    archiveTemplateKey: season?.archiveTemplateKey ?? null,
    lifecycleState: season ? String(season.lifecycleState) : null,
    alreadyCompleted,
    bracketSize: bracket.bracketSize,
    totalMatches: bracket.matches.length,
    provenMatches: bracket.matches.filter((m) => m.proven).length,
    round1Proven: r1.filter((m) => m.proven).length,
    round1Total: r1.length,
    laterRoundsProven: later.filter((m) => m.proven).length,
    finalProven: Boolean(finalMatch?.proven),
    championParsed: bracket.champion,
    championInDatabase: season?.championName ?? null,
    championAgrees,
    category: bracket.validation.category,
    provenThroughRound: bracket.validation.provenThroughRound,
    firstUnsupported: bracket.validation.firstUnsupported
      ? `R${bracket.validation.firstUnsupported.round} match ${bracket.validation.firstUnsupported.position + 1}: ${bracket.validation.firstUnsupported.reason}`
      : null,
    eligible: !blockReason,
    blockReason,
  })
}

writeFileSync('reports/archive-wayback-playoff-coverage.json', JSON.stringify(rows, null, 2))

const md: string[] = []
md.push('# Wayback playoff coverage', '')
md.push('What each archived bracket page contains, and whether anything may be imported from it.', '')
md.push('These captures are Division A only. No page mentions Division B, and nothing here is ever')
md.push('applied to a Division B Season or to 2012–2014, for which no bracket page survives.', '')
md.push('| Source | Season | DB id | Lifecycle | Size | Proven / total | R1 | Later | Final | Champion (page) | Champion (DB) | Category | Eligible | Reason |')
md.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|')
for (const r of rows) {
  md.push(`| ${r.sourceFile.split('/').pop()} | ${r.competitionYear} S${r.seasonNumber}A | ${r.seasonId ?? '—'} | ${r.lifecycleState ?? '—'} | ${r.bracketSize || '—'} | ${r.provenMatches}/${r.totalMatches} | ${r.round1Proven}/${r.round1Total} | ${r.laterRoundsProven} | ${r.finalProven ? 'yes' : 'no'} | ${r.championParsed ?? '—'} | ${r.championInDatabase ?? '—'} | ${r.category} | ${r.eligible ? '**yes**' : 'no'} | ${r.blockReason ?? ''} |`)
}

const byCategory: Record<string, number> = {}
for (const r of rows) byCategory[r.category] = (byCategory[r.category] ?? 0) + 1
const eligible = rows.filter((r) => r.eligible)

md.push('', '## Totals', '')
md.push(`- Pages parsed: **${rows.length}**`)
for (const [k, v] of Object.entries(byCategory)) md.push(`- ${k}: **${v}**`)
md.push(`- Eligible for import: **${eligible.length}**`)
md.push(`- Proven matches across eligible Seasons: **${eligible.reduce((a, r) => a + r.provenMatches, 0)}**`)
md.push('', '### Eligible Seasons', '')
for (const r of eligible) {
  md.push(`- **${r.competitionYear} S${r.seasonNumber}A** (Season ${r.seasonId}) — ${r.provenMatches} of ${r.totalMatches} matches proven, category ${r.category}${r.firstUnsupported ? `, stops at ${r.firstUnsupported}` : ''}`)
}
md.push('', '### Completed Seasons compared but not touched', '')
for (const r of rows.filter((x) => x.alreadyCompleted)) {
  md.push(`- ${r.competitionYear} S${r.seasonNumber}A (Season ${r.seasonId}) — champion on the page: ${r.championParsed ?? '—'}; canonical: ${r.championInDatabase ?? '—'}${r.championAgrees === false ? ' — **differs**' : ''}`)
}
writeFileSync('reports/archive-wayback-playoff-coverage.md', md.join('\n') + '\n')

const an: string[] = []
an.push('# Source anomalies', '')
an.push('Places where the archive contradicts itself. None of these is resolved by choosing a side;')
an.push('each is recorded so the affected results can be left out rather than guessed at.', '')
if (anomalies.length === 0) an.push('_None found in the bracket pages._')
else an.push(...anomalies)
writeFileSync('reports/archive-source-anomalies.md', an.join('\n') + '\n')

console.log(JSON.stringify({
  pages: rows.length,
  byCategory,
  eligible: eligible.length,
  provenMatchesEligible: eligible.reduce((a, r) => a + r.provenMatches, 0),
  anomalies: anomalies.length,
}, null, 2))
for (const r of eligible) {
  console.log(`  eligible: ${r.competitionYear} S${r.seasonNumber}A season=${r.seasonId} ${r.category} proven=${r.provenMatches}/${r.totalMatches} final=${r.finalProven}`)
}

await prisma.$disconnect()
