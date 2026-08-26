import 'server-only'
import { unstable_cache } from 'next/cache'

import type { CompetitionPlatform } from '@prisma/client'
import { getLadder } from '@/lib/stats/ladder'
import { LADDER_EXPLORER_TAG } from '@/lib/stats/ladder-explorer'

import { loadAchievementFacts } from './facts'
import { computeAchievements } from './compute'
import type { Achievement } from './types'

export type { Achievement, AchievementPlayer } from './types'

/**
 * The Achievements, ready to render.
 *
 * ── Ratings come from the ladder, not from a second calculation ──────────────────────────────────
 * Two of the eighteen are about rating: the best player with no title, and the lowest-rated
 * champion. Both take their numbers from `getLadder`, the same service the Rankings page and the
 * homepage snapshot read. Computing a rating here would mean a card could contradict the ladder it
 * is sitting six inches away from, and whichever one was wrong, nobody would be able to tell which.
 *
 * ── Caching ──────────────────────────────────────────────────────────────────────────────────────
 * Tagged with the ladder's own invalidation tag, so closing a Season refreshes the awards at the
 * same moment it refreshes the standings. Awards derived from results must never outlive the results
 * they are derived from.
 */
export const getAchievements = unstable_cache(
  async (platform: CompetitionPlatform = 'YAHOO'): Promise<Achievement[]> => {
    const [facts, ladder] = await Promise.all([
      loadAchievementFacts(platform),
      getLadder('all-time', new Date(), platform),
    ])
    const ratings = new Map(ladder.map((r) => [r.playerId, r.rating]))
    return computeAchievements(facts, ratings)
  },
  ['achievements-v1'],
  { revalidate: 300, tags: [LADDER_EXPLORER_TAG] },
)
