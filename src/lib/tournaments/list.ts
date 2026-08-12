import 'server-only'
import { prisma } from '@/lib/prisma'
import { resolveIdentity } from '@/lib/stats/identity'

/**
 * Enriched Cup list + structured search index, read from the DATABASE (source of
 * truth). Powers the searchable public Cups page: each row's metadata plus a
 * de-duplicated participant index (resolved via the identity resolver) so a search
 * for a player / alias / team / champion returns every Cup they were part of, with
 * the relationship. No private/account data is included.
 */

const nk = (s?: string | null) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '')

export type Relationship = 'Champion' | 'Runner-up' | 'Third place' | 'Team member' | 'Participant' | 'Team'
const RANK: Record<Relationship, number> = { Champion: 5, 'Runner-up': 4, 'Third place': 3, 'Team member': 2, Participant: 1, Team: 1 }

export interface CupParticipant { display: string; keys: string[]; relationship: Relationship }
export interface CupListItem {
  number: number
  code: string
  name: string
  year: number | null
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
  participants: CupParticipant[]
  searchBlob: string
}

export async function getCupList(): Promise<CupListItem[]> {
  const comps = await prisma.tournament.findMany({
    where: { competitionType: 'CUP' },
    orderBy: { cupNumber: 'asc' },
    include: { cupBracketMatches: true, cupTeamTies: { include: { matches: true } } },
  })

  return comps.map((c) => {
    // Build the de-duplicated participant index (by canonical identity).
    const byKey = new Map<string, CupParticipant>()
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
    for (const m of c.cupBracketMatches) {
      if (m.aName && m.aName !== 'Bye') add(m.aName, m.aHandle, isTeam ? 'Team' : 'Participant')
      if (m.bName && m.bName !== 'Bye') add(m.bName, m.bHandle, isTeam ? 'Team' : 'Participant')
    }
    // Team tie players (individuals) + team names.
    const teamNames = new Set<string>()
    for (const tie of c.cupTeamTies) {
      teamNames.add(tie.homeTeam); teamNames.add(tie.awayTeam)
      for (const tm of tie.matches) { add(tm.homeName, tm.homeHandle, 'Team member'); add(tm.awayName, tm.awayHandle, 'Team member') }
    }
    for (const t of teamNames) add(t, null, 'Team')
    // Champion / runner-up / third override the relationship for the matching entry.
    add(c.championName, c.championHandle, 'Champion')
    add(c.runnerUpName, c.runnerUpHandle, 'Runner-up')
    add(c.thirdPlaceName, c.thirdPlaceHandle, 'Third place')

    const participants = [...byKey.values()]
    const searchBlob = [
      c.name, `#${c.cupNumber}`, c.competitionCode, c.gameType, c.cupFormatBadge, c.tournamentFormat, c.participantFormat,
      c.cupYear, c.championName, c.runnerUpName, ...participants.flatMap((p) => [p.display, ...p.keys]),
    ].filter(Boolean).join(' ').toLowerCase()

    return {
      number: c.cupNumber!,
      code: c.competitionCode!,
      name: c.name,
      year: c.cupYear,
      date: c.cupDate,
      status: c.cupStatus ?? 'completed',
      gameType: c.gameType,
      participantFormat: c.participantFormat,
      teamSize: c.teamSize,
      tournamentFormat: c.tournamentFormat,
      entrantsCount: c.entrantsCount,
      currentRound: c.currentRound,
      champion: c.championName ? { name: c.championName, handle: c.championHandle } : null,
      runnerUp: c.runnerUpName ? { name: c.runnerUpName, handle: c.runnerUpHandle } : null,
      locked: c.locked,
      participants,
      searchBlob,
    }
  })
}
