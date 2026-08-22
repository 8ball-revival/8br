/**
 * A content fingerprint of one Season, for proving a rerun changed nothing.
 *
 * Row counts alone would miss a value being rewritten in place, so this hashes the actual
 * competition content — who is entered, which group they are in, every score, every standing and
 * every bracket position — alongside the audit trail, because a no-op that still writes an audit
 * entry is not a no-op.
 *
 * Usage: tsx scripts/archive-season-fingerprint.mts <seasonId>
 */
import { createHash } from 'node:crypto'

import { prisma } from '../src/lib/prisma.ts'
import { assertLocalDatabase } from '../src/lib/db-guard.ts'

assertLocalDatabase()

const seasonId = Number(process.argv[2])
if (!Number.isFinite(seasonId)) throw new Error('pass a season id')

export async function fingerprint(id: number) {
  const season = await prisma.season.findUniqueOrThrow({
    where: { id },
    select: { lifecycleState: true, championName: true, ladderAppliedAt: true, entrantsCount: true },
  })
  const entrants = await prisma.seasonEntrant.findMany({
    where: { seasonId: id },
    select: { cueverseId: true, status: true, playoffIncluded: true, playoffSeed: true, qualification: true },
    orderBy: [{ cueverseId: 'asc' }],
  })
  const groups = await prisma.seasonGroup.findMany({
    where: { seasonId: id },
    select: { code: true, name: true, published: true, players: { select: { entrantId: true, seed: true } } },
    orderBy: { code: 'asc' },
  })
  const matches = await prisma.seasonMatch.findMany({
    where: { seasonId: id },
    select: { id: true, homeEntrantId: true, awayEntrantId: true, homeGames: true, awayGames: true, status: true, forfeitEntrantId: true },
    orderBy: { id: 'asc' },
  })
  const standings = await prisma.seasonStanding.findMany({
    where: { seasonId: id },
    select: { username: true, played: true, wins: true, losses: true, draws: true, points: true, rank: true },
    orderBy: [{ username: 'asc' }],
  })
  const playoff = await prisma.seasonPlayoffMatch.findMany({
    where: { seasonId: id },
    select: { slot: true, homeEntrantId: true, awayEntrantId: true, winnerEntrantId: true },
    orderBy: { slot: 'asc' },
  })
  const audits = await prisma.auditLog.count({ where: { entity: 'Season', entityId: String(id) } })
  const ledger = await prisma.ratingLedger.count({ where: { seasonId: id } })

  const blob = JSON.stringify({ season, entrants, groups, matches, standings, playoff })
  return {
    hash: createHash('sha256').update(blob).digest('hex').slice(0, 32),
    counts: {
      entrants: entrants.length, groups: groups.length,
      groupPlayers: groups.reduce((a, g) => a + g.players.length, 0),
      matches: matches.length, withScores: matches.filter((m) => m.homeGames !== null).length,
      standings: standings.length, playoffSlots: playoff.length,
      playoffSeated: playoff.filter((p) => p.homeEntrantId || p.awayEntrantId).length,
      audits, ledger,
    },
    state: season.lifecycleState,
  }
}

console.log(JSON.stringify(await fingerprint(seasonId)))
await prisma.$disconnect()
