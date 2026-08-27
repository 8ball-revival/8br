/**
 * Classify every Division A archive Season by what its SOURCES can support — before repairing any.
 *
 * A repair plan built from the database's failures alone would try to fix Seasons whose sources
 * cannot settle them, and would call the result a defect when it is a limit of the capture. So each
 * Season is classified by evidence first:
 *
 *   REPAIRABLE      the manifest describes the Season and the page (where needed) resolves; the
 *                   reconstruction can rebuild it and the audit should then pass.
 *   BLOCKED_TBD     the archived page carries the literal placeholder `tbd` in round-one positions.
 *                   A missing SCORE can be settled from the advancement; a missing PLAYER cannot be
 *                   settled from anything, and seating `tbd` would invent a competitor.
 *   MANIFEST_SILENT the manifest does not describe this Season at all. 2006-2007 were imported in an
 *                   earlier pass under different rules; the manifest records no participants and no
 *                   groups for them, so it cannot be used to judge what the database holds.
 *
 * Read-only. Usage: tsx scripts/archive-repair-inventory.mts [--json]
 */
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs'

import { prisma } from '../src/lib/prisma.ts'
import { assertLocalDatabase } from '../src/lib/db-guard.ts'
import { manifestEntry } from '../src/lib/archive/manifest.ts'
import { parseWayback } from '../src/lib/archive/wayback.ts'

assertLocalDatabase()

type Classification = 'REPAIRABLE' | 'BLOCKED_TBD' | 'MANIFEST_SILENT'

interface Row {
  seasonId: number
  label: string
  lifecycleState: string
  classification: Classification
  reason: string
  manifest: { participants: number; groups: number; matches: number; playoffParticipants: number; placement: string }
  page: { present: boolean; category?: string; proven?: number; tbd?: number }
  database: {
    entrants: number; groups: number; standings: number; groupMatches: number
    playoffMatches: number; playoffField: number; champion: string | null
    ladderApplied: boolean; ledgerRows: number
  }
  /** What the repair would move each count to, where the sources settle it. */
  target: { entrants: number | null; groups: number | null; groupMatches: number | null; playoffField: number | null }
}

const seasons = await prisma.season.findMany({
  where: { archiveTemplateKey: { not: null }, division: 'A' },
  select: {
    id: true, number: true, division: true, competitionYear: true, archiveTemplateKey: true,
    lifecycleState: true, championName: true, ladderAppliedAt: true,
  },
  orderBy: [{ competitionYear: 'asc' }, { number: 'asc' }],
})

const rows: Row[] = []

for (const s of seasons) {
  const label = `${s.competitionYear} S${s.number}${s.division ?? ''}`
  const entry = manifestEntry(s.archiveTemplateKey!)

  const pagePath = `archive/wayback-seasons/${s.competitionYear}/${s.competitionYear} s${s.number}.txt`
  const raw = existsSync(pagePath) ? readFileSync(pagePath, 'utf8') : null
  const page = raw ? parseWayback(raw, pagePath) : null

  /*
   * `tbd` is counted from the RAW text rather than the parsed bracket: the parser's job is to yield
   * the positions it can read, so a placeholder it declined to seat leaves no trace in its output.
   * The question here is whether the source ever named that player, which only the text answers.
   */
  const tbd = raw ? (raw.match(/\btbd\b/gi) ?? []).length : 0

  const [entrants, groups, standings, groupMatches, playoffMatches, playoffField, ledgerRows] = await Promise.all([
    prisma.seasonEntrant.count({ where: { seasonId: s.id, status: 'APPROVED' } }),
    prisma.seasonGroup.count({ where: { seasonId: s.id } }),
    prisma.seasonStanding.count({ where: { seasonId: s.id } }),
    prisma.seasonMatch.count({ where: { seasonId: s.id } }),
    prisma.seasonPlayoffMatch.count({ where: { seasonId: s.id } }),
    prisma.seasonEntrant.count({ where: { seasonId: s.id, playoffIncluded: true } }),
    prisma.ratingLedger.count({ where: { seasonId: s.id } }),
  ])

  const mParticipants = entry?.participants.length ?? 0
  const mGroups = entry ? new Set(entry.participants.map((p) => p.groupName)).size : 0
  const mMatches = entry?.matches.length ?? 0
  const mPlayoff = entry?.playoff.participants.length ?? 0

  let classification: Classification
  let reason: string
  if (mParticipants === 0) {
    classification = 'MANIFEST_SILENT'
    reason = 'the manifest records no participants for this Season, so it cannot describe what the database holds'
  } else if (tbd > 0) {
    classification = 'BLOCKED_TBD'
    reason = `the archived page carries ${tbd} literal "tbd" placeholder(s); a missing player cannot be settled from the advancement`
  } else {
    classification = 'REPAIRABLE'
    reason = 'the manifest describes the Season and the page seats no placeholder'
  }

  rows.push({
    seasonId: s.id,
    label,
    lifecycleState: String(s.lifecycleState),
    classification,
    reason,
    manifest: {
      participants: mParticipants, groups: mGroups, matches: mMatches,
      playoffParticipants: mPlayoff, placement: entry?.playoff.placement ?? 'none',
    },
    page: page
      ? { present: true, category: page.validation.category, proven: page.matches.filter((m) => m.proven).length, tbd }
      : { present: false, tbd },
    database: {
      entrants, groups, standings, groupMatches, playoffMatches, playoffField,
      champion: s.championName, ladderApplied: Boolean(s.ladderAppliedAt), ledgerRows,
    },
    target: classification === 'MANIFEST_SILENT'
      ? { entrants: null, groups: null, groupMatches: null, playoffField: null }
      : {
          entrants: mParticipants,
          groups: mGroups,
          groupMatches: entry ? [...new Set(entry.participants.map((p) => p.groupName))]
            .map((g) => entry.participants.filter((p) => p.groupName === g).length)
            .reduce((a, k) => a + (k * (k - 1)) / 2, 0) : null,
          playoffField: mPlayoff,
        },
  })
}

mkdirSync('reports', { recursive: true })
writeFileSync('reports/archive-repair-inventory.json', JSON.stringify(rows, null, 2))

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(rows, null, 2))
} else {
  const by = (c: Classification) => rows.filter((r) => r.classification === c)
  for (const c of ['REPAIRABLE', 'BLOCKED_TBD', 'MANIFEST_SILENT'] as Classification[]) {
    const set = by(c)
    console.log(`\n=== ${c} — ${set.length} Season(s) ===`)
    for (const r of set) {
      console.log(`  ${r.label} (${r.seasonId}) ${r.lifecycleState}`)
      console.log(`      db      entrants=${r.database.entrants} groups=${r.database.groups} standings=${r.database.standings} matches=${r.database.groupMatches} playoff=${r.database.playoffMatches} field=${r.database.playoffField} champion=${r.database.champion ?? '-'} ledger=${r.database.ledgerRows}`)
      console.log(`      source  participants=${r.manifest.participants} groups=${r.manifest.groups} matches=${r.manifest.matches} playoffField=${r.manifest.playoffParticipants} placement=${r.manifest.placement} page=${r.page.present ? r.page.category : 'none'} tbd=${r.page.tbd ?? 0}`)
      if (c === 'REPAIRABLE') {
        console.log(`      target  entrants=${r.target.entrants} groups=${r.target.groups} matches=${r.target.groupMatches} field=${r.target.playoffField}`)
      } else {
        console.log(`      reason  ${r.reason}`)
      }
    }
  }
  console.log(`\nwritten: reports/archive-repair-inventory.json`)
}

await prisma.$disconnect()
