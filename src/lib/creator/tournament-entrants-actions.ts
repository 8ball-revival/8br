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
import { transitionTournamentState, requireTournamentState, type TournamentState }
  from '@/lib/competition/tournament-lifecycle'
import type { EntrySlot } from '@/lib/seasons/playoff-topology'
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

/**
 * Exchange the occupants of two first-round positions.
 *
 * ── Why this composes `setTournamentBracketSlot` rather than writing two updates ────────────────
 * That service already performs the exchange atomically: setting a player into an occupied seat
 * moves whoever was there into the seat the player came from, in one transaction, and it re-checks
 * everything that matters — the bracket is still a draft, the match has no result, the round is the
 * first, the entrant belongs to this Tournament. Writing the pair here would be a second set of
 * those rules to keep in step.
 *
 * The board sends a swap because that is what dragging one card onto another means; the service is
 * told to seat A's occupant where B is, which is the same thing said from the other end.
 */
/** Placement is a DRAFT-only act; the same states `setTournamentBracketSlotAction` allows. */
const DRAFT_BRACKET_STATES: TournamentState[] = ['REGISTRATION_CLOSED', 'BRACKET_GENERATED']

export async function swapTournamentBracketSlotsAction(
  tournamentId: number,
  a: { matchId: number; side: 'home' | 'away' },
  b: { matchId: number; side: 'home' | 'away' },
): Promise<{ ok?: boolean; error?: string; message?: string; slots?: EntrySlot[] }> {
  const gate = await creatorActor()
  if (!gate.ok) return { error: gate.error }

  const ends = await prisma.playoffMatch.findMany({
    where: { id: { in: [a.matchId, b.matchId] }, tournamentId },
    select: { id: true, homeRegistrationId: true, awayRegistrationId: true },
  })
  const occupant = (ref: { matchId: number; side: 'home' | 'away' }) => {
    const m = ends.find((x) => x.id === ref.matchId)
    if (!m) return undefined
    return ref.side === 'home' ? m.homeRegistrationId : m.awayRegistrationId
  }
  const fromOccupant = occupant(a)
  const toOccupant = occupant(b)
  if (fromOccupant === undefined || toOccupant === undefined) {
    return { error: 'That bracket position does not belong to this Tournament.' }
  }

  /*
    Which end is asked to move matters when one of them is a bye.

    The service seats a player and moves whoever was displaced into the seat they came from — a
    swap. Handing it `null` is not a swap, it is a clear: seating nobody into B would empty B and
    leave A empty too, dropping a player off the board rather than exchanging two positions. So when
    the picked-up end is a bye, the exchange is asked for from the other end instead, which produces
    exactly the arrangement the person dragged.
  */
  const target = fromOccupant != null ? b : a
  const moving = fromOccupant ?? toOccupant
  if (moving == null) return { ok: true, message: 'Both positions are byes; nothing moved.' }

  const { setTournamentBracketSlot } = await import('@/lib/competition/service')
  const state = await requireTournamentState(tournamentId, DRAFT_BRACKET_STATES)
  if (!state.ok) return { error: state.error }
  const r = await setTournamentBracketSlot(gate.actor, tournamentId, target.matchId, target.side, moving)
  if (!r.ok) return { error: r.error }

  /*
    The board is returned rather than the page being rebuilt.

    Every swap used to go through `setTournamentBracketSlotAction`, which revalidates
    /tournaments, /hall-of-fame, /players, /records and /seasons. None of those show a bracket that
    has not been published yet, so the work had no reader - and a revalidate inside a Server Action
    makes the client refetch the whole Creator route as part of the reply, which is what turned
    eight drags into eight full page loads. The same guard runs here, so nothing is skipped except
    the cache work.

    What comes back is the arrangement the SERVER now holds, not an echo of what was asked for. It
    can differ: a swap involving a bye is performed from the other end (above), and the seat's seed
    stays with the seat. The board adopts this, so it cannot drift away from the record.
  */
  return { ok: true, message: 'Swapped.', slots: await tournamentEntrySlots(tournamentId) }
}

/** The entry positions as they now stand, in the shape the placement board draws. */
async function tournamentEntrySlots(tournamentId: number): Promise<EntrySlot[]> {
  const rows = await prisma.playoffMatch.findMany({
    where: { tournamentId },
    select: {
      id: true, round: true, slot: true, label: true, section: true,
      homeRegistrationId: true, awayRegistrationId: true,
      homeUsername: true, awayUsername: true,
      homeSeed: true, awaySeed: true, winnerRegistrationId: true,
    },
  })
  const { tournamentTopology } = await import('@/lib/tournaments/bracket-topology')
  return tournamentTopology(rows as never).entrySlots
}

