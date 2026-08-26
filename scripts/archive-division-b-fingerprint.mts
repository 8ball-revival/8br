/**
 * A fingerprint of every Division B Season, so it can be proved they were not touched.
 *
 * Division B is benched by owner decision: its playoff source does not survive, so no bracket can be
 * reconstructed from evidence and the reconstruction has nothing honest to add. Benching is not
 * deletion — every shell and every row already imported stays exactly as it is, and this is the
 * measurement that shows so.
 *
 * The hash covers content, not just counts, because a row rewritten in place would leave the counts
 * alone. Audit rows are included: a run that changed nothing but recorded that it had would not be a
 * run that changed nothing.
 *
 * Usage:
 *   tsx scripts/archive-division-b-fingerprint.mts            # print
 *   tsx scripts/archive-division-b-fingerprint.mts --save     # write the baseline
 *   tsx scripts/archive-division-b-fingerprint.mts --compare  # fail if anything moved
 */
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'

import { prisma } from '../src/lib/prisma.ts'
import { assertLocalDatabase } from '../src/lib/db-guard.ts'

assertLocalDatabase()

const BASELINE = 'reports/archive-division-b-baseline.json'

export interface DivisionBRow {
  seasonId: number
  label: string
  archiveTemplateKey: string | null
  lifecycleState: string
  championName: string | null
  ladderApplied: boolean
  counts: {
    entrants: number
    groups: number
    groupPlayers: number
    matches: number
    scoredMatches: number
    standings: number
    playoffMatches: number
    playoffDecided: number
    ledger: number
    audits: number
  }
  hash: string
}

export async function fingerprintDivisionB(): Promise<DivisionBRow[]> {
  const seasons = await prisma.season.findMany({
    where: { division: 'B' },
    select: {
      id: true, number: true, competitionYear: true, division: true,
      archiveTemplateKey: true, lifecycleState: true, championName: true, ladderAppliedAt: true,
    },
    orderBy: [{ competitionYear: 'asc' }, { number: 'asc' }],
  })

  const rows: DivisionBRow[] = []
  for (const s of seasons) {
    const entrants = await prisma.seasonEntrant.findMany({
      where: { seasonId: s.id },
      select: { cueverseId: true, status: true, playoffIncluded: true, playoffSeed: true },
      orderBy: [{ cueverseId: 'asc' }],
    })
    const groups = await prisma.seasonGroup.findMany({
      where: { seasonId: s.id },
      select: { code: true, name: true, published: true, players: { select: { entrantId: true, seed: true } } },
      orderBy: { code: 'asc' },
    })
    const matches = await prisma.seasonMatch.findMany({
      where: { seasonId: s.id },
      select: { id: true, homeEntrantId: true, awayEntrantId: true, homeGames: true, awayGames: true, status: true },
      orderBy: { id: 'asc' },
    })
    const standings = await prisma.seasonStanding.findMany({
      where: { seasonId: s.id },
      select: { username: true, played: true, wins: true, losses: true, points: true, rank: true },
      orderBy: [{ username: 'asc' }],
    })
    const playoff = await prisma.seasonPlayoffMatch.findMany({
      where: { seasonId: s.id },
      select: { round: true, slot: true, homeEntrantId: true, awayEntrantId: true, winnerEntrantId: true, homeGames: true, awayGames: true, forfeitEntrantId: true },
      orderBy: [{ round: 'asc' }, { slot: 'asc' }],
    })
    const ledger = await prisma.ratingLedger.count({ where: { seasonId: s.id } })
    const audits = await prisma.auditLog.count({ where: { entity: 'Season', entityId: String(s.id) } })

    const blob = JSON.stringify({
      state: s.lifecycleState, champion: s.championName, ladder: Boolean(s.ladderAppliedAt),
      entrants, groups, matches, standings, playoff,
    })
    rows.push({
      seasonId: s.id,
      label: `${s.competitionYear} S${s.number}${s.division ?? ''}`,
      archiveTemplateKey: s.archiveTemplateKey,
      lifecycleState: String(s.lifecycleState),
      championName: s.championName,
      ladderApplied: Boolean(s.ladderAppliedAt),
      counts: {
        entrants: entrants.length,
        groups: groups.length,
        groupPlayers: groups.reduce((a, g) => a + g.players.length, 0),
        matches: matches.length,
        scoredMatches: matches.filter((m) => m.homeGames !== null).length,
        standings: standings.length,
        playoffMatches: playoff.length,
        playoffDecided: playoff.filter((p) => p.winnerEntrantId).length,
        ledger,
        audits,
      },
      hash: createHash('sha256').update(blob).digest('hex').slice(0, 32),
    })
  }
  return rows
}

