import { notFound, redirect } from 'next/navigation'

import { prisma } from '@/lib/prisma'
import { requireCreator } from './access'
import { workflowFor, currentStage, stageReachable, stageHref, type StageId, type StageView } from './workflow'
import { getCompetitionRegistrationMode } from '@/lib/competition/registration-policy'
import type { SettingsSummary } from '@/components/creator/settings-panel'

/**
 * Everything a Creator Season stage page needs, loaded once.
 *
 * ── One query, one description ───────────────────────────────────────────────────────────────────
 * Setup and Entrants both need the same header: which record, which stage, which lifecycle, what the
 * Settings panel should show. Loading that separately in each page would mean two queries per view
 * and — much worse — two places that decide how a Season describes itself, which drift the moment
 * one of them learns about divisions and the other does not.
 *
 * ── The stage guard lives here too ───────────────────────────────────────────────────────────────
 * A reader who types `/creator/seasons/12/groups` before the groups exist is sent to the stage the
 * record is ACTUALLY at, rather than shown an empty page that looks broken. Redirecting rather than
 * 404-ing because the record does exist; it is the stage that does not, yet.
 */
export interface SeasonStageContext {
  id: number
  title: string
  summary: string
  status: string
  workflow: StageView[]
  publicHref: string
  settings: SettingsSummary
  lifecycleState: string
  entrantsCount: number
  /** Where the record actually is, whatever stage was asked for. */
  stage: StageId
  reconstruction: boolean
  archiveTemplateKey: string | null
}

const STATUS_WORDS: Record<string, string> = {
  REGISTRATION_SCHEDULED: 'Registration Scheduled',
  REGISTRATION_OPEN: 'Registration Open',
  REGISTRATION_CLOSED: 'Registration Closed',
  GROUP_SETUP: 'Group Setup',
  GROUP_STAGE_LIVE: 'Group Stage Live',
  GROUPS_CLOSED: 'Groups Closed',
  PLAYOFFS_LIVE: 'Playoffs Live',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
}

export function seasonStatusWords(state: string): string {
  return STATUS_WORDS[state] ?? state.replace(/_/g, ' ').toLowerCase()
}

export async function loadSeasonStage(rawId: string, asked: StageId): Promise<SeasonStageContext> {
  const gate = await requireCreator()
  const id = Number(rawId)
  if (!Number.isInteger(id) || id <= 0) notFound()

  const row = await prisma.season.findUnique({
    where: { id },
    select: {
      id: true, number: true, division: true, subtitle: true, competitionYear: true,
      lifecycleState: true, description: true, publiclyVisible: true, countsTowardRankings: true,
      playoffDoubleElim: true, groupStageGames: true, earlyRaceTo: true, semifinalRaceTo: true,
      finalRaceTo: true, reconstruction: true, archiveTemplateKey: true, accessMode: true,
      competitionSeries: { select: { name: true } },
      _count: { select: { entrants: true } },
    },
  })
  if (!row) notFound()

  const state = String(row.lifecycleState)
  const competition = row.competitionSeries?.name ?? 'Competition'
  const stage = currentStage('season', state)

  /*
   * A stage this record has not reached sends the reader to the one it has.
   *
   * Typing `/creator/seasons/12/playoffs` at a Season still taking entrants would otherwise render a
   * page with nothing on it, which reads as broken rather than as early. Redirect rather than 404,
   * because the record genuinely exists — it is the stage that does not, yet.
   */
  if (!stageReachable('season', state, asked)) redirect(stageHref('season', row.id, stage))

  /*
   * Only the Danger Zone is gated further.
   *
   * `requireCreator` has already decided that this person may work on records at all; permanent
   * deletion is the one control that is not merely "work", so it asks the narrower Owner-only
   * question instead of assuming Creator access implies it.
   */
  const canDelete = gate.can('delete_competition')

  const settings: SettingsSummary = {
    kind: 'season',
    id: row.id,
    title: row.subtitle?.trim() || `${competition} Season ${row.number}`,
    competition,
    competitionYear: row.competitionYear,
    number: row.number,
    division: row.division,
    formatLines: [
      'Individual entrants',
      row.playoffDoubleElim ? 'Groups → Double-elimination playoffs' : 'Groups → Single-elimination playoffs',
      `Group stage: ${row.groupStageGames} games`,
      `Playoff races: ${row.earlyRaceTo} early · ${row.semifinalRaceTo} semi-final · ${row.finalRaceTo} final`,
    ],
    publiclyVisible: row.publiclyVisible,
    countsTowardRankings: row.countsTowardRankings,
    registrationPolicy: await getCompetitionRegistrationMode(),
    lifecycleState: state,
    // Groups or playoff matches mean a format change would invalidate something already played.
    hasDependentData:
      (await prisma.seasonGroup.count({ where: { seasonId: row.id } })) > 0
      || (await prisma.seasonPlayoffMatch.count({ where: { seasonId: row.id } })) > 0,
    canDelete,
  }

  return {
    id: row.id,
    title: row.subtitle?.trim() || `${competition} Season ${row.number}`,
    summary: [competition, row.competitionYear, `Season ${row.number}`, row.division]
      .filter(Boolean).join(' · '),
    status: seasonStatusWords(state),
    workflow: workflowFor('season', row.id, state),
    publicHref: `/seasons/${row.id}`,
    settings,
    lifecycleState: state,
    entrantsCount: row._count.entrants,
    stage,
    reconstruction: row.reconstruction,
    archiveTemplateKey: row.archiveTemplateKey,
  }
}

/** True when the asked-for stage is one this record has actually reached. */
export function seasonStageOpen(lifecycleState: string, stage: StageId): boolean {
  return stageReachable('season', lifecycleState, stage)
}
