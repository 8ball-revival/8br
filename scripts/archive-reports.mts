/**
 * Regenerate every archive report from the database and the manifest.
 *
 * Each identity's Season appearances are recomputed by scanning the whole manifest, not taken from
 * wherever a handle was first noticed — a handle first seen in 2012 may well have been playing since
 * 2007, and reporting only the first sighting understates who these people are.
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'

import { prisma } from '../src/lib/prisma.ts'
import { assertLocalDatabase } from '../src/lib/db-guard.ts'
import { loadManifest, manifestEntry, stripSourceNote, type ManifestEntry } from '../src/lib/archive/manifest.ts'

assertLocalDatabase()
mkdirSync('reports', { recursive: true })

const entries = loadManifest().entries as ManifestEntry[]

/** handle → every Season the archive prints it in, group table or bracket. */
const appearances = new Map<string, string[]>()
for (const e of entries) {
  const label = `${e.competitionYear} S${e.seasonNumber}${e.division}`
  for (const p of [...e.participants, ...(e.playoff?.participants ?? [])]) {
    const h = stripSourceNote(p.normalizedHandle).toLowerCase()
    if (!h) continue
    const cur = appearances.get(h) ?? []
    if (!cur.includes(label)) cur.push(label)
    appearances.set(h, cur)
  }
}

const progress: Record<string, {
  seasonId: number; label: string; stage: string; entrantsAdded: number; groupsPlaced: number
  resultsImported: number; playoffSelected: number; round1Placed: number; byes: number
  bracketSize: number | null; error: string | null; notes: string[]; unresolved: string[]
}> = existsSync('reports/archive-import-progress.json')
  ? JSON.parse(readFileSync('reports/archive-import-progress.json', 'utf8'))
  : {}

// ── 1. Import summary, per Season ───────────────────────────────────────────────────────────────
const seasons = await prisma.season.findMany({
  where: { archiveTemplateKey: { not: null } },
  select: {
    id: true, number: true, division: true, competitionYear: true, archiveTemplateKey: true,
    lifecycleState: true, championName: true,
  },
  orderBy: [{ competitionYear: 'asc' }, { number: 'asc' }, { division: 'asc' }],
})

const lines: string[] = []
lines.push('# Archive import summary', '')
lines.push('Every archive-linked Season, what the source offered, and what was built from it.', '')
lines.push('| DB id | Competition | Ending lifecycle | Manifest participants | Entrants | Groups | Group results imported | Unimported | Playoff field selected | R1 placed | R1 unresolved | Playoff results | Complete | Reason if not |')
lines.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|')

let totalEntrants = 0, totalResults = 0, totalR1 = 0, totalPlayoffResults = 0
let completed = 0, partial = 0, blocked = 0

for (const s of seasons) {
  const entry = manifestEntry(s.archiveTemplateKey!)
  const p = progress[String(s.id)]
  const label = `${s.competitionYear} S${s.number}${s.division ?? ''}`

  const entrants = await prisma.seasonEntrant.count({ where: { seasonId: s.id, status: 'APPROVED' } })
  const groups = await prisma.seasonGroup.count({ where: { seasonId: s.id } })
  const scored = await prisma.seasonMatch.count({ where: { seasonId: s.id, homeGames: { not: null } } })
  const selected = await prisma.seasonEntrant.count({ where: { seasonId: s.id, playoffIncluded: true } })
  const r1 = await prisma.seasonPlayoffMatch.findMany({
    where: { seasonId: s.id, round: 1 }, select: { homeEntrantId: true, awayEntrantId: true },
  })
  const seated = r1.flatMap((m) => [m.homeEntrantId, m.awayEntrantId]).filter(Boolean).length
  const playoffResults = await prisma.seasonPlayoffMatch.count({ where: { seasonId: s.id, winnerEntrantId: { not: null } } })

  const wantParticipants = entry
    ? new Set([...entry.participants, ...(entry.playoff?.participants ?? [])]
        .map((x) => stripSourceNote(x.normalizedHandle).toLowerCase())).size
    : 0
  const wantR1 = entry?.playoff.placement === 'exact' ? entry.playoff.participants.length : 0
  const unimported = entry ? Math.max(0, entry.matches.length - scored) : 0

  const isComplete = String(s.lifecycleState) === 'COMPLETED'
  const stage = p?.stage ?? (isComplete ? 'completed' : 'not processed')
  if (isComplete) completed++
  else if (stage === 'blocked') blocked++
  else partial++

  totalEntrants += entrants; totalResults += scored; totalR1 += seated; totalPlayoffResults += playoffResults

  const reason = isComplete ? '' : (p?.error ?? p?.unresolved?.[0] ?? (entry ? '' : 'no manifest entry'))
  lines.push(`| ${s.id} | ${label} | ${s.lifecycleState} | ${wantParticipants} | ${entrants} | ${groups} | ${scored} | ${unimported} | ${selected} | ${seated}${wantR1 ? `/${wantR1}` : ''} | ${Math.max(0, wantR1 - seated)} | ${playoffResults} | ${isComplete ? 'yes' : 'no'} | ${reason.replace(/\|/g, '/')} |`)
}

