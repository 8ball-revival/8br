import 'server-only'

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'

/**
 * Whether a record's Final was won because the opponent forfeited — and keeping that answer in step
 * with the bracket it is derived from.
 *
 * ── Why it is stored at all ──────────────────────────────────────────────────────────────────────
 * The marker appears on the completed header, the Finals bracket, both listings, champion history,
 * the player's profile and the Creator summary. Recomputing it on each of those means six reads of
 * the bracket to answer one question, and six chances to answer it differently. So it is written
 * once, on the record.
 *
 * ── Which makes staleness the risk, and this the answer to it ────────────────────────────────────
 * A stored derivative is only safe while something guarantees it still matches its source. That
 * guarantee is here: ONE function computes it from the canonical Final, and it is called inside the
 * same transaction as every write that can change the answer — completion, correction, reopening,
 * recompletion. Nothing sets the column by hand, so there is no second place for the two to drift
 * apart, and re-running it is always safe because it recomputes rather than toggles.
 *
 * ── The canonical Final ──────────────────────────────────────────────────────────────────────────
 * Highest round, lowest slot: the same match `seasonChampion` and the Tournament snapshot already
 * treat as the Final. Reading it the same way here means the marker cannot describe a different
 * match from the one the champion came from.
 */

type Tx = Prisma.TransactionClient | typeof prisma

/** Did the Final end in a forfeit? Null when there is no decided Final to ask about. */
export async function finalsForfeitOf(
  tx: Tx,
  kind: 'season' | 'tournament',
  id: number,
): Promise<boolean | null> {
  if (kind === 'season') {
    const rows = await tx.seasonPlayoffMatch.findMany({
      where: { seasonId: id },
      select: { round: true, slot: true, status: true, winnerEntrantId: true },
    })
    if (rows.length === 0) return null
    const maxRound = Math.max(...rows.map((r) => r.round))
    const final = rows.filter((r) => r.round === maxRound).sort((a, b) => a.slot - b.slot)[0]
    if (!final || final.winnerEntrantId == null) return null
    return final.status === 'FORFEIT'
  }

  const rows = await tx.playoffMatch.findMany({
    where: { tournamentId: id },
    select: { round: true, slot: true, status: true, winnerRegistrationId: true, forfeitRegistrationId: true },
  })
  if (rows.length === 0) return null
  const maxRound = Math.max(...rows.map((r) => r.round))
  const final = rows.filter((r) => r.round === maxRound).sort((a, b) => a.slot - b.slot)[0]
  if (!final || final.winnerRegistrationId == null) return null
  // Either marker is enough: `status` is what the match says it is, and `forfeitRegistrationId` is
  // who did it. A row with one and not the other is still a forfeited Final.
  return final.status === 'FORFEIT' || final.forfeitRegistrationId != null
}

/**
 * Write the marker from the bracket. Idempotent, and safe to call when there is no Final yet.
 *
 * With no decided Final the answer is false rather than null: a record that has not produced one
 * cannot have produced a forfeited one, and leaving a stale `true` behind after a Final is undone is
 * exactly the drift this exists to prevent.
 */
export async function syncFinalsForfeit(
  tx: Tx,
  kind: 'season' | 'tournament',
  id: number,
): Promise<boolean> {
  const value = (await finalsForfeitOf(tx, kind, id)) ?? false
  if (kind === 'season') {
    await tx.season.update({ where: { id }, data: { finalsForfeit: value } })
  } else {
    await tx.tournament.update({ where: { id }, data: { finalsForfeit: value } })
  }
  return value
}
