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
 * Create a new LIVE cup. Cup number + competition code are assigned atomically inside a
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
      // Atomic next-number/code assignment: read the current max cup number under the tx.
      const agg = await tx.tournament.aggregate({ where: { competitionType: 'CUP' }, _max: { number: true } })
      const nextNumber = (agg._max.number ?? 0) + 1
      const code = `C${String(nextNumber).padStart(3, '0')}`
      const slug = `cup-${nextNumber}`

      // Guard against a slug/code/number that somehow already exists (unique columns will
      // also throw, but this yields a clean error).
      const clash = await tx.tournament.findFirst({
        where: { OR: [{ number: nextNumber }, { code: code }, { slug }] },
        select: { id: true },
      })
      if (clash) throw new Error('CUP_NUMBER_TAKEN')

      const tournament = await tx.tournament.create({
        data: {
          slug,
          name,
          competitionType: 'CUP',
          code: code,
          number: nextNumber,
          gameType: cfg.gameType,
          participantFormat: cfg.participantFormat,
          teamSize: cfg.participantFormat === 'TEAM' ? cfg.teamSize ?? null : null,
          tournamentFormat: cfg.tournamentFormat,
          raceLength: cfg.raceLength,
          cupFormatBadge: formatBadge(cfg),
          cupStatus: 'live', // editable/live cup (distinguished from imported historical)
          // Stamp the year + start date NOW so the cup falls inside the rolling ranking
          // window and its champion title is credited once results are recorded/completed.
          cupYear: new Date().getFullYear(),
          cupDate: new Date().toISOString().slice(0, 10),
          status: 'UPCOMING',
          // Lifecycle: a new cup starts in DRAFT — nothing publicly joinable. An Admin opens
          // registration explicitly (see cup-lifecycle). registrationStatus stays in sync.
          lifecycleState: 'DRAFT',
          registrationStatus: 'NOT_OPEN',
          playoffsStatus: 'PENDING',
          importedFromFixture: false,
          locked: false,
          formatSummary:
            cfg.tournamentFormat === 'SINGLE_ELIM'
              ? 'Single-elimination bracket'
              : cfg.tournamentFormat.replace('_', ' ').toLowerCase(),
          eligibilitySummary: [
            'Open to all registered accounts — sign up yourself, or be added by an admin.',
            camLine(cfg.camRequirement),
          ].join(' '),
          ...(cfg.fieldSize ? { entrantsCount: null } : {}),
        },
      })
      await recordAudit(
        actor,
        {
          action: 'cup.create',
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
      return { ok: false, error: 'Cup number collision — please retry.' }
    }
    return { ok: false, error: e instanceof Error ? e.message : 'Could not create the cup.' }
  }
}
