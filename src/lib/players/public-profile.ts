import 'server-only'
import { prisma } from '@/lib/prisma'

/**
 * Live public Player profile resolver. The public profile slug is the player's CueVerse ID
 * (already URL-safe: [a-z0-9_.-]); we resolve case-insensitively to the canonical Player.
 * Returns ONLY public fields — never email. Stats (ranking / career) are attached by the
 * page from the shared services when the profile has a canonical stats id.
 */

export interface LivePublicProfile {
  playerId: string
  legacyPlayerId: string | null
  preferredName: string
  cueverseId: string | null
  timeZone: string | null
  discord: string | null
  aliases: string[]
  competitions: { season: string; status: string; kind: string }[]
}

export async function getLivePublicProfile(slug: string): Promise<LivePublicProfile | null> {
  const cueverseId = decodeURIComponent(slug).trim()
  if (!cueverseId) return null
  const player = await prisma.player.findFirst({
    where: { cueverseId: { equals: cueverseId, mode: 'insensitive' } },
    include: { aliases: { select: { alias: true } } },
  })
  if (!player) return null

  // Live competition entries for this profile (by linked account OR canonical profile).
  const linkedUserId = player.linkedUserId ? Number(player.linkedUserId) : null
  const regs = await prisma.registration.findMany({
    where: { OR: [{ playerId: player.id }, ...(linkedUserId ? [{ userId: linkedUserId }] : [])] },
    include: { season: { select: { name: true, competitionType: true } } },
    orderBy: { createdAt: 'desc' },
  })

  return {
    playerId: player.id,
    legacyPlayerId: player.legacyPlayerId,
    preferredName: player.primaryName,
    cueverseId: player.cueverseId,
    timeZone: player.timeZone,
    discord: player.discord,
    aliases: [...new Set(player.aliases.map((a) => a.alias))].slice(0, 24),
    competitions: regs.map((r) => ({ season: r.season.name, status: r.status, kind: r.season.competitionType })),
  }
}
