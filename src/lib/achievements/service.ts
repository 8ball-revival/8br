import 'server-only'
import { unstable_cache, revalidateTag } from 'next/cache'

import type { AchievementDefinition } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { LADDER_EXPLORER_TAG } from '@/lib/stats/ladder-explorer'

import { evaluateAll } from './engine'
import type { Achievement } from './types'

/**
 * Reading achievements for the public site.
 *
 * ── One dataset, two pages ───────────────────────────────────────────────────────────────────────
 * The homepage strip and /achievements both read this. There is deliberately no separate homepage
 * list: two datasets would drift, and the homepage would eventually advertise an award the full
 * page did not have.
 *
 * ── Caching ──────────────────────────────────────────────────────────────────────────────────────
 * Tagged twice. The ladder tag means closing a Season refreshes the holders at the same moment it
 * refreshes the standings — an award derived from results must never outlive the results. The
 * definitions tag is invalidated by the admin actions, so an edit shows up immediately rather than
 * after the revalidation window.
 */

export const ACHIEVEMENT_DEFS_TAG = 'achievement-definitions'

/** Every definition, including archived ones. Admin only — the public readers filter. */
export async function listDefinitions(): Promise<AchievementDefinition[]> {
  return prisma.achievementDefinition.findMany({
    orderBy: [{ status: 'asc' }, { sortOrder: 'asc' }, { id: 'asc' }],
  })
}

export async function getDefinition(id: number): Promise<AchievementDefinition | null> {
  return prisma.achievementDefinition.findUnique({ where: { id } })
}

/**
 * The active achievements, resolved to cards.
 *
 * Archived definitions are excluded here rather than by the callers, so there is exactly one place
 * that decides what "public" means and no page can accidentally show a retired award.
 */
export const getPublicAchievements = unstable_cache(
  async (): Promise<Achievement[]> => {
    const defs = await prisma.achievementDefinition.findMany({
      where: { status: 'ACTIVE' },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    })
    return evaluateAll(defs)
  },
  ['public-achievements-v1'],
  { revalidate: 300, tags: [LADDER_EXPLORER_TAG, ACHIEVEMENT_DEFS_TAG] },
)

/**
 * Drop the cached cards. Called by every admin mutation.
 *
 * The 'max' profile matches how the rankings invalidation works here: a definition is either current
 * or it is wrong, and there is no useful middle setting. Wrapped, for the same reason that one is —
 * these can be reached from a script or a fixture where Next has no request store, and a cache hint
 * failing must never fail the write it is a hint about.
 */
export function invalidateAchievements(): void {
  try {
    revalidateTag(ACHIEVEMENT_DEFS_TAG, 'max')
  } catch {
    // Not inside a request. Nothing is cached in that context, so there is nothing to invalidate.
  }
}
