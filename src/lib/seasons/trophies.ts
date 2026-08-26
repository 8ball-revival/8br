import 'server-only'
import type { CompetitionPlatform } from '@prisma/client'
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
/**
 * Season Championships per player.
 *
 * Scoped to one platform when asked, because the ladder is per platform and a title won on the
 * other one is not part of this standing: counting them would place a Yahoo champion above a
 * CueVerse player on a CueVerse ladder for something that happened in a different competition.
 * Unscoped still means every platform, which is what a profile wants.
 */
export async function computeSeasonTrophies(platform?: CompetitionPlatform): Promise<Map<string, SeasonTrophyEntry[]>> {
  const seasons = await prisma.season.findMany({
    where: { lifecycleState: 'COMPLETED', championPlayerId: { not: null }, ...(platform ? { platform } : {}) },
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
