'use server'

import { revalidatePath } from 'next/cache'

import { prisma } from '@/lib/prisma'
import { creatorActor } from './access'
import { createTournament, type CreateTournamentConfig } from '@/lib/competition/tournament-create'
import { transitionTournamentState } from '@/lib/competition/tournament-lifecycle'
import { currentStage } from './workflow'

export interface CreateTournamentFormResult {
  ok?: boolean
  error?: string
  href?: string
  /** Set when a Tournament of the same identity already exists, so the form can offer to open it. */
  existingHref?: string
  /**
   * The Tournament was created, but something after it was not.
   *
   * Distinct from `error`, which means nothing was created. This is the case where the record
   * exists and is usable but arrived in a state the form did not intend — worth saying, not worth
   * throwing away the Tournament over.
   */
  warning?: string
}

export interface TournamentFormInput {
  name: string
  competitionSeriesId: number
  competitionYear: number
  tournamentFormat: 'SINGLE_ELIM' | 'DOUBLE_ELIM' | 'GROUPS_PLAYOFFS' | 'SWISS'
  participantFormat: 'INDIVIDUAL' | 'TEAM'
  teamSize?: number | null
  teamFormation?: 'PICK' | 'RANDOM'
  raceLength: number
  swissRounds?: number | null
  playoffDoubleElim?: boolean
  scheduleForLater?: boolean
  scheduledStartAt?: string | null
  description?: string | null
}

/**
 * Create a Tournament from the Creator form.
 *
 * ── Access, like a Season's ──────────────────────────────────────────────────────────────────────
 * Always OPEN, never a join password. The site-wide registration policy decides whether anybody
 * outside Creator may enter, which is one gate asked in one place; a per-Tournament password would
 * be a second that has to agree with the first. Legacy password-protected Tournaments keep their
 * data — the mode is simply not offered again.
 *
 * ── Duplicate identity ───────────────────────────────────────────────────────────────────────────
 * A Tournament has no unique index on (Competition, year, title) the way a Season has on its number,
 * so the check is a pre-flight only. It exists for the message: finding you already made this last
 * week and offering to open it is more useful than a second copy with the same name.
 */
export async function createTournamentAction(input: TournamentFormInput): Promise<CreateTournamentFormResult> {
  const gate = await creatorActor()
  if (!gate.ok) return { error: gate.error }

  const name = input.name.trim()
  if (!name) return { error: 'Give the Tournament a title.' }

  const clash = await prisma.tournament.findFirst({
    where: {
      name: { equals: name, mode: 'insensitive' },
      competitionSeriesId: input.competitionSeriesId,
      competitionYear: input.competitionYear,
    },
    select: { id: true, lifecycleState: true, tournamentFormat: true },
  })
  if (clash) {
    const stage = currentStage('tournament', String(clash.lifecycleState), String(clash.tournamentFormat ?? 'SINGLE_ELIM'))
    return {
      error: `A Tournament called “${name}” already exists for this Competition in ${input.competitionYear}.`,
      existingHref: `/creator/tournaments/${clash.id}/${stage}`,
    }
  }

  const isTeam = input.participantFormat === 'TEAM'
  const cfg: CreateTournamentConfig = {
    name,
    competitionSeriesId: input.competitionSeriesId,
    competitionYear: input.competitionYear,
    participantFormat: input.participantFormat,
    // Team fields are only meaningful for a team Tournament; sending them for 1v1 would store a
    // roster size for a competition that has no rosters.
    teamSize: isTeam ? (input.teamSize ?? 2) : null,
    teamFormation: isTeam ? (input.teamFormation ?? 'PICK') : undefined,
    tournamentFormat: input.tournamentFormat,
    raceLength: input.raceLength,
    swissRounds: input.tournamentFormat === 'SWISS' ? (input.swissRounds ?? 4) : null,
    playoffDoubleElim: input.tournamentFormat === 'GROUPS_PLAYOFFS' ? !!input.playoffDoubleElim : undefined,
    accessMode: 'OPEN',
    joinPassword: null,
    scheduleForLater: !!input.scheduleForLater,
    scheduledStartAt: input.scheduledStartAt || null,
  }

  const created = await createTournament(gate.actor, cfg)
  if (!created.ok || created.id == null) {
    return { error: created.error ?? 'The Tournament could not be created.' }
  }

  if (input.description?.trim()) {
    await prisma.tournament.update({
      where: { id: created.id },
      data: { description: input.description.trim() },
    })
  }

  /*
    ── Created open, not created and then opened ─────────────────────────────────────────────────
    `createTournament` lands in DRAFT and leaves opening registration to its caller, which is right
    for a scheduled Tournament and wrong for every other one. Nothing here opened it, so a brand new
    Tournament arrived at the Entrants stage it could not reach and was bounced back to Setup — an
    extra click whose only purpose was to undo the state it had just been created in.

    A Tournament started now opens now. One that was deliberately SCHEDULED keeps its DRAFT and its
    `registrationOpensAt`, because a start date somebody chose is not an accident to correct.

    Opening is not the same as inviting: whether members may enter is the site-wide registration
    policy's business. An admin who wants a closed list closes it on the Entrants screen, which is
    one click from here and reversible, unlike being unable to reach the screen at all.
  */
  if (!cfg.scheduleForLater) {
    const opened = await transitionTournamentState(gate.actor, created.id, 'REGISTRATION_OPEN', {
      reason: 'Registration opened on creation',
    })
    // A refusal is reported rather than swallowed: the Tournament exists either way, and landing on
    // Setup with no explanation is the confusing half of the behaviour this replaces.
    if (!opened.ok) {
      return {
        ok: true,
        href: `/creator/tournaments/${created.id}/setup`,
        warning: `The Tournament was created, but registration could not be opened: ${opened.error}`,
      }
    }
  }

  revalidatePath('/tournaments')
  revalidatePath('/creator')
  revalidatePath('/creator/tournaments')

  /*
    Straight to the work that comes next, which is not the same screen for both kinds.

    A team Tournament has no entrant list to fill in — its first job is building rosters, and the
    Teams screen is where that happens. Landing it on Entrants offered a page that could only say
    the list was managed elsewhere.
  */
  return { ok: true, href: `/creator/tournaments/${created.id}/${isTeam ? 'teams' : 'entrants'}` }
}
