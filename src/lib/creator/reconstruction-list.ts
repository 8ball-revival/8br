import 'server-only'

import { prisma } from '@/lib/prisma'
import { templateStatus } from '@/lib/archive/manifest'
import type { ReconstructionRow } from './reconstruction-filters'

/**
 * The historical reconstruction shells, with their real progress.
 *
 * ── Progress is counted, never inferred ──────────────────────────────────────────────────────────
 * Entrants, group placements and entered results come from the database; the participant, group and
 * result totals they are measured against come from the manifest. Keeping the two apart is the
 * point: "0 / 42 entrants added" is only meaningful because the 0 is what exists and the 42 is what
 * the archive says should.
 *
 * One pass over the shells with grouped counts, rather than a query per row — with 88 of them, the
 * per-row version is nearly three hundred round trips to draw one page.
 */
export async function listReconstructions(): Promise<ReconstructionRow[]> {
  const seasons = await prisma.season.findMany({
    where: { archiveTemplateKey: { not: null } },
    select: {
      id: true, number: true, competitionYear: true, division: true, lifecycleState: true,
      archiveTemplateKey: true,
      competitionSeries: { select: { shortName: true, name: true } },
    },
    orderBy: [{ competitionYear: 'asc' }, { number: 'asc' }, { division: 'asc' }],
  })
  if (seasons.length === 0) return []

  const ids = seasons.map((s) => s.id)
  const [entrants, placements, results] = await Promise.all([
    prisma.seasonEntrant.groupBy({
      by: ['seasonId'], where: { seasonId: { in: ids }, status: { not: 'WITHDRAWN' } }, _count: { _all: true },
    }),
    prisma.seasonGroupPlayer.groupBy({
      by: ['groupId'], where: { group: { seasonId: { in: ids } } }, _count: { _all: true },
    }),
    prisma.seasonMatch.groupBy({
      by: ['seasonId'], where: { seasonId: { in: ids }, status: 'COMPLETED' }, _count: { _all: true },
    }),
  ])

  // Group placements are counted per group, so they need mapping back to their Season.
  const groupOwners = await prisma.seasonGroup.findMany({
    where: { seasonId: { in: ids } }, select: { id: true, seasonId: true },
  })
  const seasonOfGroup = new Map(groupOwners.map((g) => [g.id, g.seasonId]))
  const placedBySeason = new Map<number, number>()
  for (const p of placements) {
    const seasonId = seasonOfGroup.get(p.groupId)
    if (seasonId == null) continue
    placedBySeason.set(seasonId, (placedBySeason.get(seasonId) ?? 0) + p._count._all)
  }

  const entrantsBySeason = new Map(entrants.map((e) => [e.seasonId, e._count._all]))
  const resultsBySeason = new Map(results.map((r) => [r.seasonId, r._count._all]))

  return seasons.map((s) => {
    const status = templateStatus(s.archiveTemplateKey!)
    const comp = s.competitionSeries?.shortName ?? s.competitionSeries?.name ?? ''
    return {
      id: s.id,
      title: `${comp} Season ${s.number} · ${s.competitionYear}${s.division ? ` · Division ${s.division}` : ''}`,
      year: s.competitionYear,
      number: s.number,
      division: s.division,
      lifecycle: s.lifecycleState,
      href: `/creator/seasons/${s.id}`,
      entrants: entrantsBySeason.get(s.id) ?? 0,
      groupsAssigned: placedBySeason.get(s.id) ?? 0,
      resultsEntered: resultsBySeason.get(s.id) ?? 0,
      archiveParticipants: status.participantCount,
      archiveGroups: status.groupCount,
      archiveResults: status.exactMatchCount,
      archiveAssignments: status.groupAssignments,
      archiveExact: status.exactResults,
      sharedStage: status.sharedStage,
      sharedStageMessage: status.sharedStageMessage,
      unresolvedCount: status.unresolvedCount,
      ambiguousCount: status.ambiguousCount,
      standingsOnly: status.standingsOnly,
    }
  })
}
