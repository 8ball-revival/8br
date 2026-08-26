/**
 * The authoritative target inventory, rebuilt from the database and the manifest.
 *
 * Not from the progress file. That file records what a previous run BELIEVED, and two runs plus a
 * reset and a contamination cleanup have happened since — so it is treated as a resumption hint and
 * reconciled against reality here, never as a source of truth.
 *
 * Usage: tsx scripts/archive-inventory.mts [--reconcile]
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'

import { prisma } from '../src/lib/prisma.ts'
import { assertLocalDatabase } from '../src/lib/db-guard.ts'
import { manifestEntry, type ManifestEntry } from '../src/lib/archive/manifest.ts'

assertLocalDatabase()

const RECONCILE = process.argv.includes('--reconcile')
const PROGRESS = 'reports/archive-import-progress.json'

export interface Row {
  seasonId: number
  label: string
  templateKey: string
  state: string
  blocked: string | null
  manifestParticipants: number
  entrants: number
  groups: number
  members: number
  matches: number
  standings: number
  playoff: number
  ledger: number
}

/** Why a Season can never be reconstructed, or null if it can. */
export function blockedReason(entry: ManifestEntry | null): string | null {
  if (!entry) return 'no manifest entry'
  if (entry.sharedGroupStageSourceKey) return 'undivided source: the group stage was shared between divisions'
  if (entry.groupAssignments === 'undivided-source') return 'undivided source: group assignments belong to a shared stage'
  return null
}

export async function inventory(): Promise<Row[]> {
  const seasons = await prisma.season.findMany({
    where: { archiveTemplateKey: { not: null } },
    select: {
      id: true, number: true, division: true, competitionYear: true,
      archiveTemplateKey: true, lifecycleState: true,
    },
    orderBy: [{ competitionYear: 'asc' }, { number: 'asc' }, { division: 'asc' }],
  })

  const rows: Row[] = []
  for (const s of seasons) {
    const entry = manifestEntry(s.archiveTemplateKey!)
    rows.push({
      seasonId: s.id,
      label: `${s.competitionYear} S${s.number}${s.division ?? ''}`,
      templateKey: s.archiveTemplateKey!,
      state: String(s.lifecycleState),
      blocked: blockedReason(entry),
      manifestParticipants: new Set((entry?.participants ?? []).map((p) => p.normalizedHandle.toLowerCase())).size,
      entrants: await prisma.seasonEntrant.count({ where: { seasonId: s.id, status: 'APPROVED' } }),
      groups: await prisma.seasonGroup.count({ where: { seasonId: s.id } }),
      members: await prisma.seasonGroupPlayer.count({ where: { group: { seasonId: s.id } } }),
      matches: await prisma.seasonMatch.count({ where: { seasonId: s.id } }),
      standings: await prisma.seasonStanding.count({ where: { seasonId: s.id } }),
      playoff: await prisma.seasonPlayoffMatch.count({ where: { seasonId: s.id } }),
      ledger: await prisma.ratingLedger.count({ where: { seasonId: s.id } }),
    })
  }
  return rows
}

if (import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, '/')}`) {
  const rows = await inventory()

  const completed = rows.filter((r) => r.state === 'COMPLETED')
  const unfinished = rows.filter((r) => r.state !== 'COMPLETED')
  const blocked = unfinished.filter((r) => r.blocked)
  const processable = unfinished.filter((r) => !r.blocked)

  const complete = processable.filter((r) => r.entrants === r.manifestParticipants && r.manifestParticipants > 0)
  const partial = processable.filter((r) => r.entrants > 0 && r.entrants < r.manifestParticipants)
  const none = processable.filter((r) => r.entrants === 0)
  const zeroChildren = processable.filter((r) => r.groups + r.members + r.matches + r.standings === 0)
  const unexpected = processable.filter((r) => r.groups + r.members + r.matches + r.standings + r.playoff + r.ledger > 0)
  const blockedWithChildren = blocked.filter((r) => r.entrants + r.groups + r.matches + r.standings + r.playoff > 0)

  console.log(JSON.stringify({
    archiveLinkedSeasons: rows.length,
    alreadyCompleted: completed.length,
    generatedUnfinishedShells: unfinished.length,
    processable: processable.length,
    blocked: blocked.length,
    entrants: { complete: complete.length, partial: partial.length, none: none.length },
    zeroGroupChildren: zeroChildren.length,
    withUnexpectedChildData: unexpected.length,
    blockedHoldingAnyChildData: blockedWithChildren.length,
    manifestParticipantsAcrossProcessable: processable.reduce((a, r) => a + r.manifestParticipants, 0),
    entrantsAcrossProcessable: processable.reduce((a, r) => a + r.entrants, 0),
  }, null, 2))

  if (unexpected.length > 0) {
    console.log('\nunexpected child data:')
    for (const r of unexpected) console.log(`  ${r.label} (${r.seasonId}) groups=${r.groups} matches=${r.matches} standings=${r.standings} playoff=${r.playoff} ledger=${r.ledger}`)
  }
  if (blockedWithChildren.length > 0) {
    console.log('\nblocked Seasons holding child data:')
    for (const r of blockedWithChildren) console.log(`  ${r.label} (${r.seasonId}) entrants=${r.entrants} groups=${r.groups}`)
  }
  console.log(`\nprocessable with partial entrants: ${partial.length}`)
  for (const r of partial.slice(0, 8)) console.log(`  ${r.label}: ${r.entrants}/${r.manifestParticipants}`)

  if (RECONCILE) {
    /*
     * The progress file is rewritten from what the database actually holds.
     *
     * Everything the reset and the cleanup removed is back to 'ready'; nothing carries a stale
     * 'groups' or 'partial' stage that no longer describes any row.
     */
    mkdirSync('reports', { recursive: true })
    const prior = existsSync(PROGRESS) ? JSON.parse(readFileSync(PROGRESS, 'utf8')) : {}
    const next: Record<string, unknown> = {}
    for (const r of rows) {
      if (r.state === 'COMPLETED') continue
      const before = prior[r.templateKey] ?? {}
      next[r.templateKey] = {
        seasonId: r.seasonId,
        label: r.label,
        stage: r.blocked ? 'blocked' : 'ready',
        blockedReason: r.blocked,
        entrantsAdded: r.entrants,
        groupsPlaced: r.groups,
        resultsImported: r.matches,
        error: null,
        notes: Array.isArray(before.notes) ? before.notes.slice(-3) : [],
      }
    }
    writeFileSync(PROGRESS, JSON.stringify(next, null, 2))
    console.log(`\nprogress file reconciled to database state: ${Object.keys(next).length} unfinished Season(s)`)
  }

  await prisma.$disconnect()
}
