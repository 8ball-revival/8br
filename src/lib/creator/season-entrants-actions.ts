'use server'

import { revalidatePath } from 'next/cache'

import { prisma } from '@/lib/prisma'
import { creatorActor } from './access'
import { closeRegistration } from '@/lib/seasons/service'
import { transitionSeasonState } from '@/lib/seasons/lifecycle'
import { invalidateRankings } from '@/lib/stats/invalidate-rankings'
import { previewAutoEntrants } from '@/lib/archive/auto-entrants'

export interface CloseRegistrationPreflight {
  entrants: number
  /** Nothing to play. Not refused — some Seasons are built entrant-by-entrant afterwards. */
  noEntrants: boolean
  /**
   * Archived people this Season has that nobody has matched to an account yet.
   *
   * Null for a Season with no archive template: "0 unresolved" would read as a clean bill of health
   * for a check that was never run.
   */
  unresolvedArchive: number | null
}

/**
 * What Close Registration is about to do, before it does it.
 *
 * ── Why a preflight and not just a confirm ───────────────────────────────────────────────────────
 * Closing captures every entrant's rating as the seeding snapshot, and that snapshot is meant to be
 * immutable. Somebody who closes with three entrants because they had not finished adding them, or
 * with eleven archived players still unmatched, has to reopen and redo it. Showing the two numbers
 * that make it wrong costs one query and saves that.
 */
export async function closeRegistrationPreflightAction(seasonId: number): Promise<CloseRegistrationPreflight> {
  const gate = await creatorActor()
  if (!gate.ok) return { entrants: 0, noEntrants: true, unresolvedArchive: null }

  const [entrants, season] = await Promise.all([
    prisma.seasonEntrant.count({ where: { seasonId, status: 'APPROVED' } }),
    prisma.season.findUnique({ where: { id: seasonId }, select: { archiveTemplateKey: true } }),
  ])

  let unresolvedArchive: number | null = null
  if (season?.archiveTemplateKey) {
    const plan = await previewAutoEntrants(seasonId)
    // A blocked plan means the archive cannot answer, which is not the same as "none outstanding".
    unresolvedArchive = 'blocked' in plan
      ? null
      : plan.toAdd.length + plan.ambiguous.length + plan.missing.length
  }

  return { entrants, noEntrants: entrants === 0, unresolvedArchive }
}

/**
 * Close registration and move straight on to Group Setup.
 *
 * ── One act, not two ─────────────────────────────────────────────────────────────────────────────
 * `REGISTRATION_CLOSED` is a state the operator never wants to sit in: the entrants are settled and
 * the only thing left to do is build the groups. Leaving the record parked there meant a second
 * button on a second screen that every Season had to be walked through, and a Season that stalled
 * there looked to the public like registration had closed and nothing had happened since.
 *
 * So the two transitions happen together and the reader is put where the work is. The intermediate
 * state still EXISTS — `closeRegistration` is what captures the seeding snapshot, and the state
 * machine still refuses `REGISTRATION_OPEN → GROUP_SETUP` directly — it is simply not a place the
 * workflow stops.
 */
export async function closeRegistrationToGroupsAction(
  seasonId: number,
): Promise<{ ok?: boolean; error?: string; href?: string }> {
  const gate = await creatorActor()
  if (!gate.ok) return { error: gate.error }

  const closed = await closeRegistration(gate.actor, seasonId)
  if (!closed.ok) return { error: closed.error ?? 'Registration could not be closed.' }

  const moved = await transitionSeasonState(gate.actor, seasonId, 'GROUP_SETUP')
  if (!moved.ok) {
    // The snapshot was taken and registration IS closed; only the second step failed. Say so rather
    // than implying nothing happened, because retrying the first step will now be refused.
    return { error: `Registration is closed, but the Season could not move to Group Setup: ${moved.error}` }
  }

  revalidatePath(`/seasons/${seasonId}`)
  revalidatePath('/seasons')
  revalidatePath('/creator')
  revalidatePath('/creator/seasons')
  invalidateRankings()

  return { ok: true, href: `/creator/seasons/${seasonId}/groups` }
}
