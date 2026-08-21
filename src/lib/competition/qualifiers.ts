import 'server-only'

import { prisma } from '@/lib/prisma'
import { recordAudit, type Actor } from './audit'
import { recomputeStandings } from './service'

/**
 * Who goes through to the playoffs — the calculation, and the administrator's right to disagree.
 *
 * ── Why an override exists at all ────────────────────────────────────────────────────────────────
 * The top-N-per-group calculation is right for a Tournament being played. It is not always right for
 * one being reconstructed: the archive records who actually advanced, and that occasionally differs
 * from what the points would pick — a withdrawal, a tiebreak settled by a rule nobody wrote down, a
 * decision taken on the night. Forcing the reconstruction to match the arithmetic would mean
 * recording something that did not happen.
 *
 * ── Why it lives on the entrant ──────────────────────────────────────────────────────────────────
 * `recomputeStandings` deletes and rebuilds every standings row each time a result is entered. An
 * override stored on the standing would survive exactly until the next score. On the Registration it
 * is durable, and it re-applies on every recompute.
 *
 * Null means nobody has said anything, so the calculation stands. True and false are deliberate.
 */

export interface QualifierRow {
  registrationId: number
  username: string
  groupCode: string
  groupName: string
  rank: number
  points: number
  record: string
  /** What the points alone would decide. */
  calculated: boolean
  /** The administrator's answer, when they have given one. */
  override: boolean | null
  /** What will actually happen — the override when present, else the calculation. */
  effective: boolean
}

/** Every entrant with a standing, and whether they are going through. */
export async function listQualifiers(tournamentId: number): Promise<QualifierRow[]> {
  const groups = await prisma.tournamentGroup.findMany({
    where: { tournamentId },
    orderBy: { ordinal: 'asc' },
    include: {
      standings: { orderBy: { rank: 'asc' } },
      players: { include: { registration: { select: { id: true, qualifierOverride: true } } } },
    },
  })
  const overrideOf = new Map<number, boolean | null>()
  for (const g of groups) for (const p of g.players) overrideOf.set(p.registrationId, p.registration.qualifierOverride)

  const t = await prisma.tournament.findUnique({ where: { id: tournamentId }, select: { qualifiersPerGroup: true } })
  const perGroup = t?.qualifiersPerGroup ?? 2

  const out: QualifierRow[] = []
  for (const g of groups) {
    for (const s of g.standings) {
      // The calculation is re-derived from rank rather than read back off `qualified`, because
      // `qualified` already has any override folded into it — asking it what the points said would
      // be asking it to remember something it no longer knows.
      const calculated = s.rank > 0 && s.rank <= perGroup
      const override = overrideOf.get(s.registrationId) ?? null
      out.push({
        registrationId: s.registrationId,
        username: s.username,
        groupCode: g.code,
        groupName: g.name,
        rank: s.rank,
        points: s.points,
        record: `${s.wins}-${s.losses}${s.draws > 0 ? `-${s.draws}` : ''}`,
        calculated,
        override,
        effective: override ?? calculated,
      })
    }
  }
  return out
}

/**
 * Set or clear one entrant's override, then recompute so the standings agree with it immediately.
 *
 * `null` clears it and hands the decision back to the calculation — which is the difference between
 * "not going through" and "I have not said", and why this is a tri-state rather than a checkbox
 * pretending to be one.
 */
export async function setQualifierOverride(
  actor: Actor,
  tournamentId: number,
  registrationId: number,
  override: boolean | null,
): Promise<{ ok: boolean; error?: string }> {
  const reg = await prisma.registration.findFirst({
    where: { id: registrationId, tournamentId },
    select: { id: true, username: true, qualifierOverride: true },
  })
  if (!reg) return { ok: false, error: 'That entrant is not in this Tournament.' }

  await prisma.registration.update({ where: { id: registrationId }, data: { qualifierOverride: override } })
  await recomputeStandings(tournamentId)
  await recordAudit(actor, {
    action: 'tournament.qualifier.override',
    entity: 'Registration',
    entityId: registrationId,
    oldValue: { qualifierOverride: reg.qualifierOverride },
    newValue: { qualifierOverride: override, username: reg.username },
  })
  return { ok: true }
}

/**
 * The bracket size a field of N needs: the next power of two, at least 2.
 *
 * Offered as a RECOMMENDATION at creation rather than enforced. The real field is not known until
 * the groups finish — entrants withdraw, an override adds somebody — so pinning a size months
 * earlier would be a guess the generator would then have to argue with.
 */
export function recommendedBracketSize(qualifierCount: number): number {
  if (qualifierCount <= 2) return 2
  return 2 ** Math.ceil(Math.log2(qualifierCount))
}
