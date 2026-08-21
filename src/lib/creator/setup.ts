import 'server-only'
import { prisma } from '@/lib/prisma'
import { createSeason } from '@/lib/seasons/service'
import type { Actor } from '@/lib/competition/audit'

/**
 * Creating a Season or a Cup from Creator.
 *
 * A thin, well-guarded front door onto the EXISTING creation services. It deliberately owns no
 * validation of its own beyond the things Creator adds — the purpose, the structure, and the
 * double-submit guard — because a second set of rules about what a valid Season is would drift
 * from the first the week after it was written.
 */

export type RecordType = 'season' | 'cup'
export type Purpose = 'live' | 'reconstruction'

/**
 * Competition structures the engine genuinely supports.
 *
 * Derived from what the group and bracket code can actually run, not from what would read well on a
 * form. A format offered here that the engine cannot produce is a promise the application breaks
 * halfway through a competition.
 */
export const STRUCTURES = [
  {
    id: 'groups_playoffs',
    label: 'Groups → Playoffs',
    hint: 'A round-robin group stage, then a single-elimination bracket for the qualifiers. The usual Season shape.',
    seasons: true,
    cups: false,
  },
  {
    id: 'groups_playoffs_de',
    label: 'Groups → Playoffs (double elimination)',
    hint: 'The same group stage, but the bracket gives every qualifier a second life.',
    seasons: true,
    cups: false,
  },
  {
    id: 'groups_only',
    label: 'Groups only',
    hint: 'A group stage that decides the standings outright. No bracket is created.',
    seasons: true,
    cups: false,
  },
  {
    id: 'single_elim',
    label: 'Single elimination',
    hint: 'A straight knockout bracket. One loss and you are out.',
    seasons: false,
    cups: true,
  },
  {
    id: 'double_elim',
    label: 'Double elimination',
    hint: 'A knockout with a losers bracket. Two losses to go out.',
    seasons: false,
    cups: true,
  },
  {
    id: 'swiss',
    label: 'Swiss',
    hint: 'Fixed rounds, pairing players on equal records. Nobody is eliminated.',
    seasons: false,
    cups: true,
  },
] as const

export type StructureId = (typeof STRUCTURES)[number]['id']

export const structuresFor = (type: RecordType) =>
  STRUCTURES.filter((s) => (type === 'season' ? s.seasons : s.cups))

/** The Cup format each Cup structure maps onto. Seasons have no such field — see below. */
const CUP_FORMAT: Record<string, 'SINGLE_ELIM' | 'DOUBLE_ELIM' | 'SWISS'> = {
  single_elim: 'SINGLE_ELIM',
  double_elim: 'DOUBLE_ELIM',
  swiss: 'SWISS',
}

export interface SetupInput {
  type: RecordType
  competitionYear: number
  competitionSeriesId: number
  purpose: Purpose
  structure: StructureId
  title?: string | null
  /** Seasons only. Omitted takes the next number going spare in that Competition and year. */
  number?: number | null
  division?: string | null
  description?: string | null
  announcements?: string | null
  groupStageGames?: number
  earlyRaceTo?: number
  semifinalRaceTo?: number
  finalRaceTo?: number
  /** Live competitions only. A reconstruction has no registration to protect. */
  accessMode?: 'OPEN' | 'PASSWORD'
  joinPassword?: string | null
  registrationOpensAt?: string | null
  /**
   * A token the form generates once per attempt.
   *
   * Double-submit protection: the same token twice returns the record the first call made instead
   * of a second draft. A disabled button is not enough — a slow network and an impatient click
   * produce two requests, and two half-built Seasons is the outcome nobody can untangle later.
   */
  idempotencyKey?: string | null
}

export interface SetupResult {
  ok: boolean
  error?: string
  id?: number
  type?: RecordType
  /** Set when an identical submission had already created this record. */
  deduplicated?: boolean
}

/**
 * Where a freshly created draft continues.
 *
 * A Cup keeps its internal numeric id in the URL — it is immutable and it is what the record is.
 * There is no manually entered Cup number to ask for or to route on.
 */
export const draftHref = (type: RecordType, id: number) =>
  type === 'season' ? `/creator/seasons/${id}` : `/creator/cups/${id}`

/**
 * In-flight and recently completed submissions, by idempotency key.
 *
 * Process-local and deliberately so: this guards against the double-click and the retried request,
 * both of which land within seconds on the same server. It is not a distributed lock and does not
 * pretend to be one — the real protection against a duplicate Season is that the operator can see
 * the draft they just made on the dashboard.
 */
const recent = new Map<string, { id: number; type: RecordType; at: number }>()
const RECENT_TTL_MS = 60_000

