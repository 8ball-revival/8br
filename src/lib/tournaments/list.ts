import type { CompetitionPlatform } from '@prisma/client'
import 'server-only'
import { prisma } from '@/lib/prisma'
import { resolveIdentity } from '@/lib/stats/identity'
import { TOURNAMENT_ORDER } from '@/lib/competition/competition-year'

/**
 * Enriched TournamentView list + structured search index, read from the DATABASE (source of
 * truth). Powers the searchable public tournaments page: each row's metadata plus a
 * de-duplicated participant index (resolved via the identity resolver) so a search
 * for a player / alias / team / champion returns every TournamentView they were part of, with
 * the relationship. No private/account data is included.
 */

const nk = (s?: string | null) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '')

export type Relationship = 'Champion' | 'Runner-up' | 'Third place' | 'Team member' | 'Participant' | 'Team'
const RANK: Record<Relationship, number> = { Champion: 5, 'Runner-up': 4, 'Third place': 3, 'Team member': 2, Participant: 1, Team: 1 }

export interface TournamentParticipant { display: string; keys: string[]; relationship: Relationship }
export interface TournamentListItem {
  number: number
  code: string
  name: string
  /** The Competition this Tournament belongs to, by name. */
  competitionName: string | null
  /**
   * The COMPETITION year, not the year the row happened to be inserted.
   *
   * This used to be `createdAt.getUTCFullYear()`, so every imported Tournament — including the 2006
   * ones — announced itself as the year the import ran. A record's year is a fact about the
   * competition, and the column that holds it is `competitionYear`.
   */
  year: number | null
  /** Which platform it was played on — Yahoo history, or CueVerse present. */
  platform: CompetitionPlatform
  date: string | null
  status: string // "completed" | "live"
  gameType: string | null
  participantFormat: string // INDIVIDUAL | TEAM
  teamSize: number | null
  tournamentFormat: string | null
  entrantsCount: number | null
  currentRound: string | null
  champion: { name: string; handle: string | null } | null
  runnerUp: { name: string; handle: string | null } | null
  locked: boolean
  participants: TournamentParticipant[]
  searchBlob: string
}

export async function getTournamentList(): Promise<TournamentListItem[]> {
  const comps = await prisma.tournament.findMany({
    orderBy: TOURNAMENT_ORDER,
    include: { bracketMatches: true, competitionSeries: { select: { name: true } } },
  })

  return comps.map((c) => {
    // Build the de-duplicated participant index (by canonical identity).
    const byKey = new Map<string, TournamentParticipant>()
    const add = (name?: string | null, handle?: string | null, rel: Relationship = 'Participant') => {
      if (!name && !handle) return
      const id = resolveIdentity(handle ?? undefined, name ?? undefined, { useArchiveMap: false })
      const canonKey = id?.ok ? id.id : nk(handle) || nk(name)
      const keys = [nk(name), nk(handle), id?.ok ? nk(id.name) : ''].filter(Boolean)
      const display = name ?? handle ?? ''
      const existing = byKey.get(canonKey)
      if (existing) {
        if (RANK[rel] > RANK[existing.relationship]) existing.relationship = rel
        for (const k of keys) if (!existing.keys.includes(k)) existing.keys.push(k)
      } else {
        byKey.set(canonKey, { display, keys, relationship: rel })
      }
    }

    const isTeam = c.participantFormat === 'TEAM'
    // Bracket slot participants.
    for (const m of c.bracketMatches) {
      if (m.aName && m.aName !== 'Bye') add(m.aName, m.aHandle, isTeam ? 'Team' : 'Participant')
      if (m.bName && m.bName !== 'Bye') add(m.bName, m.bHandle, isTeam ? 'Team' : 'Participant')
    }
    // Champion / runner-up / third override the relationship for the matching entry.
    add(c.championName, c.championHandle, 'Champion')
    add(c.runnerUpName, c.runnerUpHandle, 'Runner-up')
    add(c.thirdPlaceName, c.thirdPlaceHandle, 'Third place')

    const participants = [...byKey.values()]
    const year = c.competitionYear ?? c.createdAt.getUTCFullYear()
    const searchBlob = [
      c.name, `#${c.number}`, c.code, c.gameType, c.tournamentFormat, c.participantFormat,
      year, c.championName, c.runnerUpName, ...participants.flatMap((p) => [p.display, ...p.keys]),
    ].filter(Boolean).join(' ').toLowerCase()

    return {
      number: c.number ?? 0,
      code: c.code ?? '',
      name: c.name,
      competitionName: c.competitionSeries?.name ?? null,
      year,
      platform: c.platform,
      date: null,
      status: c.lifecycleState === 'COMPLETED' || c.status === 'COMPLETED' ? 'completed' : 'live',
      gameType: c.gameType,
      participantFormat: c.participantFormat,
      teamSize: c.teamSize,
      tournamentFormat: c.tournamentFormat,
      entrantsCount: c.entrantsCount,
      currentRound: c.currentRound,
      champion: c.championName ? { name: c.championName, handle: c.championHandle } : null,
      runnerUp: c.runnerUpName ? { name: c.runnerUpName, handle: c.runnerUpHandle } : null,
      locked: false,
      participants,
      searchBlob,
    }
  })
}
