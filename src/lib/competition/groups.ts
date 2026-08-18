/** Minimal registration shape the group engine needs (ORM-agnostic, testable). */
export interface SeedableRegistration {
  id: number
  username: string
  seed: number | null
  /**
   * When this entrant was added to the competition.
   *
   * This is the ordering the draw uses. Optional only so older callers and fixtures still typecheck;
   * when absent the autoincrement id carries the same information, because an entrant added later
   * always has a higher id.
   */
  enteredAt?: Date | null
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
 * Entrant order: the order people were added to the competition.
 *
 * The first entrant is first, the second is second, and so on. Two entrants can share a timestamp if
 * they were added in the same instant, so the autoincrement id breaks the tie — and the id alone is a
 * correct fallback, because a later entrant always has a higher one. Either way the result is a total
 * order with no ties, so the draw never depends on the order rows came back from the database.
 *
 * This deliberately ignores the manual `seed` field. That value is playoff seeding; the group draw is
 * by entry order.
 */
export function orderRegistrations(regs: readonly SeedableRegistration[]): SeedableRegistration[] {
  return regs.slice().sort((a, b) => {
    const at = a.enteredAt ? a.enteredAt.getTime() : null
    const bt = b.enteredAt ? b.enteredAt.getTime() : null
    if (at != null && bt != null && at !== bt) return at - bt
    return a.id - b.id
  })
}

/**
 * Distribute approved registrations into `numGroups` using serpentine ("snake") assignment over
 * ENTRANT ORDER — the order people were added to the competition.
 *
 * There is no shuffle. Generating groups twice from the same entrant list produces the same groups,
 * and an organiser reading the entrant list can see in advance where each person will land. That is
 * the point: the draw is predictable and explainable rather than random.
 *
 * Serpentine is kept because it is what keeps group sizes within one of each other and spreads the
 * early entrants across groups instead of packing them into Group A. With three groups, entrants
 * 1-2-3 go A-B-C and entrants 4-5-6 go C-B-A, so the first entrant and the fourth are not both in A.
 *
 * `seed` is still accepted and recorded on the generated groups, because it identifies WHICH draw
 * produced them and existing rows carry it. It no longer influences the result.
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

  const groups: GroupAssignment[] = Array.from({ length: numGroups }, (_, i) => ({
    code: groupCode(i),
    name: `Group ${groupCode(i)}`,
    ordinal: i,
    players: [],
  }))

  // Serpentine assignment: 0..N-1, then N-1..0, repeating.
  ordered.forEach((reg, index) => {
    const pass = Math.floor(index / numGroups)
    const posInPass = index % numGroups
    const groupIdx = pass % 2 === 0 ? posInPass : numGroups - 1 - posInPass
    const g = groups[groupIdx]
    g.players.push({ registrationId: reg.id, username: reg.username, seed: g.players.length + 1 })
  })

  return { seed, groups }
}
