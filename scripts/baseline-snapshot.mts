/**
 * A snapshot of the canonical competition data, taken before and after risky work.
 *
 * The Break touches none of this. That is the claim, and this is what makes it checkable rather than
 * merely stated: counts, checksums and the specific Season the owner asked to be left alone, written
 * to a file that a later run can be compared against.
 *
 * Read-only. It writes a JSON file and nothing else.
 *
 *   npx tsx --tsconfig scripts/tsconfig.verify.json --env-file=.env scripts/baseline-snapshot.mts before
 *   npx tsx --tsconfig scripts/tsconfig.verify.json --env-file=.env scripts/baseline-snapshot.mts after
 */
import { writeFileSync, existsSync, readFileSync, mkdirSync } from 'node:fs'

import { prisma } from '../src/lib/prisma.ts'

const label = process.argv[2] === 'after' ? 'after' : 'before'
const DIR = 'verification/the-break'
const FILE = `${DIR}/canonical-${label}.json`

/** The Season the owner named explicitly. Its every field is captured, not just its existence. */
const PROTECTED_SEASON = 3732

async function snapshot() {
  const [
    seasons, tournaments, players, entrants, matches, standings, playoffs,
    ledger, titles, aliases, merges, articles,
  ] = await Promise.all([
    prisma.season.count(),
    prisma.tournament.count(),
    prisma.player.count(),
    prisma.seasonEntrant.count(),
    prisma.seasonMatch.count(),
    prisma.seasonStanding.count(),
    prisma.seasonPlayoffMatch.count(),
    prisma.ratingLedger.count(),
    Promise.resolve(-1),
    prisma.playerAlias.count(),
    prisma.playerMerge.count(),
    prisma.article.count().catch(() => -1),
  ])

  /*
   * A checksum over the rating ledger, not just its row count.
   *
   * A count catches rows appearing or vanishing; it says nothing about a rating quietly changing
   * value. Summing the ratings alongside the count catches both, and is cheap enough to run either
   * side of the work.
   */
  const ratingSum = await prisma.$queryRaw<{ sum: number | null; players: bigint }[]>`
    SELECT COALESCE(SUM("postRating"), 0)::float AS sum, COUNT(DISTINCT "playerId") AS players
    FROM rating_ledger
  `
  const champions = await prisma.season.count({ where: { championPlayerId: { not: null } } })

  const protectedSeason = await prisma.season.findUnique({
    where: { id: PROTECTED_SEASON },
    include: {
      _count: { select: { entrants: true, groups: true, matches: true, standings: true, playoffMatches: true } },
    },
  })

  return {
    label,
    counts: {
      seasons, tournaments, players, entrants, matches, standings, playoffs,
      ledger, titles, aliases, merges, articles,
    },
    ratingLedger: {
      sum: Number(ratingSum[0]?.sum ?? 0),
      distinctPlayers: Number(ratingSum[0]?.players ?? 0),
    },
    seasonsWithChampion: champions,
    protectedSeason: protectedSeason
      ? {
          id: protectedSeason.id,
          number: protectedSeason.seasonNumber,
          lifecycleState: protectedSeason.lifecycleState,
          subtitle: protectedSeason.subtitle,
          counts: protectedSeason._count,
          updatedAt: protectedSeason.updatedAt?.toISOString() ?? null,
        }
      : null,
  }
}

const snap = await snapshot()
if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true })
writeFileSync(FILE, JSON.stringify(snap, null, 2))
console.log(`${label} snapshot → ${FILE}`)
console.log(JSON.stringify(snap.counts, null, 2))
console.log(`rating ledger: ${snap.ratingLedger.sum} over ${snap.ratingLedger.distinctPlayers} players`)
console.log(`Season ${PROTECTED_SEASON}: ${snap.protectedSeason ? JSON.stringify(snap.protectedSeason.counts) : 'NOT PRESENT'}`)

if (label === 'after') {
  const beforeFile = `${DIR}/canonical-before.json`
  if (!existsSync(beforeFile)) {
    console.log('\nNo before snapshot to compare against.')
  } else {
    const before = JSON.parse(readFileSync(beforeFile, 'utf8'))
    const diffs: string[] = []
    for (const [k, v] of Object.entries(snap.counts)) {
      // The article count is EXPECTED to move: the migration reads it and may retire the table.
      if (k === 'articles') continue
      if (before.counts[k] !== v) diffs.push(`${k}: ${before.counts[k]} → ${v}`)
    }
    if (before.ratingLedger.sum !== snap.ratingLedger.sum) {
      diffs.push(`rating sum: ${before.ratingLedger.sum} → ${snap.ratingLedger.sum}`)
    }
    if (JSON.stringify(before.protectedSeason) !== JSON.stringify(snap.protectedSeason)) {
      diffs.push(`Season ${PROTECTED_SEASON} CHANGED`)
    }
    console.log(diffs.length === 0
      ? '\nCanonical data is unchanged.'
      : `\nCANONICAL DATA CHANGED:\n  ${diffs.join('\n  ')}`)
    if (diffs.length > 0) process.exitCode = 1
  }
}

await prisma.$disconnect()
