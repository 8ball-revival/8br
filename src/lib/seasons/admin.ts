import 'server-only'
import { prisma } from '@/lib/prisma'
import { recordAudit, type Actor } from '@/lib/competition/audit'
import { LEDGER_TX_OPTIONS } from '@/lib/stats/ledger'

/**
 * The exact title a Season is known by, computed in ONE place.
 *
 * The Creator panel shows this, and permanent deletion asks the operator to type it back. Those two
 * strings have to be produced by the same expression or the confirmation is unpassable: the panel
 * would display "8BR Retro Season 1", the check would compare against something else, and the button
 * would stay disabled with no way to discover why.
 */
export function seasonDisplayTitle(row: {
  subtitle: string | null
  number: number | null
  competitionSeries?: { name: string } | null
}): string {
  const named = row.subtitle?.trim()
  if (named) return named
  return `${row.competitionSeries?.name ?? 'Season'} Season ${row.number ?? ''}`.trim()
}

export interface SeasonDeletionPlan {
  title: string
  lifecycleState: string
  /** Named so the operator can see whose title is about to be withdrawn. */
  champion: string | null
  counts: {
    entrants: number
    groups: number
    groupPlayers: number
    groupMatches: number
    playoffMatches: number
    standings: number
    ratingLedgerRows: number
  }
}

/**
 * What deleting this Season would actually remove.
 *
 * Counted live rather than described in prose, because "and all its results" is not something an
 * operator can check against their intention. Seeing "2,676 standings rows" beside a Season they
 * believe is an empty draft is how a wrong record gets caught before the button, not after.
 *
 * Read-only, and safe to call on any Season.
 */
export async function planSeasonDeletion(seasonId: number): Promise<SeasonDeletionPlan | null> {
  const row = await prisma.season.findUnique({
    where: { id: seasonId },
    select: {
      subtitle: true, number: true, lifecycleState: true, championName: true,
      competitionSeries: { select: { name: true } },
    },
  })
  if (!row) return null

  const [entrants, groups, groupPlayers, groupMatches, playoffMatches, standings, ratingLedgerRows] = await Promise.all([
    prisma.seasonEntrant.count({ where: { seasonId } }),
    prisma.seasonGroup.count({ where: { seasonId } }),
    prisma.seasonGroupPlayer.count({ where: { group: { seasonId } } }),
    prisma.seasonMatch.count({ where: { seasonId } }),
    prisma.seasonPlayoffMatch.count({ where: { seasonId } }),
    prisma.seasonStanding.count({ where: { seasonId } }),
    prisma.ratingLedger.count({ where: { seasonId } }),
  ])

  return {
    title: seasonDisplayTitle(row),
    lifecycleState: row.lifecycleState,
    champion: row.lifecycleState === 'COMPLETED' ? row.championName : null,
    counts: { entrants, groups, groupPlayers, groupMatches, playoffMatches, standings, ratingLedgerRows },
  }
}

/**
 * Permanently delete a Season. Before Close: any Admin (so a mistakenly-created Season can be remade).
 * After Close: Head Admin only — and the delete transactionally REVERSES the ranking contribution and
 * removes the Season Championship award. Cascade deletes remove all season_* rows and the Season's
 * rating_ledger rows; a completed-Season delete then rebuilds the ledger so downstream ratings unwind.
 * The Season Championship award is derived from completed Seasons, so it disappears automatically.
 */
export async function deleteSeason(actor: Actor, seasonId: number, isHeadAdmin: boolean): Promise<{ ok: boolean; error?: string }> {
  const s = await prisma.season.findUnique({ where: { id: seasonId }, select: { number: true, competitionYear: true, lifecycleState: true } })
  if (!s) return { ok: false, error: 'Season not found.' }
  const wasCompleted = s.lifecycleState === 'COMPLETED'
  if (wasCompleted && !isHeadAdmin) return { ok: false, error: 'Only the Head Admin may permanently delete a completed Season.' }

  await prisma.$transaction(async (tx) => {
    // Audit BEFORE deletion (the audit log is a separate, immutable table that survives the delete).
    await recordAudit(actor, { action: 'season.delete', entity: 'Season', entityId: seasonId, oldValue: { number: s.number, competitionYear: s.competitionYear, wasCompleted } }, tx)
    await tx.season.delete({ where: { id: seasonId } }) // cascades season_* + rating_ledger(seasonId)
    if (wasCompleted) {
      // Reverse this Season's ranking effect: replay the ledger without it.
      const { rebuildRatingLedger } = await import('@/lib/stats/ledger')
      await rebuildRatingLedger(tx)
    }
  }, LEDGER_TX_OPTIONS)
  return { ok: true }
}
