import 'server-only'
import type { Prisma } from '@prisma/client'

/**
 * Playoff seeding: assigning it, persisting it, and refusing to persist a broken one.
 *
 * A seed belongs to the PLAYER, not to the bracket slot they happen to occupy. That distinction is
 * the whole point of this module. Seeds used to live only on the match rows, so moving a player
 * between slots re-read the seed from a column that was never populated and quietly wrote null —
 * which is how Season 1 ended up displaying two seeds out of sixteen. Storing the seed on the
 * entrant means it survives every swap, reassignment and round, because nothing about a slot can
 * change who a player is.
 */

/** A player in the bracket, in the order the group results put them. */
export interface SeedInput {
  entrantId: number
  /** Position in the group-derived order; lower is better. Gaps are fine — see `assignSeeds`. */
  order: number
}

export interface SeedAssignment {
  entrantId: number
  seed: number
}

export class SeedingError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SeedingError'
  }
}

/**
 * Turn a group-derived ORDER into bracket seeds 1..N.
 *
 * The order comes from the group stage and nothing else. This only densifies it: the player ranked
 * highest among those actually in the bracket is seed 1, the next is 2, and so on. Relative order is
 * never altered, so leaving a player out cannot promote anyone above anyone else — it only closes
 * the gap their absence would otherwise leave in the numbering.
 */
export function assignSeeds(players: SeedInput[]): SeedAssignment[] {
  const sorted = [...players].sort((a, b) => a.order - b.order || a.entrantId - b.entrantId)
  return sorted.map((p, i) => ({ entrantId: p.entrantId, seed: i + 1 }))
}

/**
 * Reject anything that is not a complete, unique 1..N set.
 *
 * Called before the seeds are written and again after, so a partial write cannot survive. Byes need
 * no special handling: a bye is an empty slot, not a competitor, so it never holds a seed and never
 * counts towards N.
 */
export function validateSeedSet(assignments: SeedAssignment[], expectedCount?: number): void {
  const n = expectedCount ?? assignments.length

  if (assignments.length !== n) {
    throw new SeedingError(`Seeding is incomplete: ${assignments.length} seeds for ${n} players.`)
  }

  const seen = new Set<number>()
  for (const { entrantId, seed } of assignments) {
    if (!Number.isInteger(seed)) {
      throw new SeedingError(`Seed for entrant ${entrantId} is not a whole number (${seed}).`)
    }
    if (seed < 1 || seed > n) {
      throw new SeedingError(`Seed ${seed} for entrant ${entrantId} is outside the valid range 1..${n}.`)
    }
    if (seen.has(seed)) {
      throw new SeedingError(`Seed ${seed} is assigned to more than one player.`)
    }
    seen.add(seed)
  }

  // Unique + in range + right count already implies completeness, but assert it directly so the
  // error names the actual gap rather than leaving the caller to work it out.
  const missing: number[] = []
  for (let i = 1; i <= n; i++) if (!seen.has(i)) missing.push(i)
  if (missing.length) {
    throw new SeedingError(`Seeding is missing ${missing.length} seed(s): ${missing.join(', ')}.`)
  }

  const entrants = new Set(assignments.map((a) => a.entrantId))
  if (entrants.size !== assignments.length) {
    throw new SeedingError('The same player appears twice in the seeding.')
  }
}

/**
 * Write a validated seed set to the entrants, inside the caller's transaction.
 *
 * Validated before AND after writing: the second pass reads the rows back, so a write that only
 * partly landed throws and takes the surrounding transaction — bracket rows included — down with it.
 * A bracket with half a seed set is worse than no bracket at all, because it looks finished.
 */
export async function persistSeeds(
  tx: Prisma.TransactionClient,
  seasonId: number,
  assignments: SeedAssignment[],
): Promise<void> {
  validateSeedSet(assignments)

  // Clear first, so a player dropped from the bracket cannot keep a stale seed.
  await tx.seasonEntrant.updateMany({ where: { seasonId }, data: { playoffSeed: null } })
  for (const { entrantId, seed } of assignments) {
    await tx.seasonEntrant.update({ where: { id: entrantId }, data: { playoffSeed: seed } })
  }

  const written = await tx.seasonEntrant.findMany({
    where: { seasonId, playoffSeed: { not: null } },
    select: { id: true, playoffSeed: true },
  })
  validateSeedSet(
    written.map((w) => ({ entrantId: w.id, seed: w.playoffSeed! })),
    assignments.length,
  )
}

/** Every entrant's persisted seed, for rendering. Absent players simply have none. */
export async function seedsByEntrant(
  db: Prisma.TransactionClient | { seasonEntrant: { findMany: Prisma.TransactionClient['seasonEntrant']['findMany'] } },
  seasonId: number,
): Promise<Map<number, number>> {
  const rows = await db.seasonEntrant.findMany({
    where: { seasonId, playoffSeed: { not: null } },
    select: { id: true, playoffSeed: true },
  })
  return new Map(rows.map((r) => [r.id, r.playoffSeed!]))
}
