import 'server-only'

import { prisma } from '@/lib/prisma'
import { currentStage, type RecordKind } from './workflow'

/**
 * What Creator's landing page and its two list pages need to know.
 *
 * ── Open versus completed is the only division that matters here ─────────────────────────────────
 * Everything else about a record — its format, its year, whether it came from the archive — is
 * detail for the record's own pages. On the way in, the reader is choosing between "something I am
 * still running" and "something finished that I want to correct", and those two want different
 * presentations: tiles for a handful of live records, a compact list for the many finished ones.
 */

export interface CreatorRecordRow {
  kind: RecordKind
  id: number
  /** Where clicking it should land: the stage the record is actually at. */
  href: string
  /** The bold first line, already formatted for its kind. */
  title: string
  /** Competition · Year, and the number where the kind has one. */
  subtitle: string
  lifecycleState: string
  /** Human lifecycle wording, matching the rest of the site. */
  status: string
  entrants: number
  champion: string | null
  /** Completed records only: whether the Final was won by forfeit. */
  finalsForfeit?: boolean
}

export interface CreatorLandingCounts {
  seasonsOpen: number
  seasonsCompleted: number
  tournamentsOpen: number
  tournamentsCompleted: number
}

const SEASON_STATUS: Record<string, string> = {
  REGISTRATION_SCHEDULED: 'Registration scheduled',
  REGISTRATION_OPEN: 'Registration open',
  REGISTRATION_CLOSED: 'Registration closed',
  GROUP_SETUP: 'Group setup',
  GROUP_STAGE_LIVE: 'Group stage live',
  GROUPS_CLOSED: 'Groups closed',
  PLAYOFF_SETUP: 'Playoff setup',
  PLAYOFFS_LIVE: 'Playoffs live',
  COMPLETED: 'Completed',
}

const TOURNAMENT_STATUS: Record<string, string> = {
  DRAFT: 'Draft',
  REGISTRATION_OPEN: 'Registration open',
  REGISTRATION_CLOSED: 'Registration closed',
  GROUPS_IN_PROGRESS: 'Group stage live',
  BRACKET_GENERATED: 'Bracket ready',
  IN_PROGRESS: 'In progress',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
}

export const seasonStatusLabel = (s: string) => SEASON_STATUS[s] ?? s
export const tournamentStatusLabel = (s: string) => TOURNAMENT_STATUS[s] ?? s

/** Counts for the landing cards. One query per kind rather than loading the records. */
export async function creatorCounts(): Promise<CreatorLandingCounts> {
  const [seasonsOpen, seasonsCompleted, tournamentsOpen, tournamentsCompleted] = await Promise.all([
    prisma.season.count({ where: { NOT: { lifecycleState: 'COMPLETED' } } }),
    prisma.season.count({ where: { lifecycleState: 'COMPLETED' } }),
    prisma.tournament.count({ where: { NOT: { lifecycleState: { in: ['COMPLETED', 'CANCELLED'] } } } }),
    prisma.tournament.count({ where: { lifecycleState: 'COMPLETED' } }),
  ])
  return { seasonsOpen, seasonsCompleted, tournamentsOpen, tournamentsCompleted }
}

/**
 * A Season's first line.
 *
 * The competition's full name, not its slug: the reader knows this competition by its name, and a
 * list where every row begins with the same abbreviation is a list nobody can scan.
 */
function seasonTitle(s: {
  number: number
  competitionYear: number
  division: string | null
  competitionSeries: { name: string }
}): string {
  const div = s.division && s.division.trim() ? ` · ${s.division.trim()}` : ''
  return `${s.competitionSeries.name} Season ${s.number} · ${s.competitionYear}${div}`
}

export async function listSeasons(scope: 'open' | 'completed'): Promise<CreatorRecordRow[]> {
  const rows = await prisma.season.findMany({
    where: scope === 'completed' ? { lifecycleState: 'COMPLETED' } : { NOT: { lifecycleState: 'COMPLETED' } },
    select: {
      id: true, number: true, competitionYear: true, division: true, lifecycleState: true,
      entrantsCount: true, championName: true, championHandle: true, finalsForfeit: true,
      competitionSeries: { select: { name: true } },
    },
    orderBy: [{ competitionYear: 'desc' }, { number: 'desc' }],
  })
  return rows.map((s) => ({
    kind: 'season' as const,
    id: s.id,
    href: `/creator/seasons/${s.id}/${currentStage('season', s.lifecycleState)}`,
    title: seasonTitle(s),
    subtitle: `${s.competitionSeries.name} · ${s.competitionYear}`,
    lifecycleState: s.lifecycleState,
    status: seasonStatusLabel(s.lifecycleState),
    entrants: s.entrantsCount ?? 0,
    champion: s.championHandle || s.championName || null,
    finalsForfeit: s.finalsForfeit ?? false,
  }))
}

/**
 * A Tournament's first line: `2. Title · Full Competition Name · Year`.
 *
 * The official number and nothing invented around it. It used to read "Tournament #2" or "T002", and
 * to show the current year rather than the year the competition belongs to — which for a historical
 * reconstruction is simply wrong, and for a reader scanning a list is the one thing that tells two
 * similar events apart.
 */
function tournamentTitle(t: {
  number: number | null
  name: string
  competitionYear: number
  competitionSeries: { name: string } | null
}): string {
  const comp = t.competitionSeries?.name
  // A record with no number yet is still openable; it simply has no leading figure to show.
  const lead = t.number != null ? `${t.number}. ` : ''
  return `${lead}${t.name}${comp ? ` · ${comp}` : ''} · ${t.competitionYear}`
}

export async function listTournaments(scope: 'open' | 'completed'): Promise<CreatorRecordRow[]> {
  const rows = await prisma.tournament.findMany({
    where: scope === 'completed'
      ? { lifecycleState: 'COMPLETED' }
      : { NOT: { lifecycleState: { in: ['COMPLETED', 'CANCELLED'] } } },
    select: {
      id: true, number: true, name: true, competitionYear: true, lifecycleState: true,
      tournamentFormat: true, championName: true, championHandle: true, finalsForfeit: true,
      competitionSeries: { select: { name: true } },
      _count: { select: { registrations: true } },
    },
    orderBy: [{ competitionYear: 'desc' }, { number: 'desc' }],
  })
  return rows.map((t) => {
    const state = t.lifecycleState ?? 'DRAFT'
    return {
    kind: 'tournament' as const,
    id: t.id,
    href: `/creator/tournaments/${t.id}/${currentStage('tournament', state, t.tournamentFormat)}`,
    title: tournamentTitle(t),
    subtitle: `${t.competitionSeries?.name ?? 'Tournament'} · ${t.competitionYear}`,
    lifecycleState: state,
    status: tournamentStatusLabel(state),
    entrants: t._count.registrations,
    champion: t.championHandle || t.championName || null,
    finalsForfeit: t.finalsForfeit ?? false,
    }
  })
}
