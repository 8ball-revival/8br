'use server'

/**
 * Filling and settling a Tournament's entrant list.
 *
 * ── Why closing is its own step ─────────────────────────────────────────────────────────────────
 * Closing used to happen inside bracket generation, so "settle the list" and "draw the bracket"
 * were one irreversible click. They are different decisions: the list can be right long before
 * anybody has decided how the draw should look, and the draw is the thing that wants reviewing in
 * private before it is shown. Separating them is what lets the bracket be set up privately at all.
 *
 * Everything here is gated on `manage_competitions` by the actions it calls.
 */

import { revalidatePath } from 'next/cache'

import { prisma } from '@/lib/prisma'
import { creatorActor } from './access'
import { transitionTournamentState } from '@/lib/competition/tournament-lifecycle'
import { stageHref, type TournamentFormat } from './workflow'

export interface TournamentClosePreflight {
  entrants: number
  /** Nothing to play. Not refused — a Tournament can be built entrant-by-entrant afterwards. */
  noEntrants: boolean
  /** Below this, a bracket cannot be drawn at all. Reported so the dialog can say why. */
  tooFew: boolean
}

const MIN_ENTRANTS = 2

/** What closing this Tournament's registration would settle, counted before it is done. */
export async function tournamentClosePreflightAction(tournamentId: number): Promise<TournamentClosePreflight> {
  const gate = await creatorActor()
  if (!gate.ok) return { entrants: 0, noEntrants: true, tooFew: true }

  const entrants = await prisma.registration.count({
    where: { tournamentId, status: { notIn: ['WITHDRAWN', 'REJECTED'] } },
  })
  return { entrants, noEntrants: entrants === 0, tooFew: entrants < MIN_ENTRANTS }
}

/**
 * Settle the entrant list and move to whatever plays next.
 *
 * Where "next" is comes from the FORMAT, not from a fixed path: a Groups + Playoffs Tournament
 * draws groups, a Swiss one pairs a round, and an elimination one goes to the bracket. Reading it
 * from `stagesFor` means this agrees with the workflow bar rather than having its own opinion.
 */
export async function closeTournamentRegistrationAction(
  tournamentId: number,
): Promise<{ error?: string; href?: string }> {
  const gate = await creatorActor()
  if (!gate.ok) return { error: gate.error }

  const t = await prisma.tournament.findUnique({
    where: { id: tournamentId },
    select: { id: true, tournamentFormat: true },
  })
  if (!t) return { error: 'Tournament not found.' }

  const moved = await transitionTournamentState(gate.actor, tournamentId, 'REGISTRATION_CLOSED', {
    reason: 'Registration closed from the Entrants stage',
  })
  if (!moved.ok) return { error: moved.error }

  revalidatePath('/tournaments')
  revalidatePath('/creator/tournaments')

  const format = (t.tournamentFormat ?? 'SINGLE_ELIM') as TournamentFormat
  const next = format === 'GROUPS_PLAYOFFS' ? 'groups' : format === 'SWISS' ? 'swiss' : 'playoffs'
  return { href: stageHref('tournament', tournamentId, next) }
}
