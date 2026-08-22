import 'server-only'

import type { Prisma } from '@prisma/client'

/**
 * The one rule for whether a competition contributes to the Rankings.
 *
 * ── Why it is a shared clause and not five checks ────────────────────────────────────────────────
 * "Does this record count" was answered in several places — the ledger rebuild, the archive
 * listings, the completion path — and each answered a slightly different question. That is how a
 * record ends up visible as completed while contributing nothing, or contributing while sitting
 * Under Correction. Both are the site telling a reader two things at once.
 *
 * Every caller now uses this clause, so there is one answer and changing it changes everything at
 * the same moment.
 *
 * ── The five conditions, and why each is there ───────────────────────────────────────────────────
 *   completed          — an unfinished competition has no final results to contribute.
 *   finalised          — `ladderAppliedAt` records that the completion transaction actually ran.
 *                        Completed-but-never-applied is a broken record, not a contributing one.
 *   not reopened       — a record Under Correction is being changed; its results are provisional
 *                        until it is recompleted, so it is withdrawn for the duration.
 *   not deleted        — soft-deleted records leave nothing behind.
 *   countsTowardRankings — the owner's explicit switch. An exhibition, a reconstruction whose
 *                        results should not count, or a record kept for history without affecting
 *                        anybody's rating.
 *
 * ── Withdrawal is by rebuild, never by subtraction ───────────────────────────────────────────────
 * Nothing here subtracts a record's contribution from a running total. The ledger is rebuilt from
 * whatever currently satisfies this rule, so withdrawing and restoring are the same operation run
 * with a different answer — which is why repeated correction cycles cannot drift.
 */

/** Seasons that contribute. Spread into a `where`. */
export const RANKING_ELIGIBLE_SEASON = {
  lifecycleState: 'COMPLETED',
  ladderAppliedAt: { not: null },
  reopenedAt: null,
  deletedAt: null,
  countsTowardRankings: true,
} satisfies Prisma.SeasonWhereInput

/** Tournaments that contribute. Spread into a `where`. */
export const RANKING_ELIGIBLE_TOURNAMENT = {
  lifecycleState: 'COMPLETED',
  ladderAppliedAt: { not: null },
  reopenedAt: null,
  countsTowardRankings: true,
} satisfies Prisma.TournamentWhereInput

/** Why a specific record is not contributing, in the words a Settings panel should use. */
export function rankingExclusionReason(record: {
  lifecycleState: string
  ladderAppliedAt: Date | null
  reopenedAt: Date | null
  deletedAt?: Date | null
  countsTowardRankings: boolean
}): string | null {
  if (record.deletedAt) return 'This record has been deleted.'
  /*
   * Under Correction is checked BEFORE the lifecycle.
   *
   * Reopening moves the record back to a playing state, so a lifecycle-first order answers "only a
   * completed competition contributes" — true, and useless: it describes a Season somebody has not
   * finished rather than one they are deliberately correcting. The most specific true reason is the
   * one worth showing.
   */
  if (record.reopenedAt) return 'This record is Under Correction, so its contribution is withdrawn until it is recompleted.'
  if (record.lifecycleState !== 'COMPLETED') return 'Only a completed competition contributes to the Rankings.'
  if (!record.ladderAppliedAt) return 'This record was never finalised into the Rankings.'
  if (!record.countsTowardRankings) return 'Counts Toward Rankings is switched off for this record.'
  return null
}
