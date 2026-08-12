import 'server-only'
import type { ParticipantFormat, TournamentFormat } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { recordAudit, type Actor } from './audit'

export type CamRequirement = 'REQUIRED' | 'OPTIONAL' | 'NO_CAM'

export interface CreateCupConfig {
  name: string
  gameType: string // "8-Ball" | "9-Ball"
  participantFormat: ParticipantFormat // INDIVIDUAL | TEAM
  teamSize?: number | null // members per team when TEAM (2 for 2v2)
  tournamentFormat: TournamentFormat
  raceLength: number // games required to win a match (any positive integer)
  camRequirement?: CamRequirement
  fieldSize?: number | null // informational target field/bracket size
  initialState?: 'DRAFT' | 'UPCOMING'
  // Group Stage + Playoffs config (only used when tournamentFormat = GROUPS_PLAYOFFS).
  groupCount?: number | null // number of round-robin groups
  qualifiersPerGroup?: number | null // how many advance from each group
  playoffSeeding?: string | null // "standing" | "random" | "manual"
  playoffDoubleElim?: boolean // playoff bracket is double-elimination
}

function camLine(cam: CamRequirement | undefined): string {
  switch (cam) {
    case 'REQUIRED':
      return 'Camera required for all matches.'
    case 'NO_CAM':
      return 'No camera required.'
    case 'OPTIONAL':
    default:
      return 'Camera optional.'
  }
}

function formatBadge(cfg: CreateCupConfig): string {
  if (cfg.participantFormat === 'TEAM') return cfg.teamSize === 2 ? '2v2' : `${cfg.teamSize ?? '?'}v${cfg.teamSize ?? '?'}`
  return '1v1'
}

/**
 * Create a new LIVE cup. Tournament number + competition code are assigned atomically inside a
 * transaction (serializable-safe: derived from the current max under a single tx) so two
 * simultaneous creates cannot collide. Returns the new competition id + number + code.
 *
 * The cup is a `Tournament` row with competitionType=CUP, rendered/edited through the same
 * unified competition machinery. It is created EMPTY (no results invented); entrants/teams
 * and the bracket are built afterward through the Cup workspace.
 */
export async function createCup(
  actor: Actor,
  cfg: CreateCupConfig,
): Promise<{ ok: boolean; error?: string; id?: number; number?: number; code?: string; slug?: string }> {
  const name = cfg.name.trim()
  if (!name) return { ok: false, error: 'A cup name is required.' }
  if (cfg.participantFormat === 'TEAM' && (!cfg.teamSize || cfg.teamSize < 2)) {
    return { ok: false, error: 'Team cups need a team size of at least 2.' }
  }
  if (!Number.isInteger(cfg.raceLength) || cfg.raceLength < 1) {
    return { ok: false, error: 'Race length must be a positive whole number.' }
  }

  try {
    const created = await prisma.$transaction(async (tx) => {
      // Atomic next-number/code assignment: read the current max tournament number under the tx.
      const agg = await tx.tournament.aggregate({ _max: { number: true } })
      const nextNumber = (agg._max?.number ?? 0) + 1
      const code = `T${String(nextNumber).padStart(3, '0')}`
      const slug = `tournament-${nextNumber}`

      // Guard against a slug/code/number that somehow already exists (unique columns will
      // also throw, but this yields a clean error).
      const clash = await tx.tournament.findFirst({
        where: { OR: [{ number: nextNumber }, { code: code }, { slug }] },
        select: { id: true },
      })
      if (clash) throw new Error('CUP_NUMBER_TAKEN')

      const isGroups = cfg.tournamentFormat === 'GROUPS_PLAYOFFS'
      const tournament = await tx.tournament.create({
        data: {
          slug,
          name,
          code: code,
          number: nextNumber,
          gameType: cfg.gameType,
          participantFormat: cfg.participantFormat,
          teamSize: cfg.participantFormat === 'TEAM' ? cfg.teamSize ?? null : null,
          tournamentFormat: cfg.tournamentFormat,
          raceLength: cfg.raceLength,
          status: 'UPCOMING',
          // Lifecycle: a new tournament starts in DRAFT — nothing publicly joinable. An Admin
          // opens registration explicitly (see tournament-lifecycle); registrationStatus stays in sync.
          lifecycleState: 'DRAFT',
          registrationStatus: 'NOT_OPEN',
          playoffsStatus: 'PENDING',
          // Group Stage + Playoffs config (ignored by bracket-only tournaments).
          ...(isGroups
            ? {
                groupCount: cfg.groupCount ?? null,
                qualifiersPerGroup: cfg.qualifiersPerGroup ?? 2,
                playoffSeeding: cfg.playoffSeeding ?? 'standing',
                playoffDoubleElim: cfg.playoffDoubleElim ?? false,
              }
            : {}),
          formatSummary: isGroups
            ? 'Round-robin group stage into a playoff bracket'
            : cfg.tournamentFormat === 'SINGLE_ELIM'
              ? 'Single-elimination bracket'
              : cfg.tournamentFormat === 'DOUBLE_ELIM'
                ? 'Double-elimination bracket'
                : cfg.tournamentFormat.replace(/_/g, ' ').toLowerCase(),
          eligibilitySummary: [
            'Open to all registered accounts — sign up yourself, or be added by an admin.',
            camLine(cfg.camRequirement),
          ].join(' '),
        },
      })
      await recordAudit(
        actor,
        {
          action: 'tournament.create',
          entity: 'Tournament',
          entityId: tournament.id,
          newValue: { number: nextNumber, code, name, participantFormat: cfg.participantFormat, tournamentFormat: cfg.tournamentFormat },
        },
        tx,
      )
      return { id: tournament.id, number: nextNumber, code: code, slug }
    })
    return { ok: true, ...created }
  } catch (e) {
    if (e instanceof Error && e.message === 'CUP_NUMBER_TAKEN') {
      return { ok: false, error: 'Tournament number collision — please retry.' }
    }
    return { ok: false, error: e instanceof Error ? e.message : 'Could not create the tournament.' }
  }
}
