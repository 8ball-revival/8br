import 'server-only'
import { prisma } from '@/lib/prisma'

/** A Season Championship — the glowing-diamond achievement, kept SEPARATE from ordinary tournament
 *  trophies and team-event awards. Derived on the fly from completed Seasons (no persisted table). */
export interface SeasonTrophyEntry {
  seasonNumber: number
  title: string // "<Competition> Season N"
  date: string | null
  slug: string // /seasons/N
}

/** playerId → the Seasons they have won. */
export async function computeSeasonTrophies(): Promise<Map<string, SeasonTrophyEntry[]>> {
  const seasons = await prisma.season.findMany({
    where: { lifecycleState: 'COMPLETED', championPlayerId: { not: null } },
    select: { id: true, number: true, competitionYear: true, championPlayerId: true, completedAt: true, competitionSeries: { select: { name: true } } },
  })
  const map = new Map<string, SeasonTrophyEntry[]>()
  for (const s of seasons) {
    const pid = s.championPlayerId!
    const list = map.get(pid) ?? []
    // Title carries the Competition and year because a bare number no longer identifies a Season.
    list.push({
      seasonNumber: s.number,
      title: `${s.competitionSeries?.name ?? 'Season'} Season ${s.number} · ${s.competitionYear}`,
      date: s.completedAt?.toISOString() ?? null,
      slug: `/seasons/${s.id}`,
    })
    map.set(pid, list)
  }
  return map
}