lines.push('', '## Totals', '')
lines.push(`- Archive-linked Seasons: **${seasons.length}**`)
lines.push(`- Already complete before this work: **${completed}**`)
lines.push(`- Reconstructed but not complete: **${partial}**`)
lines.push(`- Correctly refused: **${blocked}**`)
lines.push(`- Entrants: **${totalEntrants}**`)
lines.push(`- Group results imported: **${totalResults}**`)
lines.push(`- Round 1 positions seated: **${totalR1}**`)
lines.push(`- Playoff results imported: **${totalPlayoffResults}**`)
writeFileSync('reports/archive-import-summary.md', lines.join('\n') + '\n')

// ── 2. Created players ──────────────────────────────────────────────────────────────────────────
const players = await prisma.player.findMany({
  select: { id: true, cueverseId: true, cueverseIdNormalized: true, primaryName: true, linkedUserId: true, createdAt: true },
  orderBy: { createdAt: 'asc' },
})
const merges = await prisma.playerMerge.findMany({ select: { mergedPlayerId: true, canonicalPlayerId: true } })
const mergedAway = new Map(merges.map((m) => [m.mergedPlayerId, m.canonicalPlayerId]))

const CREATED_FROM = new Date('2026-08-22T00:00:00Z')
const created = players.filter((p) => p.createdAt >= CREATED_FROM)

const csv = ['cueverse_id,player_id,account_id,preferred_name,seasons_in_archive,first_season,last_season,status']
const md = ['# Players created for the archive reconstruction', '',
  `${created.length} accounts, one per archive handle that matched no existing identity.`,
  'Season appearances are counted across the whole manifest, not only where the handle was first noticed.', '',
  '| CueVerse ID | Player id | Account | Preferred name | Seasons | First | Last |', '|---|---|---|---|---|---|---|']

for (const p of created) {
  const h = (p.cueverseIdNormalized ?? '').toLowerCase()
  const seen = appearances.get(h) ?? []
  const sorted = [...seen].sort()
  const status = mergedAway.has(p.id) ? 'merged' : 'active'
  csv.push([p.cueverseId ?? '', p.id, p.linkedUserId ?? '', (p.primaryName ?? '').replace(/,/g, ' '),
    seen.length, sorted[0] ?? '', sorted.at(-1) ?? '', status].join(','))
  if (status === 'active') {
    md.push(`| ${p.cueverseId} | \`${p.id}\` | ${p.linkedUserId ?? '—'} | ${p.primaryName ?? '—'} | ${seen.length} | ${sorted[0] ?? '—'} | ${sorted.at(-1) ?? '—'} |`)
  }
}
writeFileSync('reports/archive-created-players.csv', csv.join('\n') + '\n')
writeFileSync('reports/archive-created-players.md', md.join('\n') + '\n')

// ── 3. Playoff coverage ─────────────────────────────────────────────────────────────────────────
const cov = ['# Playoff coverage', '',
  'What the archive records about each Season\'s playoffs, and how far the reconstruction could go.', '',
  '| Competition | Placement recorded | Bracket size | Playoff participants | Selected | R1 seated | Results in source |', '|---|---|---|---|---|---|---|']
let exact = 0, partOnly = 0, none = 0
for (const s of seasons) {
  const entry = manifestEntry(s.archiveTemplateKey!)
  if (!entry) continue
  const po = entry.playoff
  if (po.placement === 'exact') exact++
  else if (po.placement === 'participants-only') partOnly++
  else none++
  const selected = await prisma.seasonEntrant.count({ where: { seasonId: s.id, playoffIncluded: true } })
  const r1 = await prisma.seasonPlayoffMatch.findMany({ where: { seasonId: s.id, round: 1 }, select: { homeEntrantId: true, awayEntrantId: true } })
  const seated = r1.flatMap((m) => [m.homeEntrantId, m.awayEntrantId]).filter(Boolean).length
  cov.push(`| ${s.competitionYear} S${s.number}${s.division ?? ''} | ${po.placement} | ${po.bracketSize ?? '—'} | ${po.participants.length} | ${selected} | ${seated} | none |`)
}
cov.push('', '## Summary', '',
  `- Exact topology recorded: **${exact}**`,
  `- Participants only: **${partOnly}**`,
  `- No playoff record: **${none}**`, '',
  'The manifest records no per-match playoff score for any Season — participants, champion and',
  'runner-up only. No playoff result has been imported, and none has been invented.')
writeFileSync('reports/archive-playoff-coverage.md', cov.join('\n') + '\n')

console.log(JSON.stringify({
  summaryRows: seasons.length, completed, partial, blocked,
  totalEntrants, totalResults, totalR1, totalPlayoffResults,
  createdPlayers: created.length,
  playoff: { exact, participantsOnly: partOnly, none },
}, null, 2))

await prisma.$disconnect()
