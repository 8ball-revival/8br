import 'server-only'
import { prisma } from '@/lib/prisma'
import {
  seasonIsArchived, seasonIsLive, tournamentIsArchived, tournamentIsLive, tournamentState,
  type DataCompleteness,
} from '@/lib/competition/lifecycle-rules'

/**
 * Everything Creator manages, in one list.
 *
 * Creator's job is "what am I working on", which cuts across Seasons and Tournaments and across
 * every lifecycle state — including the ones no public surface shows. So this reads both models and
 * buckets them by WHERE THE WORK IS, not by what kind of record it is.
 *
 * The buckets are the answer to "what needs me next":
 *   drafts        — created, nothing open yet
 *   entrants      — registration or entrant entry is open
 *   active        — play is under way
 *   reconstruction— being rebuilt by hand from an archive
 *   completed     — finished and finalised; reopenable, otherwise read-only
 *   attention     — completed but NOT finalised, or reopened and awaiting recompletion
 *
 * `attention` exists because those two states are invisible everywhere else: a completion that
 * failed halfway shows on no public surface at all, and without a bucket for it the record would
 * simply vanish from the person responsible for it.
 */

export type ProjectBucket =
  | 'drafts' | 'entrants' | 'active' | 'reconstruction' | 'completed' | 'attention'

export interface CreatorProject {
  kind: 'season' | 'tournament'
  id: number
  title: string
  competition: string
  year: number | null
  number: number | null
  division: string | null
  lifecycle: string
  bucket: ProjectBucket
  publiclyVisible: boolean
  reconstruction: boolean
  completeness: DataCompleteness
  entrants: number
  /** Where Creator continues this project. */
  href: string
  /** The public page, when it has one. Null while nothing is public. */
  publicHref: string | null
  /** Why it needs attention, when it does. */
  warning: string | null
  updatedAt: string
}

const SEASON_ENTRANT_STATES = ['REGISTRATION_SCHEDULED', 'REGISTRATION_OPEN', 'REGISTRATION_CLOSED']
const SEASON_ACTIVE_STATES = ['GROUP_SETUP', 'GROUP_STAGE_LIVE', 'GROUPS_CLOSED', 'PLAYOFF_SETUP', 'PLAYOFFS_LIVE']

function seasonBucket(s: {
  lifecycleState: string
  ladderAppliedAt: Date | null
  reconstruction: boolean
  reopenedAt: Date | null
}): { bucket: ProjectBucket; warning: string | null } {
  if (s.reopenedAt) {
    return {
      bucket: 'attention',
      warning: 'Reopened for correction — it has left the Archives and is not counting towards the Rankings until it is completed again.',
    }
  }
  if (s.lifecycleState === 'COMPLETED') {
    if (!s.ladderAppliedAt) {
      return {
        bucket: 'attention',
        warning: 'Marked completed but its results were never finalised into the Rankings. It is not archived and does not count. Complete it again to finish the job.',
      }
    }
    return { bucket: 'completed', warning: null }
  }
  if (s.reconstruction) return { bucket: 'reconstruction', warning: null }
  if (SEASON_ACTIVE_STATES.includes(s.lifecycleState)) return { bucket: 'active', warning: null }
  if (SEASON_ENTRANT_STATES.includes(s.lifecycleState)) return { bucket: 'entrants', warning: null }
  return { bucket: 'drafts', warning: null }
}

