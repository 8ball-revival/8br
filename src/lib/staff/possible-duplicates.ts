import 'server-only'
import { prisma } from '@/lib/prisma'

/**
 * Players who might already be the person about to be created.
 *
 * The duplicate that actually happens is not two identical handles — the unique index already
 * refuses those. It is the same person entered twice under handles that differ by punctuation,
 * spacing or case, or a new account whose handle matches an old archive record's NAME because the
 * two fields were once entered the other way round. Both of those slip past an exact-match check
 * and are painful to unpick afterwards, because by then the second identity has results attached.
 *
 * So this looks for near-matches across BOTH identity fields and reports why each one matched. It
 * never blocks anything: the operator is the one who knows whether two similar handles are two
 * people, and a warning they can overrule is worth far more than a rule that stops them entering a
 * roster.
 */

export type DuplicateReason =
  | 'exact-id'
  | 'similar-id'
  | 'id-matches-name'
  | 'name-matches-id'
  | 'similar-name'

export interface PossibleDuplicate {
  playerId: string
  cueverseId: string | null
  preferredName: string | null
  /** Whether an account exists behind this profile. An archive-only profile is a likelier duplicate. */
  hasAccount: boolean
  /** Competitions this profile has actually played in. Zero means it is safe to reuse or merge. */
  played: number
  reason: DuplicateReason
  /** Plain-language explanation, shown next to the row. */
  explanation: string
}

/**
 * Reduce a handle to what a person would consider "the same".
 *
 * Case, spaces, underscores, hyphens and dots all disappear, because `xlx_cerebro_xlx`,
 * `XLX Cerebro XLX` and `xlxcerebroxlx` are one player typed three ways. Digits are kept: `Tyler2`
 * is usually a genuinely different person from `Tyler`.
 */
export function identityKey(value: string | null | undefined): string {
  // Exactly what the SQL prefilter strips, so the two cannot disagree about what "the same" means.
  return (value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
}

const MIN_QUERY = 2
const LIMIT = 8

/**
 * Search for possible duplicates of a handle and/or a name.
 *
 * Deliberately case- and punctuation-insensitive on both fields, and deliberately cross-matched:
 * the CueVerse ID being typed is compared against existing NAMES as well as existing IDs, because
 * the archive contains records whose two fields are the wrong way round and that is exactly how a
 * second identity for one person gets created.
 */
export async function findPossibleDuplicates(
  cueverseId: string,
  preferredName: string,
): Promise<PossibleDuplicate[]> {
  const idRaw = cueverseId.trim()
  const nameRaw = preferredName.trim()
  if (idRaw.length < MIN_QUERY && nameRaw.length < MIN_QUERY) return []

  const idKey = identityKey(idRaw)
  const nameKey = identityKey(nameRaw)

  /*
   * The prefilter normalises IN THE DATABASE.
   *
   * An earlier version filtered on the raw text with `contains` and then normalised in memory, which
   * defeated the entire point: "LVL I G H T Y" never reached the comparison because no raw column
   * contains that string, even though it is the same handle as `lvl_i_g_h_t_y`. Stripping
   * punctuation on both sides of the comparison is the whole feature, so it has to happen before the
   * rows are chosen, not after.
   *
   * `regexp_replace` cannot use a plain index, but the table is small, the page is a staff tool, and
   * a correct answer while typing beats a fast wrong one.
   */
  const keys = [idKey, nameKey].filter((k) => k.length >= MIN_QUERY)
  if (keys.length === 0) return []

  const candidates = await prisma.$queryRawUnsafe<{
    id: string
    cueverseId: string | null
    primaryName: string
    linkedUserId: string | null
  }[]>(
    `SELECT p."id", p."cueverseId", p."primaryName", p."linkedUserId"
       FROM "Player" p
      WHERE ${keys.map((_, i) => `
            regexp_replace(lower(coalesce(p."cueverseId", '')), '[^a-z0-9]', '', 'g') LIKE '%' || $${i + 1} || '%'
         OR regexp_replace(lower(p."primaryName"), '[^a-z0-9]', '', 'g') LIKE '%' || $${i + 1} || '%'
         OR $${i + 1} LIKE '%' || nullif(regexp_replace(lower(coalesce(p."cueverseId", '')), '[^a-z0-9]', '', 'g'), '') || '%'
         OR $${i + 1} LIKE '%' || nullif(regexp_replace(lower(p."primaryName"), '[^a-z0-9]', '', 'g'), '') || '%'`).join(' OR ')}
      LIMIT 50`,
    ...keys,
  )

  /*
   * How much history each candidate carries.
   *
   * `RatingLedger.playerId` is a plain column rather than a relation, so this is a separate grouped
   * count rather than a `_count` include. It matters to the decision: a profile with results behind
   * it is a duplicate worth resolving before creating a second one, while an empty profile can
   * simply be reused.
   */
  const played = new Map<string, number>()
  if (candidates.length) {
    const counts = await prisma.ratingLedger.groupBy({
      by: ['playerId'],
      where: { playerId: { in: candidates.map((c) => c.id) } },
      _count: { _all: true },
    })
    for (const row of counts) played.set(row.playerId, row._count._all)
  }

  const out: PossibleDuplicate[] = []
  for (const c of candidates) {
    const cId = identityKey(c.cueverseId)
    const cName = identityKey(c.primaryName)

    let reason: DuplicateReason | null = null
    let explanation = ''

    if (idKey && cId === idKey) {
      reason = 'exact-id'
      explanation = 'This CueVerse ID already exists.'
    } else if (idKey && cName === idKey) {
      // The archive holds records with the two fields reversed; this is how one person becomes two.
      reason = 'id-matches-name'
      explanation = 'An existing profile uses this as its preferred NAME.'
    } else if (nameKey && cId === nameKey) {
      reason = 'name-matches-id'
      explanation = 'An existing profile uses this name as its CueVerse ID.'
    } else if (idKey && cId && (cId.includes(idKey) || idKey.includes(cId))) {
      reason = 'similar-id'
      explanation = 'A very similar CueVerse ID already exists.'
    } else if (nameKey && cName && (cName.includes(nameKey) || nameKey.includes(cName))) {
      reason = 'similar-name'
      explanation = 'A profile with a very similar name already exists.'
    }

    if (!reason) continue
    out.push({
      playerId: c.id,
      cueverseId: c.cueverseId,
      preferredName: c.primaryName,
      hasAccount: c.linkedUserId != null,
      played: played.get(c.id) ?? 0,
      reason,
      explanation,
    })
  }

  // Strongest signal first: an exact clash, then a reversed-field match, then mere similarity.
  const RANK: Record<DuplicateReason, number> = {
    'exact-id': 0, 'id-matches-name': 1, 'name-matches-id': 2, 'similar-id': 3, 'similar-name': 4,
  }
  out.sort((a, b) => RANK[a.reason] - RANK[b.reason] || b.played - a.played)
  return out.slice(0, LIMIT)
}
