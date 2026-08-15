import type { SeasonLifecycleState } from '@prisma/client'

/**
 * Client-safe Season constants and pure helpers. No `server-only`, no Prisma imports — so both
 * client components and the server modules can share them. The server-only lifecycle machine
 * (`lifecycle.ts`) re-exports these and adds the DB-bound transition functions.
 */

export type SeasonState = SeasonLifecycleState

export const SEASON_NEXT: Record<SeasonState, SeasonState[]> = {
  REGISTRATION_SCHEDULED: ['REGISTRATION_OPEN'],
  REGISTRATION_OPEN: ['REGISTRATION_CLOSED'],
  REGISTRATION_CLOSED: ['GROUP_SETUP', 'REGISTRATION_OPEN'],
  GROUP_SETUP: ['GROUP_STAGE_LIVE', 'REGISTRATION_OPEN'],
  GROUP_STAGE_LIVE: ['GROUPS_CLOSED'],
  GROUPS_CLOSED: ['PLAYOFF_SETUP', 'GROUP_STAGE_LIVE'],
  PLAYOFF_SETUP: ['PLAYOFFS_LIVE', 'GROUPS_CLOSED'],
  PLAYOFFS_LIVE: ['COMPLETED'],
  COMPLETED: [],
}

export const SEASON_STATE_LABEL: Record<SeasonState, string> = {
  REGISTRATION_SCHEDULED: 'Registration Scheduled',
  REGISTRATION_OPEN: 'Registration Open',
  REGISTRATION_CLOSED: 'Registration Closed',
  GROUP_SETUP: 'Group Setup',
  GROUP_STAGE_LIVE: 'Group Stage Live',
  GROUPS_CLOSED: 'Groups Closed',
  PLAYOFF_SETUP: 'Playoff Setup',
  PLAYOFFS_LIVE: 'Playoffs Live',
  COMPLETED: 'Completed',
}

export function canTransition(from: SeasonState, to: SeasonState): boolean {
  return SEASON_NEXT[from].includes(to)
}

/** Phases where members must not yet see groups/playoffs. */
export function isPreGroupPhase(state: SeasonState): boolean {
  return state === 'REGISTRATION_SCHEDULED' || state === 'REGISTRATION_OPEN' || state === 'REGISTRATION_CLOSED' || state === 'GROUP_SETUP'
}