export async function listCreatorProjects(): Promise<CreatorProject[]> {
  const [seasons, tournaments] = await Promise.all([
    prisma.season.findMany({
      select: {
        id: true, number: true, competitionYear: true, subtitle: true, division: true,
        lifecycleState: true, ladderAppliedAt: true, publiclyVisible: true, reconstruction: true,
        reopenedAt: true, dataCompleteness: true, entrantsCount: true, updatedAt: true,
        competitionSeries: { select: { name: true } },
      },
      orderBy: { updatedAt: 'desc' },
    }),
    prisma.tournament.findMany({
      select: {
        id: true, name: true, number: true, competitionYear: true, status: true,
        lifecycleState: true, archivedAt: true, publiclyVisible: true, reconstruction: true,
        reopenedAt: true, dataCompleteness: true, entrantsCount: true, updatedAt: true,
      },
      orderBy: { updatedAt: 'desc' },
    }).catch(() => []),
  ])

  const out: CreatorProject[] = []

  for (const s of seasons) {
    const { bucket, warning } = seasonBucket({
      lifecycleState: String(s.lifecycleState),
      ladderAppliedAt: s.ladderAppliedAt,
      reconstruction: s.reconstruction,
      reopenedAt: s.reopenedAt,
    })
    const series = s.competitionSeries?.name ?? 'Competition'
    const isPublic = seasonIsLive(s, s.publiclyVisible) || seasonIsArchived(s)
    out.push({
      kind: 'season',
      id: s.id,
      title: s.subtitle?.trim() || `${series} Season ${s.number}`,
      competition: series,
      year: s.competitionYear,
      number: s.number,
      division: s.division,
      lifecycle: String(s.lifecycleState),
      bucket,
      publiclyVisible: s.publiclyVisible,
      reconstruction: s.reconstruction,
      completeness: s.dataCompleteness === 'partial' ? 'partial' : 'full',
      entrants: s.entrantsCount,
      href: `/creator/seasons/${s.id}`,
      publicHref: isPublic ? `/seasons/${s.id}` : null,
      warning,
      updatedAt: s.updatedAt.toISOString(),
    })
  }

  for (const t of tournaments) {
    const state = tournamentState(t)
    let bucket: ProjectBucket
    let warning: string | null = null
    if (t.reopenedAt) {
      bucket = 'attention'
      warning = 'Reopened for correction — it has left the Archives and is not counting towards the Rankings until it is completed again.'
    } else if (state === 'COMPLETED') {
      if (!t.archivedAt) {
        bucket = 'attention'
        warning = 'Marked completed but never finalised into the Rankings. It is not archived and does not count.'
      } else bucket = 'completed'
    } else if (t.reconstruction) bucket = 'reconstruction'
    else if (state === 'DRAFT' || state === 'CANCELLED') bucket = 'drafts'
    else if (state === 'REGISTRATION_OPEN' || state === 'REGISTRATION_CLOSED') bucket = 'entrants'
    else bucket = 'active'

    const isPublic = tournamentIsLive(t, t.publiclyVisible) || tournamentIsArchived(t)
    out.push({
      kind: 'tournament',
      id: t.id,
      title: t.name,
      competition: 'Tournament',
      year: t.competitionYear,
      number: null,
      division: null,
      lifecycle: state,
      bucket,
      publiclyVisible: t.publiclyVisible,
      reconstruction: t.reconstruction,
      completeness: t.dataCompleteness === 'partial' ? 'partial' : 'full',
      entrants: t.entrantsCount ?? 0,
      href: `/creator/cups/${t.id}`,
      publicHref: isPublic ? `/cups/${t.number ?? t.id}` : null,
      warning,
      updatedAt: t.updatedAt.toISOString(),
    })
  }

  // Newest work first — Creator is a desk, and what was touched last is what is being worked on.
  return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export const BUCKETS: { id: ProjectBucket; label: string; hint: string }[] = [
  { id: 'attention', label: 'Needs attention', hint: 'Completions that did not finish, and records reopened for correction' },
  { id: 'entrants', label: 'Registration / Entrants', hint: 'Taking entrants now' },
  { id: 'active', label: 'Active', hint: 'Play is under way' },
  { id: 'reconstruction', label: 'Historical reconstructions', hint: 'Being rebuilt by hand from an archive' },
  { id: 'drafts', label: 'Drafts', hint: 'Created, nothing open yet' },
  { id: 'completed', label: 'Completed', hint: 'Finished, finalised and archived' },
]
