import { notFound, redirect } from 'next/navigation'

import { prisma } from '@/lib/prisma'
import { requireCreator } from './access'
import { workflowFor, currentStage, stageReachable, type StageId, type StageView } from './workflow'
import { getCompetitionRegistrationMode } from '@/lib/competition/registration-policy'
import type { SettingsSummary } from '@/components/creator/settings-panel'

/**
 * Everything a Creator Tournament stage page needs, loaded once.
 *
 * ── The Season loader's twin, deliberately ───────────────────────────────────────────────────────
 * This mirrors `season-stage.ts` because the two records genuinely behave the same way at this
 * level: identify the record, describe it, work out which stage it is at, refuse a stage it has not
 * reached. Merging them into one generic loader would mean a single function branching on `kind` in
 * a dozen places to reach two different tables with different column names — more code, and harder
 * to read than the honest pair.
 *
 * ── Format decides the workflow ──────────────────────────────────────────────────────────────────
 * A Tournament's stages depend on its format, so the format is loaded first and handed to every
 * workflow call. A Swiss Tournament has no groups stage and a single-elimination one has no Swiss
 * stage, and offering either would produce a page with nothing on it.
 */
export interface TournamentStageContext {
  id: number
  number: number | null
  title: string
  summary: string
  status: string
  workflow: StageView[]
  publicHref: string
  settings: SettingsSummary
  lifecycleState: string
  format: string
  participantFormat: string
  isTeam: boolean
  teamSize: number | null
  entrantsCount: number
  stage: StageId
}

const STATUS_WORDS: Record<string, string> = {
  DRAFT: 'Draft',
  REGISTRATION_SCHEDULED: 'Registration Scheduled',
  REGISTRATION_OPEN: 'Registration Open',
  REGISTRATION_CLOSED: 'Registration Closed',
  GROUPS_IN_PROGRESS: 'Group Stage',
  BRACKET_GENERATED: 'Bracket Generated',
  IN_PROGRESS: 'In Progress',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
}

export function tournamentStatusWords(state: string): string {
  return STATUS_WORDS[state] ?? state.replace(/_/g, ' ').toLowerCase()
}

/**
 * How a Tournament names itself, everywhere.
 *
 * `2. Prize Tournament · 8BRCAM · 2006` — position, title, the Competition's real name, the year it
 * belongs to. The internal code (T002) is an identifier for the database, not a heading: it told a
 * reader nothing they wanted and pushed the title out of the first glance.
 */
export function tournamentTitleLine(t: {
  number: number | null
  name: string
  competitionSeries?: { name: string } | null
  competitionYear: number | null
}): string {
  return [
    t.number != null ? `${t.number}. ${t.name}` : t.name,
    t.competitionSeries?.name,
    t.competitionYear,
  ].filter(Boolean).join(' · ')
}

export async function loadTournamentStage(rawId: string, asked: StageId): Promise<TournamentStageContext> {
  const gate = await requireCreator()
  const id = Number(rawId)
  if (!Number.isInteger(id) || id <= 0) notFound()

  const row = await prisma.tournament.findUnique({
    where: { id },
    select: {
      id: true, number: true, name: true, slug: true, competitionYear: true,
      lifecycleState: true, tournamentFormat: true, participantFormat: true, teamSize: true,
      publiclyVisible: true, countsTowardRankings: true, raceLength: true,
      swissRounds: true, playoffDoubleElim: true, finalsForfeit: true,
      competitionSeries: { select: { name: true } },
      _count: { select: { registrations: true } },
    },
  })
  if (!row) notFound()

  const state = String(row.lifecycleState)
  const format = String(row.tournamentFormat ?? 'SINGLE_ELIM')
  const isTeam = String(row.participantFormat) === 'TEAM'
  const stage = currentStage('tournament', state, format)

  // A stage this record has not reached sends the reader to the one it has — see season-stage.ts.
  if (!stageReachable('tournament', state, asked, format)) {
    redirect(`/creator/tournaments/${row.id}/${stage}`)
  }

  const competition = row.competitionSeries?.name ?? 'Competition'
  const canDelete = gate.can('delete_competition')

  const formatLines = [
    isTeam ? `Teams of ${row.teamSize ?? 2}` : 'Individual entrants',
    format === 'SWISS'
      ? `Swiss system${row.swissRounds ? ` — ${row.swissRounds} rounds` : ''}`
      : format === 'GROUPS_PLAYOFFS'
        ? `Groups → ${row.playoffDoubleElim ? 'double' : 'single'}-elimination playoffs`
        : format === 'DOUBLE_ELIM'
          ? 'Double-elimination bracket'
          : 'Single-elimination bracket',
    `Race to ${row.raceLength}`,
  ]

  const settings: SettingsSummary = {
    kind: 'tournament',
    id: row.id,
    title: row.name,
    competition,
    competitionYear: row.competitionYear ?? new Date().getFullYear(),
    formatLines,
    publiclyVisible: row.publiclyVisible,
    countsTowardRankings: row.countsTowardRankings,
    registrationPolicy: await getCompetitionRegistrationMode(),
    lifecycleState: state,
    hasDependentData:
      (await prisma.tournamentMatch.count({ where: { tournamentId: row.id } })) > 0
      || (await prisma.playoffMatch.count({ where: { tournamentId: row.id } })) > 0,
    canDelete,
  }

  return {
    id: row.id,
    number: row.number,
    title: row.name,
    summary: [competition, row.competitionYear, row.number != null ? `Tournament ${row.number}` : null]
      .filter(Boolean).join(' · '),
    status: tournamentStatusWords(state),
    workflow: workflowFor('tournament', row.id, state, format),
    publicHref: row.number != null ? `/tournaments/${row.number}` : '/tournaments',
    settings,
    lifecycleState: state,
    format,
    participantFormat: String(row.participantFormat),
    isTeam,
    teamSize: row.teamSize,
    entrantsCount: row._count.registrations,
    stage,
  }
}