/**
 * Lay out the draw WITHOUT publishing it.
 *
 * ── Why not `generateTournamentBracketAction` ──────────────────────────────────────────────────
 * That one builds and then publishes, moving the record to BRACKET_GENERATED — the older flow,
 * where a draw was reviewed after everybody could already see it. This screen exists so the draw
 * can be arranged first, which means it has to stay a draft: `setTournamentBracketSlot` refuses to
 * move anybody once a bracket is published, so publishing on generate would make the board
 * read-only the instant it appeared.
 *
 * The old action stays exactly as it is. It is still the right one for a random-draw Tournament,
 * which has no arranging step, and for the workspace's own Generate control.
 */
export async function draftTournamentBracketAction(
  tournamentId: number,
): Promise<{ ok?: boolean; error?: string; message?: string }> {
  const gate = await creatorActor()
  if (!gate.ok) return { error: gate.error }

  const t = await prisma.tournament.findUnique({
    where: { id: tournamentId },
    select: { tournamentFormat: true, participantFormat: true, teamFormation: true },
  })
  if (!t) return { error: 'Tournament not found.' }
  if (t.participantFormat === 'TEAM' && t.teamFormation === 'RANDOM') {
    return { error: 'Use “Generate Teams” for random-draw Tournaments.' }
  }

  const svc = await import('@/lib/competition/service')
  const regs = await prisma.registration.findMany({
    where: { tournamentId, status: { not: 'WITHDRAWN' } },
    select: { id: true },
    orderBy: [{ seed: 'asc' }, { id: 'asc' }],
  })
  const order = regs.map((r) => r.id)
  if (order.length < 2) return { error: 'Add at least two entrants before drawing the bracket.' }

  // A published bracket goes back to draft first; rebuilding under one is what the service refuses.
  const published = await prisma.playoffMatch.count({ where: { tournamentId, published: true } })
  if (published > 0) {
    const rd = await svc.returnPlayoffToDraft(gate.actor, tournamentId)
    if (!rd.ok) return { error: rd.error }
  }

  await svc.reseedEntrants(gate.actor, tournamentId, order)
  const built = await svc.rebuildManualPlayoff(gate.actor, tournamentId, order, {
    doubleElim: t.tournamentFormat === 'DOUBLE_ELIM',
  })
  if (!built.ok) return { error: built.error }

  revalidatePath(`/creator/tournaments/${tournamentId}/playoffs`)
  return { ok: true, message: 'Draw laid out. Arrange the first round, then start when it is right.' }
}

/**
 * Start: the draw becomes public and the first round becomes scoreable.
 *
 * Two steps, because the record distinguishes them — a published bracket is visible but not yet
 * being played, which is the state a scheduled Tournament sits in between the draw and the off.
 * Starting from this screen means both, since that is what the person pressing it is asking for.
 */
export async function startTournamentAction(
  tournamentId: number,
): Promise<{ ok?: boolean; error?: string; message?: string }> {
  const gate = await creatorActor()
  if (!gate.ok) return { error: gate.error }

  const svc = await import('@/lib/competition/service')
  const pub = await svc.publishPlayoff(gate.actor, tournamentId)
  if (!pub.ok) return { error: pub.error }

  /*
    Through BRACKET_GENERATED, not straight to live.

    The state machine refuses IN_PROGRESS from REGISTRATION_CLOSED — "generate the bracket before
    the tournament goes live" — because a published draw and a tournament being played are two
    different things, and the step between them is what a scheduled Tournament sits in. Publishing
    the rows is not the same as recording that the draw exists, so both are said.
  */
  const generated = await transitionTournamentState(gate.actor, tournamentId, 'BRACKET_GENERATED', {
    reason: 'Bracket published from setup',
  })
  if (!generated.ok) return { error: generated.error }

  const moved = await transitionTournamentState(gate.actor, tournamentId, 'IN_PROGRESS', {
    reason: 'Tournament started from bracket setup',
  })
  /*
    A refusal here leaves a PUBLISHED bracket that is not yet live, which is a real state and not a
    broken one — so it is reported rather than rolled back. Rolling it back would undo a draw that
    is now correct because the step after it was refused.
  */
  if (!moved.ok) {
    return { ok: true, message: `The bracket is published, but the Tournament could not be started: ${moved.error}` }
  }

  revalidatePath('/tournaments')
  revalidatePath(`/creator/tournaments/${tournamentId}/playoffs`)
  return { ok: true, message: 'The Tournament has started.' }
}
