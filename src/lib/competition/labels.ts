/** Display labels + helpers for competition enums, shared by admin and public. */
import type {
  TournamentRunState,
  RegistrationState,
  StageState,
  RegistrationStatus,
  LiveMatchStatus,
  VerificationState,
} from '@prisma/client'

export const SEASON_STATE_LABEL: Record<TournamentRunState, string> = {
  UPCOMING: 'Upcoming',
  ACTIVE: 'Active',
  COMPLETED: 'Completed',
}

export const REGISTRATION_STATE_LABEL: Record<RegistrationState, string> = {
  NOT_OPEN: 'Registration not yet open',
  OPEN: 'Registration open',
  CLOSED: 'Registration closed',
}

export const STAGE_STATE_LABEL: Record<StageState, string> = {
  PENDING: 'Pending',
  PUBLISHED: 'Published',
  COMPLETED: 'Completed',
}

export const REGISTRATION_STATUS_LABEL: Record<RegistrationStatus, string> = {
  PENDING: 'Pending',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  WITHDRAWN: 'Withdrawn',
}

export const MATCH_STATUS_LABEL: Record<LiveMatchStatus, string> = {
  SCHEDULED: 'Scheduled',
  COMPLETED: 'Completed',
  FORFEIT: 'Forfeit',
  NO_SHOW: 'No-show',
  DISPUTED: 'Disputed',
}

export const VERIFICATION_LABEL: Record<VerificationState, string> = {
  UNVERIFIED: 'Unverified',
  VERIFIED: 'Verified',
}

export function isRegistrationOpenState(s: RegistrationState): boolean {
  return s === 'OPEN'
}
