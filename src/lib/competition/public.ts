import 'server-only'
import type { Season } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { formatDate } from '@/lib/format'
import { getActiveSeason } from './queries'
import { resolveEntrants, ENTRANT_SELECT } from './entrants'

export type PublicSeason = Season

/** The season the public site presents (null when none has been created yet). */
export async function getPublicSeason(): Promise<PublicSeason | null> {
  return getActiveSeason()
}

export interface PublicRegistrant {
  displayName: string // Preferred Name (public community name)
  cueverseId: string | null
  slug: string | null // linked profile's CueVerse ID → /players/[slug]; null when unlinked
  registeredAt: string
}

/**
 * ACTIVE (APPROVED) registrations for the current season — the live public entrant
 * list. Active immediately (no staff approval). When a registration's account has
 * been linked to a canonical profile, the entrant resolves to that profile's public
 * identity; otherwise the submitted registration name + CueVerse ID is shown.
 *
 * PUBLIC IDENTITY ONLY: exactly Display Name + CueVerse ID. Email, account User ID,
 * Discord, passwords, sessions, staff notes, and internal IDs are NEVER selected or
 * returned — a free-text field (e.g. Discord) can hold an email, so it is not
 * exposed here at all. Staff surfaces read the raw registration separately.
 */
export async function getPublicRegistrations(): Promise<PublicRegistrant[]> {
  const season = await getActiveSeason()
  if (!season) return []
  const regs = await prisma.registration.findMany({
    where: { seasonId: season.id, status: 'APPROVED' },
    orderBy: { createdAt: 'asc' },
    select: { username: true, displayName: true, cueverseId: true, playerId: true, createdAt: true },
  })
  const pids = [...new Set(regs.map((r) => r.playerId).filter((x): x is string => !!x))]
  const profiles = pids.length
    ? await prisma.player.findMany({ where: { id: { in: pids } }, select: { id: true, primaryName: true, cueverseId: true } })
    : []
  const pmap = new Map(profiles.map((p) => [p.id, p]))
  return regs.map((r) => {
    const p = r.playerId ? pmap.get(r.playerId) : null
    // Public identity = Preferred Name (CueVerse ID), resolved live from the linked profile.
    // Manual/unlinked entrants keep the identity they submitted. Never any private field.
    const cueverseId = p?.cueverseId ?? r.cueverseId ?? null
    return {
      displayName: p?.primaryName ?? r.displayName ?? r.cueverseId ?? r.username,
      cueverseId,
      slug: p?.cueverseId ?? null,
      registeredAt: r.createdAt.toISOString(),
    }
  })
}

export interface PublicGroupPlayer {
  registrationId: number
  seed: number
  displayName: string
  cueverseId: string | null
  slug: string | null
}
export interface PublicGroupStanding {
  registrationId: number
  displayName: string
  cueverseId: string | null
  slug: string | null
  rank: number
  played: number
  wins: number
  losses: number
  gamesWon: number
  gamesLost: number
  gameDiff: number
  points: number
  qualified: boolean
}
export interface PublicGroupFixture {
  id: number
  round: number
  homeRegistrationId: number
  awayRegistrationId: number
  homeName: string
  awayName: string
  homeGames: number | null
  awayGames: number | null
  status: string
  decided: boolean
  winner: 'home' | 'away' | null
}
export interface PublicGroupView {
  id: number
  code: string
  name: string
  ordinal: number
  players: PublicGroupPlayer[]
  standings: PublicGroupStanding[]
  fixtures: PublicGroupFixture[]
  hasResults: boolean
}

/**
 * PUBLISHED season groups for the public site. Every player, standing row, and
 * fixture is resolved to the entrant's PUBLIC identity (canonical Player profile
 * when linked, else the submitted registration name + CueVerse ID). DRAFT groups
 * are never returned. Account User IDs, email, Discord, and all private account
 * data are never selected or exposed — only display names + CueVerse IDs appear.
 */
export async function getPublicGroups(seasonId: number): Promise<PublicGroupView[]> {
  const groups = await prisma.seasonGroup.findMany({
    where: { seasonId, published: true },
    orderBy: { ordinal: 'asc' },
    include: {
      players: { orderBy: { seed: 'asc' }, include: { registration: { select: ENTRANT_SELECT } } },
      standings: { orderBy: { rank: 'asc' } },
      matches: { orderBy: [{ round: 'asc' }, { id: 'asc' }] },
    },
  })
  if (groups.length === 0) return []

  const regs = groups.flatMap((g) => g.players.map((p) => p.registration))
  const identities = await resolveEntrants(regs)
  const nameOf = (registrationId: number, fallback: string) => identities.get(registrationId)?.displayName ?? fallback

  return groups.map((g) => ({
    id: g.id,
    code: g.code,
    name: g.name,
    ordinal: g.ordinal,
    players: g.players.map((p) => ({
      registrationId: p.registrationId,
      seed: p.seed,
      displayName: nameOf(p.registrationId, p.registration.username),
      cueverseId: identities.get(p.registrationId)?.cueverseId ?? null,
      slug: identities.get(p.registrationId)?.slug ?? null,
    })),
    standings: g.standings.map((s) => ({
      registrationId: s.registrationId,
      displayName: nameOf(s.registrationId, s.username),
      cueverseId: identities.get(s.registrationId)?.cueverseId ?? null,
      slug: identities.get(s.registrationId)?.slug ?? null,
      rank: s.rank,
      played: s.played,
      wins: s.wins,
      losses: s.losses,
      gamesWon: s.gamesWon,
      gamesLost: s.gamesLost,
      gameDiff: s.gameDiff,
      points: s.points,
      qualified: s.qualified,
    })),
    fixtures: g.matches.map((m) => ({
      id: m.id,
      round: m.round,
      homeRegistrationId: m.homeRegistrationId,
      awayRegistrationId: m.awayRegistrationId,
      homeName: nameOf(m.homeRegistrationId, m.homeUsername),
      awayName: nameOf(m.awayRegistrationId, m.awayUsername),
      homeGames: m.homeGames,
      awayGames: m.awayGames,
      status: m.status,
      decided: m.winnerRegistrationId != null,
      winner: m.winnerRegistrationId == null ? null : m.winnerRegistrationId === m.homeRegistrationId ? 'home' : 'away',
    })),
    hasResults: g.matches.some((m) => m.winnerRegistrationId != null),
  }))
}

export function isRegistrationOpen(s: Pick<Season, 'registrationStatus'> | null): boolean {
  return s?.registrationStatus === 'OPEN'
}

export function registrationDeadlineLabel(s: Pick<Season, 'registrationClosesAt'> | null): string {
  if (s?.registrationClosesAt) return `Registration closes ${formatDate(s.registrationClosesAt.toISOString())}`
  return 'Registration deadline to be announced'
}