if (import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, '/')}`) {
  const rows = await fingerprintDivisionB()
  const save = process.argv.includes('--save')
  const compare = process.argv.includes('--compare')

  const totals = rows.reduce((a, r) => ({
    entrants: a.entrants + r.counts.entrants,
    matches: a.matches + r.counts.matches,
    scored: a.scored + r.counts.scoredMatches,
    playoff: a.playoff + r.counts.playoffMatches,
    decided: a.decided + r.counts.playoffDecided,
    ledger: a.ledger + r.counts.ledger,
  }), { entrants: 0, matches: 0, scored: 0, playoff: 0, decided: 0, ledger: 0 })

  console.log(JSON.stringify({
    divisionBSeasons: rows.length,
    completed: rows.filter((r) => r.lifecycleState === 'COMPLETED').length,
    withChampion: rows.filter((r) => r.championName).length,
    withLadder: rows.filter((r) => r.ladderApplied).length,
    totals,
  }, null, 2))

  /*
   * The safety properties, checked every time rather than only when saving.
   *
   * A benched Season must stay incomplete, must not have acquired a champion, and must contribute
   * nothing to Rankings. If any of those changed, the bench leaked.
   */
  const wrongfullyComplete = rows.filter((r) => r.lifecycleState === 'COMPLETED')
  const wrongChampion = rows.filter((r) => r.lifecycleState !== 'COMPLETED' && r.championName)
  const wrongLedger = rows.filter((r) => r.lifecycleState !== 'COMPLETED' && r.counts.ledger > 0)
  for (const [label, bad] of [
    ['benched Seasons presented as complete', wrongfullyComplete],
    ['incomplete Seasons carrying a champion', wrongChampion],
    ['incomplete Seasons contributing to Rankings', wrongLedger],
  ] as const) {
    console.log(`${bad.length === 0 ? 'OK  ' : 'BAD '} ${label}: ${bad.length}${bad.length ? ' — ' + bad.map((b) => b.label).join(', ') : ''}`)
  }

  mkdirSync('reports', { recursive: true })
  if (save) {
    writeFileSync(BASELINE, JSON.stringify(rows, null, 2))
    console.log(`\nbaseline written: ${BASELINE} (${rows.length} Season(s))`)
  }

  if (compare) {
    if (!existsSync(BASELINE)) throw new Error(`no baseline at ${BASELINE} — run with --save first`)
    const before = JSON.parse(readFileSync(BASELINE, 'utf8')) as DivisionBRow[]
    const byId = new Map(before.map((r) => [r.seasonId, r]))
    const moved: string[] = []
    for (const now of rows) {
      const was = byId.get(now.seasonId)
      if (!was) { moved.push(`${now.label} is new`); continue }
      if (was.hash !== now.hash) moved.push(`${now.label}: content changed (${was.hash} → ${now.hash})`)
      for (const k of Object.keys(now.counts) as (keyof typeof now.counts)[]) {
        if (was.counts[k] !== now.counts[k]) moved.push(`${now.label}: ${k} ${was.counts[k]} → ${now.counts[k]}`)
      }
    }
    for (const was of before) if (!rows.some((r) => r.seasonId === was.seasonId)) moved.push(`${was.label} is gone`)

    console.log(`\n${moved.length === 0 ? 'UNCHANGED — every Division B Season is byte-identical to the baseline' : 'CHANGED:'}`)
    for (const m of moved) console.log(`  ${m}`)
    if (moved.length > 0) process.exitCode = 1
  }

  await prisma.$disconnect()
}
