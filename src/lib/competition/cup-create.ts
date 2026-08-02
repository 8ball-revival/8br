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
  entryMode: 'PUBLIC' | 'MANUAL'
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
 * simultaneous creates cannot collide. Returns the new competition id + cupNumber + code.
 *
 * The cup is a `Season` row with competitionType=CUP, rendered/edited through the same
 * unified competition machinery. It is created EMPTY (no results invented); entrants/teams
 * and the bracket are built afterward through the Cup workspace.
 */
export async function createCup(
  actor: Actor,
  cfg: CreateCupConfig,
): Promise<{ ok: boolean; error?: string; id?: number; cupNumber?: number; competitionCode?: string; slug?: string }> {
  const name = cfg.name.trim()
  if (!name) return { ok: false, error: 'A cup name is required.' }
  if (cfg.participantFormat === 'TEAM' && (!cfg.teamSize || cfg.teamSize < 2)) {
    return { ok: false, error: 'Team cups need a team size of at least 2.' }
  }

  try {
    const created = await prisma.$transaction(async (tx) => {
      // Atomic next-number/code assignment: read the current max cup number under the tx.
      const agg = await tx.season.aggregate({ where: { competitionType: 'CUP' }, _max: { cupNumber: true } })
      const nextNumber = (agg._max.cupNumber ?? 0) + 1
      const code = `C${String(nextNumber).padStart(3, '0')}`
      const slug = `cup-${nextNumber}`

      // Guard against a slug/code/number that somehow already exists (unique columns will
      // also throw, but this yields a clean error).
      const clash = await tx.season.findFirst({
        where: { OR: [{ cupNumber: nextNumber }, { competitionCode: code }, { slug }] },
        select: { id: true },
      })
      if (clash) throw new Error('CUP_NUMBER_TAKEN')

      const season = await tx.season.create({
        data: {
          slug,
          name,
          competitionType: 'CUP',
          competitionCode: code,
          cupNumber: nextNumber,
          gameType: cfg.gameType,
          participantFormat: cfg.participantFormat,
          teamSize: cfg.participantFormat === 'TEAM' ? cfg.teamSize ?? null : null,
          tournamentFormat: cfg.tournamentFormat,
          cupFormatBadge: formatBadge(cfg),
          cupStatus: 'live', // editable/live cup (distinguished from imported historical)
          cupYear: null,
          seasonStatus: cfg.initialState === 'UPCOMING' ? 'UPCOMING' : 'UPCOMING',
          registrationStatus: cfg.entryMode === 'PUBLIC' ? 'OPEN' : 'NOT_OPEN',
          playoffsStatus: 'PENDING',
          importedFromFixture: false,
          locked: false,
          formatSummary:
            cfg.tournamentFormat === 'SINGLE_ELIM'
              ? 'Single-elimination bracket'
              : cfg.tournamentFormat.replace('_', ' ').toLowerCase(),
          eligibilitySummary: [
            cfg.entryMode === 'PUBLIC' ? 'Open registration.' : 'Entrants added by administrators.',
            camLine(cfg.camRequirement),
          ].join(' '),
          ...(cfg.fieldSize ? { entrantsCount: null } : {}),
        },
      })
      await recordAudit(
        actor,
        {
          action: 'cup.create',
          entity: 'Season',
          entityId: season.id,
          newValue: { cupNumber: nextNumber, code, name, participantFormat: cfg.participantFormat, tournamentFormat: cfg.tournamentFormat },
        },
        tx,
      )
      return { id: season.id, cupNumber: nextNumber, competitionCode: code, slug }
    })
    return { ok: true, ...created }
  } catch (e) {
    if (e instanceof Error && e.message === 'CUP_NUMBER_TAKEN') {
      return { ok: false, error: 'Cup number collision — please retry.' }
    }
    return { ok: false, error: e instanceof Error ? e.message : 'Could not create the cup.' }
  }
}
