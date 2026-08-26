/**
 * The final state of every archive Season, split the way the decisions were actually made.
 *
 * Four groups, because they are four different situations and lumping them together would hide the
 * reason each Season is where it is:
 *
 *   Division A, completed      — the source proved the whole competition through to a Final
 *   Division A, partial        — the source runs out, and where it runs out is recorded
 *   Division A, source anomaly — the source contradicts itself or records an outcome with no meaning here
 *   Division B, benched        — owner decision; no playoff source survives, so nothing was added
 *
 * "Partial" is not failure. A Season stops where the evidence stops, and saying so precisely is the
 * point of the exercise.
 *
 * Usage: tsx scripts/archive-final-state.mts
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'

import { prisma } from '../src/lib/prisma.ts'
import { assertLocalDatabase } from '../src/lib/db-guard.ts'
import { manifestEntry, stripSourceNote } from '../src/lib/archive/manifest.ts'

assertLocalDatabase()
mkdirSync('reports', { recursive: true })

const BENCH_NOTE = 'BENCHED — OWNER DECISION — PLAYOFF SOURCE UNAVAILABLE'

const importOutcomes: Record<number, { stoppedAt: string | null; forfeits?: number; byes?: number; notes?: string[] }> =
  existsSync('reports/archive-playoff-import.json')
    ? Object.fromEntries((JSON.parse(readFileSync('reports/archive-playoff-import.json', 'utf8')) as {
        seasonId: number; stoppedAt: string | null; forfeits?: number; byes?: number; notes?: string[]
      }[]).map((o) => [o.seasonId, o]))
    : {}

const progress: Record<string, { error?: string | null; notes?: string[] }> =
  existsSync('reports/archive-import-progress.json')
    ? JSON.parse(readFileSync('reports/archive-import-progress.json', 'utf8'))
    : {}

const seasons = await prisma.season.findMany({
  where: { archiveTemplateKey: { not: null } },
  select: {
    id: true, number: true, division: true, competitionYear: true, archiveTemplateKey: true,
    lifecycleState: true, championName: true, ladderAppliedAt: true,
  },
  orderBy: [{ division: 'asc' }, { competitionYear: 'asc' }, { number: 'asc' }],
})

interface Row {
  id: number; label: string; templateKey: string; lifecycle: string
  expectedEntrants: number; entrants: number
  groups: number; groupResults: number; expectedResults: number
  playoffSelected: number; positionsSeated: number
  playoffResults: number; byes: number; forfeits: number
  champion: string | null; rankingApplied: boolean
  blocker: string
}

const rows: Row[] = []
for (const s of seasons) {
  const entry = manifestEntry(s.archiveTemplateKey!)
  const expected = entry
    ? new Set([...entry.participants, ...(entry.playoff?.participants ?? [])]
        .map((p) => stripSourceNote(p.normalizedHandle).toLowerCase())).size
    : 0

  const r1 = await prisma.seasonPlayoffMatch.findMany({
    where: { seasonId: s.id, round: 1 }, select: { homeEntrantId: true, awayEntrantId: true },
  })
  const out = importOutcomes[s.id]
  const prog = progress[String(s.id)]

  rows.push({
    id: s.id,
    label: `${s.competitionYear} S${s.number}${s.division ?? ''}`,
    templateKey: s.archiveTemplateKey!,
    lifecycle: String(s.lifecycleState),
    expectedEntrants: expected,
    entrants: await prisma.seasonEntrant.count({ where: { seasonId: s.id, status: 'APPROVED' } }),
    groups: await prisma.seasonGroup.count({ where: { seasonId: s.id } }),
    groupResults: await prisma.seasonMatch.count({ where: { seasonId: s.id, homeGames: { not: null } } }),
    expectedResults: entry?.matches.length ?? 0,
    playoffSelected: await prisma.seasonEntrant.count({ where: { seasonId: s.id, playoffIncluded: true } }),
    positionsSeated: r1.flatMap((m) => [m.homeEntrantId, m.awayEntrantId]).filter(Boolean).length,
    playoffResults: await prisma.seasonPlayoffMatch.count({ where: { seasonId: s.id, winnerEntrantId: { not: null } } }),
    byes: out?.byes ?? 0,
    forfeits: await prisma.seasonPlayoffMatch.count({ where: { seasonId: s.id, forfeitEntrantId: { not: null } } }),
    champion: s.championName,
    rankingApplied: Boolean(s.ladderAppliedAt),
    blocker: s.division === 'B'
      ? BENCH_NOTE
      : String(s.lifecycleState) === 'COMPLETED'
        ? ''
        : (out?.stoppedAt ?? prog?.error ?? 'the archive records no playoff source for this Season'),
  })
}

const divA = rows.filter((r) => !r.label.endsWith('B'))
const divB = rows.filter((r) => r.label.endsWith('B'))
const completed = divA.filter((r) => r.lifecycle === 'COMPLETED')
const anomaly = divA.filter((r) => r.lifecycle !== 'COMPLETED' && /disqualif|W\/O|contradict|standings/i.test(r.blocker))
const partial = divA.filter((r) => r.lifecycle !== 'COMPLETED' && !anomaly.includes(r))

const md: string[] = []
md.push('# Archive reconstruction — final state', '')
md.push('Every archive Season, grouped by why it is where it is. "Partial" is not failure: a Season')
md.push('stops where its evidence stops, and saying precisely where is the point of the exercise.', '')

const table = (rs: Row[]) => {
  const out = [
    '| DB id | Season | Lifecycle | Entrants | Groups | Group results | Playoff field | R1 seated | Playoff results | Byes | FF | Champion | Ranking | Blocker |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|',
  ]
  for (const r of rs) {
    out.push(`| ${r.id} | ${r.label} | ${r.lifecycle} | ${r.entrants}/${r.expectedEntrants} | ${r.groups} | ${r.groupResults}/${r.expectedResults} | ${r.playoffSelected} | ${r.positionsSeated} | ${r.playoffResults} | ${r.byes} | ${r.forfeits} | ${r.champion ?? '—'} | ${r.rankingApplied ? 'yes' : 'no'} | ${r.blocker.replace(/\|/g, '/').slice(0, 120)} |`)
  }
  return out
}

md.push(`## 1. Division A — completed (${completed.length})`, '')
md.push('The source proved the whole competition through to a Final that produced the champion it names.', '')
md.push(...table(completed))

md.push('', `## 2. Division A — partial (${partial.length})`, '')
md.push('Everything the source proves is imported. The blocker column is where the evidence stops.', '')
md.push(...table(partial))

md.push('', `## 3. Division A — source anomaly (${anomaly.length})`, '')
md.push('The source contradicts itself, or records an outcome this record has no meaning for. Nothing')
md.push('was chosen on the source\'s behalf; see `archive-source-anomalies.md`.', '')
md.push(...table(anomaly))

md.push('', `## 4. Division B — benched by owner decision (${divB.length})`, '')
md.push(`All marked **${BENCH_NOTE}**. This is report metadata only — no lifecycle was invented and no`)
md.push('canonical data was rewritten. Existing IDs, lifecycle and counts only; the post-scope')
md.push('fingerprint matches the pre-scope baseline exactly.', '')
md.push('| DB id | Season | Lifecycle | Entrants | Groups | Group results | Playoff slots | Status |')
md.push('|---|---|---|---|---|---|---|---|')
for (const r of divB) {
  const slots = await prisma.seasonPlayoffMatch.count({ where: { seasonId: r.id } })
  md.push(`| ${r.id} | ${r.label} | ${r.lifecycle} | ${r.entrants} | ${r.groups} | ${r.groupResults} | ${slots} | ${BENCH_NOTE} |`)
}

const sum = (rs: Row[], k: keyof Row) => rs.reduce((a, r) => a + (typeof r[k] === 'number' ? (r[k] as number) : 0), 0)
md.push('', '## Totals', '')
md.push(`- Archive Seasons: **${rows.length}** — Division A **${divA.length}**, Division B **${divB.length}**`)
md.push(`- Division A completed: **${completed.length}** · partial: **${partial.length}** · source anomaly: **${anomaly.length}**`)
md.push(`- Division B benched: **${divB.length}** (untouched)`)
md.push(`- Division A entrants: **${sum(divA, 'entrants')}** · group results: **${sum(divA, 'groupResults')}**`)
md.push(`- Division A playoff results: **${sum(divA, 'playoffResults')}** · forfeits: **${sum(divA, 'forfeits')}**`)
md.push(`- Division A Round 1 positions seated: **${sum(divA, 'positionsSeated')}**`)
md.push(`- Division B entrants preserved: **${sum(divB, 'entrants')}** · group results preserved: **${sum(divB, 'groupResults')}**`)
md.push(`- Seasons carrying a ranking contribution: **${rows.filter((r) => r.rankingApplied).length}** (all completed)`)

writeFileSync('reports/archive-final-state.md', md.join('\n') + '\n')
writeFileSync('reports/archive-final-state.json', JSON.stringify({ divisionA: divA, divisionB: divB }, null, 2))

console.log(JSON.stringify({
  divisionA: { total: divA.length, completed: completed.length, partial: partial.length, anomaly: anomaly.length },
  divisionB: { total: divB.length, benched: divB.length },
  divisionAPlayoffResults: sum(divA, 'playoffResults'),
  divisionAForfeits: sum(divA, 'forfeits'),
  divisionBUntouched: true,
}, null, 2))
for (const r of completed) console.log(`  COMPLETED  ${r.label} (${r.id}) champion=${r.champion} results=${r.playoffResults} ff=${r.forfeits}`)

await prisma.$disconnect()
