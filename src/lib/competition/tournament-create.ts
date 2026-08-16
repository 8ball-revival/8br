import 'server-only'
import type { ParticipantFormat, TournamentFormat } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { recordAudit, type Actor } from './audit'
import { hashJoinPassword } from './join-password'
import { normalizeFlair, type FlairInput } from './flair'
import { currentCompetitionYear, parseCompetitionYear } from './competition-year'

export type SeedingMethod = 'rating' | 'rank' | 'random' | 'registration'
export type TeamFormationInput = 'PICK' | 'RANDOM'
export type AccessModeInput = 'OPEN' | 'PASSWORD'

/** Formats the 8BR create flow supports end-to-end (creation → completion). */
// Season Championship (GROUPS_PLAYOFFS) is now its own competition type at /seasons — Tournaments
// only support these three formats. Creation rejects anything else (backend enforcement).
const SUPPORTED_FORMATS: TournamentFormat[] = ['SINGLE_ELIM', 'DOUBLE_ELIM', 'SWISS']
const LOUNGES = ['Social', "Beginner's Lounge", 'Intermediate Lounge', 'Advanced Lounge']
const SEEDING: SeedingMethod[] = ['rating', 'rank', 'random', 'registration']

export interface CreateTournamentConfig {
  name: string
  /** Competition Year (four-digit). Omitted = the current calendar year. */
  competitionYear?: number | string | null
  participantFormat: ParticipantFormat // INDIVIDUAL | TEAM
  teamSize?: number | null // members per team when TEAM (2–6)
  teamFormation?: TeamFormationInput // TEAM only: captains PICK rosters, or RANDOM draw at close
  tournamentFormat: TournamentFormat // SINGLE_ELIM | DOUBLE_ELIM | GROUPS_PLAYOFFS | SWISS
  raceLength: number // games required to win a match (any positive integer)
  lounge?: string // Social (default) | Beginner's | Intermediate | Advanced Lounge
  seedingMethod?: SeedingMethod // rating (default) | rank | random | registration
  accessMode?: AccessModeInput // OPEN (default) | PASSWORD
  joinPassword?: string | null // plaintext; required when PASSWORD; hashed here, never stored raw
  scheduleForLater?: boolean // false/absent = registration opens immediately ("start now")
  scheduledStartAt?: string | Date | null // when scheduleForLater
  swissRounds?: number | null // SWISS only (null = derive from field size at start)
  // Group Stage + Playoffs config (GROUPS_PLAYOFFS only).
  groupCount?: number | null
  qualifiersPerGroup?: number | null
  playoffSeeding?: string | null // "standing" | "random" | "manual"
  playoffDoubleElim?: boolean
  // Optional/legacy — not surfaced by the new UI.
  gameType?: string | null
  // Curated per-tournament flair (all validated/sanitized server-side; see flair.ts).
  flair?: FlairInput
}

function formatSummaryOf(fmt: TournamentFormat, swissRounds: number | null): string {
  switch (fmt) {
    case 'SINGLE_ELIM':
      return 'Single-elimination bracket'
    case 'DOUBLE_ELIM':
      return 'Double-elimination bracket'
    case 'GROUPS_PLAYOFFS':
      return 'Round-robin group stage into a playoff bracket'
    case 'SWISS':
      return swissRounds ? `Swiss system — ${swissRounds} rounds` : 'Swiss system'
    default:
      return fmt.replace(/_/g, ' ').toLowerCase()
  }
}

/**
 * Create a new 8BR tournament. The tournament number + immutable code are assigned atomically
 * inside a transaction so concurrent creates cannot collide. The tournament is created EMPTY
 * (no results invented) in DRAFT; the caller opens registration ("start now") or leaves it
 * scheduled. Rosters/entrants and the bracket are built afterward via the manage workspace.
 *
 * SECURITY: a private tournament's join password is hashed here (scrypt) and only the hash is
 * stored — the plaintext is never persisted, logged, or placed in a URL.
 */
