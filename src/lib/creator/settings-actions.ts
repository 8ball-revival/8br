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

  /*
   * The columns to READ BACK, which is not the same object as the values to write.
   *
   * These two used to share one object: `data` was passed as the update payload and as the `select`.
   * That works only while at least one switch is on — Prisma reads `false` as "do not select this
   * column", and a select with every field false is an error, not an empty projection. So turning
   * the second switch off threw `PrismaClientValidationError` and the save failed, while turning one
   * off worked fine. Selecting by literal keys keeps the read independent of what is being written.
   */
  const SELECT = { publiclyVisible: true, countsTowardRankings: true } as const

  const before = kind === 'season'
    ? await prisma.season.findUnique({ where: { id }, select: SELECT })
    : await prisma.tournament.findUnique({ where: { id }, select: SELECT })
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

  /*
   * Eligibility changed, so the ledger is rebuilt — not merely un-cached.
   *
   * Clearing the cache was all this did, and it made the switch a lie: the help text promises that
   * turning it off "withdraws its contribution", but the ladder is built from the persisted
   * rating_ledger and nothing filters that by eligibility at read time. A Season switched off kept
   * every one of its rows and went on moving every rating; only an unrelated rebuild — closing some
   * other record — ever applied the decision, which made it look like the switch worked eventually.
   *
   * `rebuildRatingLedger` replays whatever is eligible RIGHT NOW, so withdrawing and restoring are
   * the same operation and repeating either one cannot drift. It is heavier than a checkbox looks,
   * which is the honest cost of the switch actually meaning something.
   */
  if (before.countsTowardRankings !== data.countsTowardRankings) {
    const { rebuildRatingLedger } = await import('@/lib/stats/ledger')
    await prisma.$transaction(async (tx) => rebuildRatingLedger(tx), { timeout: 180_000 })
    invalidateRankings()
  }

  revalidatePath(`/creator/${kind}s/${id}`)
  revalidatePath(kind === 'season' ? `/seasons/${id}` : `/tournaments`)
  return { ok: true }
}
