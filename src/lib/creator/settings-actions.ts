'use server'

import { revalidatePath } from 'next/cache'

import { prisma } from '@/lib/prisma'
import { recordAudit } from '@/lib/competition/audit'
import { creatorActor } from './access'
import { invalidateRankings } from '@/lib/stats/invalidate-rankings'

/**
 * The two switches Settings can change at any stage.
 *
 * Both are metadata in the sense that neither touches a result — but `countsTowardRankings` changes
 * what the ladder is made of, so it clears the rankings aggregate. Visibility does not, which is why
 * they are not treated as one thing despite sitting next to each other.
 *
 * Authorised for itself. A server action never relies on the page having run a check.
 */
export async function updateRecordDisplayAction(
  kind: 'season' | 'tournament',
  id: number,
  patch: { publiclyVisible: boolean; countsTowardRankings: boolean },
): Promise<{ ok?: boolean; error?: string }> {
  const gate = await creatorActor()
  if (!gate.ok) return { error: gate.error }
  if (!Number.isInteger(id) || id <= 0) return { error: 'That is not a valid record.' }

  const data = {
    publiclyVisible: !!patch.publiclyVisible,
    countsTowardRankings: !!patch.countsTowardRankings,
  }

  const before = kind === 'season'
    ? await prisma.season.findUnique({ where: { id }, select: data })
    : await prisma.tournament.findUnique({ where: { id }, select: data })
  if (!before) return { error: 'That record no longer exists.' }

  if (kind === 'season') await prisma.season.update({ where: { id }, data })
  else await prisma.tournament.update({ where: { id }, data })

  await recordAudit(gate.actor, {
    action: `${kind}.settings.display`,
    entity: kind === 'season' ? 'Season' : 'Tournament',
    entityId: id,
    oldValue: before,
    newValue: data,
  }).catch(() => {})

  // Only the ladder-eligibility half can change what Rankings contains.
  if (before.countsTowardRankings !== data.countsTowardRankings) invalidateRankings()

  revalidatePath(`/creator/${kind}s/${id}`)
  revalidatePath(kind === 'season' ? `/seasons/${id}` : `/tournaments`)
  return { ok: true }
}
