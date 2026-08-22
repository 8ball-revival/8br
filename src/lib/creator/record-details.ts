'use server'

import { revalidatePath } from 'next/cache'

import { prisma } from '@/lib/prisma'
import { creatorActor } from './access'
import { recordAudit } from '@/lib/competition/audit'
import { invalidateRankings } from '@/lib/stats/invalidate-rankings'

/**
 * Record Details: the fields that describe a competition rather than decide anything about it.
 *
 * ── Why these are safe at any point in the lifecycle ─────────────────────────────────────────────
 * A title, a Competition, a year, a description. None of them changes a result, a champion, a
 * rating or who qualified — they record facts about the competition that were always true and
 * simply were not captured correctly at the time. Correcting one should not require putting a
 * finished Season through the whole reopen-and-recomplete cycle, which is why Settings offers them
 * while everything structural stays behind the correction workflow.
 *
 * ── The Competition Year is not decoration ───────────────────────────────────────────────────────
 * It decides which era a record belongs to in every listing and in the Rankings' To-year bound, so a
 * Tournament created with the form's current-year default and never corrected shows up in the wrong
 * decade. It is metadata, but it is metadata the site reasons with, which is why the rankings cache
 * is cleared when it moves.
 */

export interface DetailsResult {
  ok?: boolean
  error?: string
}

const YEAR_MIN = 1900
const YEAR_MAX = 2100

export async function updateTournamentDetailsAction(
  tournamentId: number,
  patch: {
    name?: string
    competitionSeriesId?: number
    competitionYear?: number
    description?: string | null
  },
): Promise<DetailsResult> {
  const gate = await creatorActor()
  if (!gate.ok) return { error: gate.error }

  const before = await prisma.tournament.findUnique({
    where: { id: tournamentId },
    select: { id: true, name: true, number: true, competitionSeriesId: true, competitionYear: true, description: true },
  })
  if (!before) return { error: 'That Tournament no longer exists.' }

  const data: Record<string, unknown> = {}

  if (patch.name != null) {
    const name = patch.name.trim()
    if (!name) return { error: 'A Tournament needs a title.' }
    data.name = name
  }

  if (patch.competitionSeriesId != null) {
    // Validated against the real table: a dangling id should be a sentence, not a foreign-key page.
    const comp = await prisma.competitionSeries.findUnique({
      where: { id: patch.competitionSeriesId }, select: { id: true },
    })
    if (!comp) return { error: 'That Competition does not exist.' }
    data.competitionSeriesId = patch.competitionSeriesId
  }

  if (patch.competitionYear != null) {
    const y = Math.trunc(patch.competitionYear)
    if (!Number.isFinite(y) || y < YEAR_MIN || y > YEAR_MAX) {
      return { error: `Competition Year must be between ${YEAR_MIN} and ${YEAR_MAX}.` }
    }
    data.competitionYear = y
  }

  if (patch.description !== undefined) data.description = patch.description?.trim() || null

  if (Object.keys(data).length === 0) return { ok: true }

  await prisma.$transaction(async (tx) => {
    await tx.tournament.update({ where: { id: tournamentId }, data })
    await recordAudit(gate.actor, {
      action: 'tournament.details.update',
      entity: 'Tournament',
      entityId: tournamentId,
      oldValue: {
        name: before.name,
        competitionSeriesId: before.competitionSeriesId,
        competitionYear: before.competitionYear,
      },
      newValue: data,
    }, tx)
  })

  /*
   * The year moves which era a record belongs to, and the Rankings' era filter is cached.
   * Clearing it here means the correction is visible immediately rather than after the window lapses.
   */
  /*
   * The year moves which era a record belongs to, and the Rankings' era filter is cached.
   *
   * A TITLE does not. Renaming a Tournament changes a label and nothing a rating is computed from,
   * so it must not trigger a rebuild — the ledger is path-dependent and rebuilding it for a typo fix
   * would be both pointless and, if anything went wrong, expensive.
   */
  if (data.competitionYear !== undefined) {
    invalidateRankings()
    revalidatePath('/rankings')
  }

  /*
   * Everywhere the name is read.
   *
   * A Tournament's title appears in more places than the record itself: the public list and detail,
   * the Creator lists, the homepage's recent results, and the page metadata. Missing one leaves the
   * old title showing somewhere until that page's cache lapses, which reads as the rename having
   * failed.
   */
  revalidatePath('/')
  revalidatePath('/tournaments')
  revalidatePath(`/tournaments/${before.number ?? ''}`)
  revalidatePath('/creator')
  revalidatePath('/creator/tournaments')
  revalidatePath('/creator/tournaments/completed')
  revalidatePath(`/creator/tournaments/${tournamentId}/setup`)

  return { ok: true }
}
