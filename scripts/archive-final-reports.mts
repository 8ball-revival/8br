/**
 * The reports that say what the reconstruction did, and what it refused to do.
 *
 * Three things belong in writing at the end of a job like this: what was built, what the source
 * contradicts itself about, and which identities remain undecided. The last two matter most —
 * anything unresolved here was left unresolved on purpose, and a future run needs to know that
 * rather than rediscovering it.
 *
 * Usage: tsx scripts/archive-final-reports.mts
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { prisma } from '../src/lib/prisma.ts'
import { assertLocalDatabase } from '../src/lib/db-guard.ts'
import { parseWayback } from '../src/lib/archive/wayback.ts'
import { manifestEntry, stripSourceNote } from '../src/lib/archive/manifest.ts'

assertLocalDatabase()
mkdirSync('reports', { recursive: true })

// ── Source anomalies ─────────────────────────────────────────────────────────────────────────────
const anomalies: string[] = []
anomalies.push('# Source anomalies', '')
anomalies.push('Places where the archive contradicts itself, or records something this system has no')
anomalies.push('outcome for. None is resolved by preferring one side; each is written down so the affected')
anomalies.push('results can be left out rather than guessed at.', '')

anomalies.push('## Disqualifications', '')
anomalies.push('A disqualification is not a score and not a forfeit. There is no disqualification outcome in')
anomalies.push('this record, and inventing one to finish an import would be creating a competition rule out')
anomalies.push('of an archive job. Every match below is left unimported, and every later match that depends')
anomalies.push('on it is left unresolved.', '')

const ROOT = 'archive/wayback-seasons'
const files: string[] = []
if (existsSync(ROOT)) for (const y of readdirSync(ROOT).filter((x) => /^\d{4}$/.test(x))) for (const f of readdirSync(join(ROOT, y))) files.push(join(ROOT, y, f))

let dqCount = 0, woCount = 0
for (const file of files.sort()) {
  const b = parseWayback(readFileSync(file, 'utf8'), file)
  if (b.format !== 'columnar') continue
  const season = await prisma.season.findFirst({
    where: { competitionYear: b.competitionYear, number: b.seasonNumber, division: 'A' },
    select: { id: true, lifecycleState: true },
  })
  for (const m of b.matches) {
    if (m.outcome !== 'disqualification' && m.outcome !== 'walkover') continue
    const kind = m.outcome === 'disqualification' ? 'disqualification' : 'walkover with no side named'
    if (m.outcome === 'disqualification') dqCount++; else woCount++
    const downstream = b.matches.filter((x) => x.round > m.round).length
    anomalies.push(
      `- **${b.competitionYear} S${b.seasonNumber}A** (Season ${season?.id ?? '—'}, ${season?.lifecycleState ?? '—'}) ` +
      `round ${m.round} match ${m.position + 1}: ${kind}`,
      `  - printed: \`${m.rawScore}\``,
      `  - between: \`${m.home?.normalizedHandle ?? '?'}\` and \`${m.away?.normalizedHandle ?? '?'}\``,
      `  - source: ${file.replace(/\\/g, '/')}${m.source ? `, line ${m.source.line}` : ''}`,
      `  - blocks: this match, and every later match depending on its winner (${downstream} downstream position(s) in the bracket)`,
    )
  }
}
anomalies.push('', `**${dqCount} disqualification(s), ${woCount} unattributed walkover(s).**`, '')

anomalies.push('## Standings that disagree with the match table', '')
anomalies.push('The archive prints both a standings table and a match table for each Season. For 2012 S1A they')
anomalies.push('do not agree, and neither is chosen: the reconstruction recomputes standings from the matches')
anomalies.push('it imported, and the archived standings claim is recorded here beside it.', '')

const s1a = await prisma.season.findFirst({
  where: { competitionYear: 2012, number: 1, division: 'A' },
  select: { id: true, archiveTemplateKey: true, lifecycleState: true },
})
if (s1a?.archiveTemplateKey) {
  const entry = manifestEntry(s1a.archiveTemplateKey)
  const handleBySource = new Map((entry?.participants ?? []).map((p) => [p.sourceId, p.rawHandle]))
  const standings = await prisma.seasonStanding.findMany({
    where: { seasonId: s1a.id }, select: { entrantId: true, wins: true },
  })
  const entrants = await prisma.seasonEntrant.findMany({
    where: { seasonId: s1a.id }, select: { id: true, cueverseId: true, playerId: true },
  })
  let listed = 0
  for (const st of entry?.standings ?? []) {
    if (typeof st.wins !== 'number') continue
    const handle = handleBySource.get(st.sourceId)
    if (!handle) continue
    const h = stripSourceNote(handle).toLowerCase()
    let e = entrants.find((x) => String(x.cueverseId).toLowerCase() === h)
    if (!e) {
      const alias = await prisma.playerAlias.findFirst({ where: { alias: { equals: stripSourceNote(handle), mode: 'insensitive' } }, select: { playerId: true } })
      if (alias) e = entrants.find((x) => x.playerId === alias.playerId)
    }
    const row = e ? standings.find((r) => r.entrantId === e!.id) : undefined
    if (!row || row.wins === st.wins) continue
    listed++
    anomalies.push(
      `- **2012 S1A** (Season ${s1a.id}, ${s1a.lifecycleState}) \`${handle}\``,
      `  - the archived standings table prints **${st.wins}** win(s)`,
      `  - the archived match table produces **${row.wins}** win(s) when replayed`,
      `  - difference: ${Math.abs(st.wins - row.wins)}`,
      '  - neither value was written over the other: the standing shown is recomputed from the imported',
      '    matches, and no result was altered to reconcile them',
    )
  }
  anomalies.push('', `**${listed} player(s) affected.** The Season contributes nothing to Rankings while incomplete.`, '')
}

anomalies.push('## Playoff fields that disagree with the bracket', '')
anomalies.push('Handled by the field-reconciliation report. A qualifier absent from a page proving the whole')
anomalies.push('entry field is deselected from the playoff field only; their Season entry and group results')
anomalies.push('are untouched, and nothing records them as losing or forfeiting.', '')

writeFileSync('reports/archive-source-anomalies.md', anomalies.join('\n') + '\n')

// ── Identity review ──────────────────────────────────────────────────────────────────────────────
const players = await prisma.player.findMany({
  select: { id: true, cueverseId: true, cueverseIdNormalized: true, primaryName: true, linkedUserId: true },
})
const merges = await prisma.playerMerge.findMany({ select: { mergedPlayerId: true, canonicalPlayerId: true } })
const mergedAway = new Set(merges.map((m) => m.mergedPlayerId))
const live = players.filter((p) => !mergedAway.has(p.id) && (p.cueverseIdNormalized ?? '').trim())

const fingerprint = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, '')
const groups = new Map<string, typeof live>()
for (const p of live) {
  const f = fingerprint(p.cueverseIdNormalized ?? '')
  if (!f) continue
  groups.set(f, [...(groups.get(f) ?? []), p])
}
const pairs = [...groups.values()].filter((g) => g.length > 1)

const seasonsOf = async (playerId: string) => {
  const rows = await prisma.seasonEntrant.findMany({
    where: { playerId },
    select: { season: { select: { competitionYear: true, number: true, division: true } } },
  })
  return [...new Set(rows.map((r) => `${r.season.competitionYear} S${r.season.number}${r.season.division ?? ''}`))].sort()
}

const rev: string[] = []
const csv: string[] = ['handle_a,player_a,account_a,seasons_a,handle_b,player_b,account_b,seasons_b,reason']
rev.push('# Identity review', '')
rev.push('Handles that collide once punctuation and casing are ignored, and are still separate accounts.')
rev.push('None has been merged. Two spellings looking alike is not evidence that two people are one —')
rev.push('the archive prints both spellings of most of these in their own right, and attaching one')
rev.push('person\'s record to another is far harder to undo than merging two accounts later.', '')
rev.push('| A | Seasons | B | Seasons | Why no merge |')
rev.push('|---|---|---|---|---|')

for (const g of pairs) {
  const withSeasons = await Promise.all(g.map(async (p) => ({ p, seasons: await seasonsOf(p.id) })))
  for (let i = 0; i < withSeasons.length; i++) {
    for (let j = i + 1; j < withSeasons.length; j++) {
      const a = withSeasons[i], b = withSeasons[j]
      const overlap = a.seasons.filter((s) => b.seasons.includes(s))
      const reason = overlap.length > 0
        ? `both appear in ${overlap.length} of the same Season(s) — likely two people`
        : 'no Season in common, but nothing proves they are one person'
      rev.push(`| \`${a.p.cueverseId}\` (${a.p.primaryName ?? '—'}) | ${a.seasons.length} | \`${b.p.cueverseId}\` (${b.p.primaryName ?? '—'}) | ${b.seasons.length} | ${reason} |`)
      csv.push([a.p.cueverseId, a.p.id, a.p.linkedUserId ?? '', a.seasons.length,
        b.p.cueverseId, b.p.id, b.p.linkedUserId ?? '', b.seasons.length, reason].join(','))
    }
  }
}

rev.push('', '## Bracket handles with no account in their Season', '')
rev.push('These occupy an entry position on an archived bracket but are not entrants in that Season, so')
rev.push('the position cannot be filled. Entering somebody is only possible while registration is open,')
rev.push('which closed long before these group stages were played.', '')
if (existsSync('reports/archive-playoff-import.json')) {
  const imp = JSON.parse(readFileSync('reports/archive-playoff-import.json', 'utf8')) as {
    label: string; seasonId: number; unseated?: { round: number; slot: number; side: string; handle: string; reason: string }[]
  }[]
  const seen = new Set<string>()
  for (const o of imp) {
    for (const u of o.unseated ?? []) {
      const key = `${o.seasonId}:${u.handle}`
      if (seen.has(key)) continue
      seen.add(key)
      const pl = await prisma.player.findFirst({ where: { cueverseIdNormalized: stripSourceNote(u.handle).toLowerCase() }, select: { id: true, linkedUserId: true } })
      rev.push(`- **${o.label}** (Season ${o.seasonId}) R${u.round}.${u.slot + 1} ${u.side}: \`${u.handle}\`` +
        (pl ? ` — Player \`${pl.id}\`, account ${pl.linkedUserId ?? '—'}, but not entered in this Season` : ' — no Player at all'))
    }
  }
}

rev.push('', '## Confirmed merges', '')
rev.push('| Old handle | Canonical | Player |', '|---|---|---|')
for (const m of merges) {
  const canon = players.find((p) => p.id === m.canonicalPlayerId)
  const gone = players.find((p) => p.id === m.mergedPlayerId)
  rev.push(`| \`${gone?.primaryName ?? m.mergedPlayerId}\` | \`${canon?.cueverseId ?? '—'}\` | \`${m.canonicalPlayerId}\` |`)
}

writeFileSync('reports/archive-identity-review.md', rev.join('\n') + '\n')
writeFileSync('reports/archive-identity-review.csv', csv.join('\n') + '\n')

console.log(JSON.stringify({
  disqualifications: dqCount,
  unattributedWalkovers: woCount,
  identityPairsForReview: pairs.length,
  confirmedMerges: merges.length,
  livePlayers: live.length,
}, null, 2))

await prisma.$disconnect()