function remember(key: string, id: number, type: RecordType) {
  recent.set(key, { id, type, at: Date.now() })
  // Cheap sweep: the map only ever holds a minute of submissions.
  for (const [k, v] of recent) if (Date.now() - v.at > RECENT_TTL_MS) recent.delete(k)
}

export async function createDraft(actor: Actor, input: SetupInput): Promise<SetupResult> {
  const key = input.idempotencyKey?.trim()
  if (key) {
    const seen = recent.get(key)
    if (seen && Date.now() - seen.at < RECENT_TTL_MS) {
      return { ok: true, id: seen.id, type: seen.type, deduplicated: true }
    }
  }

  if (input.type !== 'season' && input.type !== 'cup') return { ok: false, error: 'Choose a Season or a Cup.' }
  if (!Number.isInteger(input.competitionYear)) return { ok: false, error: 'A competition year is required.' }
  if (!Number.isInteger(input.competitionSeriesId)) return { ok: false, error: 'A Competition is required.' }
  if (!structuresFor(input.type).some((s) => s.id === input.structure)) {
    return { ok: false, error: 'Choose a structure this application can actually run.' }
  }

  const series = await prisma.competitionSeries.findUnique({
    where: { id: input.competitionSeriesId }, select: { id: true, active: true },
  })
  if (!series) return { ok: false, error: 'That Competition does not exist.' }

  const reconstruction = input.purpose === 'reconstruction'
  const doubleElim = input.structure === 'double_elim' || input.structure === 'groups_playoffs_de'

  if (input.type === 'season') {
    const created = await createSeason(actor, {
      competitionYear: input.competitionYear,
      competitionSeriesId: input.competitionSeriesId,
      number: input.number ?? null,
      subtitle: input.title?.trim() || null,
      description: input.description?.trim() || null,
      // A reconstruction has no public registration, so it is created OPEN with no password rather
      // than carrying a protection setting that means nothing and could be published by accident.
      accessMode: reconstruction ? 'OPEN' : (input.accessMode ?? 'PASSWORD'),
      joinPassword: reconstruction ? null : (input.joinPassword ?? null),
      registrationOpensAt: reconstruction ? null : (input.registrationOpensAt ?? null),
      groupStageGames: input.groupStageGames,
      earlyRaceTo: input.earlyRaceTo,
      semifinalRaceTo: input.semifinalRaceTo,
      finalRaceTo: input.finalRaceTo,
    })
    if (!created.ok || created.id == null) {
      return { ok: false, error: created.error ?? 'The Season could not be created.' }
    }

    // Creator-only fields the shared service does not know about. A reconstruction starts PRIVATE:
    // it must never appear under Live while it is being typed in.
    await prisma.season.update({
      where: { id: created.id },
      data: {
        division: input.division?.trim() || null,
        reconstruction,
        publiclyVisible: !reconstruction,
        playoffDoubleElim: doubleElim,
      },
    })

    if (key) remember(key, created.id, 'season')
    return { ok: true, id: created.id, type: 'season' }
  }

  // ── Cup
  const title = input.title?.trim()
  if (!title) return { ok: false, error: 'A Cup needs a title.' }

  const { createTournament } = await import('@/lib/competition/tournament-create')
  const created = await createTournament(actor, {
    name: title,
    competitionYear: input.competitionYear,
    // Carried through rather than dropped. This path validated a Competition and then threw it
    // away, because comp_tournament had nowhere to put it — the Tournament came out belonging to
    // nothing while the form had plainly asked which one it was.
    competitionSeriesId: input.competitionSeriesId,
    participantFormat: 'INDIVIDUAL',
    tournamentFormat: CUP_FORMAT[input.structure] ?? 'SINGLE_ELIM',
    // A Cup carries one race length. The Season form's three-tier race settings have no equivalent
    // here, so the early-round value is the one that applies throughout.
    raceLength: input.earlyRaceTo ?? 5,
    seedingMethod: 'registration',
    accessMode: reconstruction ? 'OPEN' : (input.accessMode ?? 'OPEN'),
    joinPassword: reconstruction ? null : (input.joinPassword ?? null),
    playoffDoubleElim: doubleElim,
  })

  if (!created.ok || created.id == null) {
    return { ok: false, error: created.error ?? 'The Cup could not be created.' }
  }
  const id = created.id

  await prisma.tournament.update({
    where: { id },
    data: {
      reconstruction,
      publiclyVisible: !reconstruction,
      description: input.description?.trim() || null,
    },
  })

  if (key) remember(key, id, 'cup')
  return { ok: true, id, type: 'cup' }
}