export async function createTournament(
  actor: Actor,
  cfg: CreateTournamentConfig,
): Promise<{ ok: boolean; error?: string; id?: number; number?: number; code?: string; slug?: string; startNow?: boolean }> {
  const name = cfg.name.trim()
  if (!name) return { ok: false, error: 'A tournament name is required.' }
  if (name.length > 80) return { ok: false, error: 'Tournament name must be 80 characters or fewer.' }

  // Competition Year: required on the record, defaulted here when the caller omits it.
  const yearResult = parseCompetitionYear(
    cfg.competitionYear == null || cfg.competitionYear === '' ? currentCompetitionYear() : cfg.competitionYear,
  )
  if (!yearResult.ok) return { ok: false, error: yearResult.error }
  const competitionYear = yearResult.year

  if (!SUPPORTED_FORMATS.includes(cfg.tournamentFormat)) {
    return { ok: false, error: 'Unsupported tournament format.' }
  }

  const isTeam = cfg.participantFormat === 'TEAM'
  const teamSize = isTeam ? Math.trunc(cfg.teamSize ?? 0) : null
  if (isTeam && (!teamSize || teamSize < 2 || teamSize > 6)) {
    return { ok: false, error: 'Team tournaments need a team size between 2 and 6.' }
  }
  const teamFormation: TeamFormationInput = cfg.teamFormation === 'RANDOM' ? 'RANDOM' : 'PICK'

  if (!Number.isInteger(cfg.raceLength) || cfg.raceLength < 1 || cfg.raceLength > 99) {
    return { ok: false, error: 'Race length must be a whole number between 1 and 99.' }
  }

  const lounge = cfg.lounge && LOUNGES.includes(cfg.lounge) ? cfg.lounge : 'Social'
  const seedingMethod: SeedingMethod = cfg.seedingMethod && SEEDING.includes(cfg.seedingMethod) ? cfg.seedingMethod : 'rating'

  // Access mode + join password.
  const accessMode: AccessModeInput = cfg.accessMode === 'PASSWORD' ? 'PASSWORD' : 'OPEN'
  let joinPasswordHash: string | null = null
  if (accessMode === 'PASSWORD') {
    const pw = (cfg.joinPassword ?? '').trim()
    if (pw.length < 4) return { ok: false, error: 'A private tournament needs a join password of at least 4 characters.' }
    if (pw.length > 64) return { ok: false, error: 'The join password must be 64 characters or fewer.' }
    joinPasswordHash = hashJoinPassword(pw)
  }

  // Scheduling. Default (no schedule) = registration opens immediately.
  const later = !!cfg.scheduleForLater
  let scheduledStartAt: Date | null = null
  if (later) {
    const d = cfg.scheduledStartAt ? new Date(cfg.scheduledStartAt) : null
    if (!d || Number.isNaN(d.getTime())) return { ok: false, error: 'Enter a valid date and time for the scheduled start.' }
    scheduledStartAt = d
  }

  // Swiss rounds (optional at create; derived from field size at start if null).
  const isSwiss = cfg.tournamentFormat === 'SWISS'
  let swissRounds: number | null = null
  if (isSwiss && cfg.swissRounds != null) {
    const r = Math.trunc(cfg.swissRounds)
    if (r < 1 || r > 15) return { ok: false, error: 'Swiss rounds must be between 1 and 15.' }
    swissRounds = r
  }

  const isGroups = cfg.tournamentFormat === 'GROUPS_PLAYOFFS'
  if (isGroups) {
    const gc = Math.trunc(cfg.groupCount ?? 0)
    const qpg = Math.trunc(cfg.qualifiersPerGroup ?? 0)
    if (gc < 1 || gc > 32) return { ok: false, error: 'Number of groups must be between 1 and 32.' }
    if (qpg < 1 || qpg > 8) return { ok: false, error: 'Qualifiers per group must be between 1 and 8.' }
  }

  // Curated flair — validated + sanitized server-side (no raw HTML/JS, https-only banner, etc.).
  const flairRes = normalizeFlair(cfg.flair ?? {})
  if (!flairRes.ok) return { ok: false, error: flairRes.error }
  const flair = flairRes.value!

  try {
    const created = await prisma.$transaction(async (tx) => {
      const agg = await tx.tournament.aggregate({ _max: { number: true } })
      const nextNumber = (agg._max?.number ?? 0) + 1
      const code = `T${String(nextNumber).padStart(3, '0')}`
      const slug = `tournament-${nextNumber}`

      const clash = await tx.tournament.findFirst({ where: { OR: [{ number: nextNumber }, { code }, { slug }] }, select: { id: true } })
      if (clash) throw new Error('CUP_NUMBER_TAKEN')

      const tournament = await tx.tournament.create({
        data: {
          slug,
          name,
          competitionYear,
          code,
          number: nextNumber,
          gameType: cfg.gameType ?? null,
          lounge,
          participantFormat: cfg.participantFormat,
          teamSize,
          teamFormation,
          tournamentFormat: cfg.tournamentFormat,
          raceLength: cfg.raceLength,
          seedingMethod,
          accessMode,
          joinPasswordHash,
          swissRounds,
          scheduledStartAt,
          description: flair.description,
          badge: flair.badge,
          status: 'UPCOMING',
          // Always created in DRAFT; the action opens registration now (start-now) or leaves it
          // scheduled. registrationOpensAt records the intended open time when scheduled.
          lifecycleState: 'DRAFT',
          registrationStatus: 'NOT_OPEN',
          registrationOpensAt: scheduledStartAt,
          playoffsStatus: 'PENDING',
          ...(isGroups
            ? {
                groupCount: cfg.groupCount ?? null,
                qualifiersPerGroup: cfg.qualifiersPerGroup ?? 2,
                playoffSeeding: cfg.playoffSeeding ?? 'standing',
                playoffDoubleElim: cfg.playoffDoubleElim ?? false,
              }
            : {}),
          formatSummary: formatSummaryOf(cfg.tournamentFormat, swissRounds),
          eligibilitySummary:
            accessMode === 'PASSWORD'
              ? 'Private — a join password is required to register.'
              : 'Open to all registered 8 Ball Registry accounts.',
        },
      })
      await recordAudit(
        actor,
        {
          action: 'tournament.create',
          entity: 'Tournament',
          entityId: tournament.id,
          newValue: { number: nextNumber, code, name, participantFormat: cfg.participantFormat, tournamentFormat: cfg.tournamentFormat, accessMode, teamFormation, scheduled: later },
        },
        tx,
      )
      return { id: tournament.id, number: nextNumber, code, slug }
    })
    return { ok: true, ...created, startNow: !later }
  } catch (e) {
    if (e instanceof Error && e.message === 'CUP_NUMBER_TAKEN') {
      return { ok: false, error: 'Tournament number collision — please retry.' }
    }
    return { ok: false, error: e instanceof Error ? e.message : 'Could not create the tournament.' }
  }
}
