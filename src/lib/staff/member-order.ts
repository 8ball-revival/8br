/**
 * The order members are listed in.
 *
 * ── Why the ordering lives here and not in the query ─────────────────────────────────────────────
 * Two readers need the same answer: the default order the page opens in, and the order a search or a
 * filter leaves behind. Sorting in SQL would give the first one and quietly lose the second, because
 * the filtering happens after the rows arrive. One comparator applied to whatever set survived
 * filtering is the only version that cannot drift.
 *
 * ── Why not localeCompare ────────────────────────────────────────────────────────────────────────
 * `localeCompare` without an explicit locale asks the runtime what alphabet it is using, and
 * Postgres collation asks the database the same question. Neither is guaranteed to answer the same
 * way on this machine as on the deployed one, which is how a list ends up in one order locally and
 * another in production for reasons nobody can see. Case is folded explicitly and the comparison is
 * plain codepoint order, so the result is the same everywhere by construction.
 *
 * ── The rule ─────────────────────────────────────────────────────────────────────────────────────
 * 1. Preferred Name, A–Z, case-insensitive.
 * 2. Members with no Preferred Name after every member who has one — a blank is missing information,
 *    not a name that sorts early, and letting it lead the table buries the people you can identify.
 * 3. CueVerse ID, A–Z, as the tie-break. Every member has one and it is unique, so the order is
 *    total: the same set always renders in the same sequence, with no rows swapping places between
 *    two loads of an unchanged list.
 */

/** Case folded for comparison only; the stored value is never touched. */
export const foldForSort = (v: string | null | undefined): string => (v ?? '').trim().toLowerCase()

/** Plain codepoint order — deliberately not locale-aware. See the note above. */
const codepoint = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

export interface OrderableMember {
  cueverseId?: string | null
  preferredName?: string | null
}

/** The default order: Preferred Name A–Z, blanks last, CueVerse ID as the tie-break. */
export function compareMembersByName(a: OrderableMember, b: OrderableMember): number {
  const an = foldForSort(a.preferredName)
  const bn = foldForSort(b.preferredName)

  // Rule 2 first: a blank loses to any name, whichever name it is.
  if (an && !bn) return -1
  if (!an && bn) return 1

  const byName = codepoint(an, bn)
  if (byName !== 0) return byName

  return codepoint(foldForSort(a.cueverseId), foldForSort(b.cueverseId))
}

/**
 * An explicitly chosen column.
 *
 * Header sorting overrides the default, but only for the column somebody picked: blanks still sort
 * last in both directions, and the CueVerse ID still breaks ties, so reversing the direction cannot
 * shuffle rows that the chosen column says are equal.
 */
export function compareMembersByColumn(
  a: OrderableMember,
  b: OrderableMember,
  column: 'cueverseId' | 'preferredName',
  direction: 'asc' | 'desc',
): number {
  const av = foldForSort(column === 'cueverseId' ? a.cueverseId : a.preferredName)
  const bv = foldForSort(column === 'cueverseId' ? b.cueverseId : b.preferredName)

  if (av && !bv) return -1
  if (!av && bv) return 1

  const cmp = codepoint(av, bv)
  if (cmp !== 0) return direction === 'asc' ? cmp : -cmp

  // The tie-break is not reversed: it exists to make the order total, not to be part of the choice.
  return codepoint(foldForSort(a.cueverseId), foldForSort(b.cueverseId))
}
