import { seededShuffle } from './prng'

/** Minimal registration shape the group engine needs (ORM-agnostic, testable). */
export interface SeedableRegistration {
  id: number
  username: string
  seed: number | null
}

export interface GroupAssignmentPlayer {
  registrationId: number
  username: string
  /** 1-based seed within the group. */
  seed: number
}

export interface GroupAssignment {
  code: string // "A", "B", ...
  name: string // "Group A"
  ordinal: number // 0-based
  players: GroupAssignmentPlayer[]
}

export interface GroupPlan {
  seed: string
  groups: GroupAssignment[]
}

/** A, B, …, Z, AA, AB, … for group codes. */
export function groupCode(ordinal: number): string {
  let n = ordinal
  let code = ''
  do {
    code = String.fromCharCode(65 + (n % 26)) + code
    n = Math.floor(n / 26) - 1
  } while (n >= 0)
  return code
}

/**
 * Deterministic base ordering: explicit manual seed first (ascending), then
 * username (case-insensitive), then id — a total order with no ties, so the
 * result never depends on input order or wall-clock.
 */
export function orderRegistrations(regs: readonly SeedableRegistration[]): SeedableRegistration[] {
  return regs.slice().sort((a, b) => {
    const as = a.seed ?? Number.POSITIVE_INFINITY
    const bs = b.seed ?? Number.POSITIVE_INFINITY
    if (as !== bs) return as - bs
    const an = a.username.toLowerCase()
    const bn = b.username.toLowerCase()
    if (an !== bn) return an < bn ? -1 : 1
    return a.id - b.id
  })
}

/**
 * Distribute approved registrations into `numGroups` using serpentine ("snake")
 * seeding over a deterministic ordering — balanced group sizes (differ by at most
 * one) and evenly spread seeds. Reproducible: the same (registrations, numGroups,
 * seed) always produces the same plan, and the seed is returned for recording.
 *
 * `seed` (a recorded string) shuffles the base order deterministically so groups
 * are not simply alphabetical, while remaining fully replayable.
 */
export function planGroups(
  registrations: readonly SeedableRegistration[],
  numGroups: number,
  seed: string,
): GroupPlan {
  if (numGroups < 1) throw new Error('numGroups must be at least 1')
  if (registrations.length < numGroups)
    throw new Error('Not enough players for the requested number of groups')

  const ordered = orderRegistrations(registrations)
  const shuffled = seededShuffle(ordered, seed)

  const groups: GroupAssignment[] = Array.from({ length: numGroups }, (_, i) => ({
    code: groupCode(i),
    name: `Group ${groupCode(i)}`,
    ordinal: i,
    players: [],
  }))

  // Serpentine assignment: 0..N-1, then N-1..0, repeating.
  shuffled.forEach((reg, index) => {
    const pass = Math.floor(index / numGroups)
    const posInPass = index % numGroups
    const groupIdx = pass % 2 === 0 ? posInPass : numGroups - 1 - posInPass
    const g = groups[groupIdx]
    g.players.push({ registrationId: reg.id, username: reg.username, seed: g.players.length + 1 })
  })

  return { seed, groups }
}
