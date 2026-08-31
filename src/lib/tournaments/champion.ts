import 'server-only'

import { prisma } from '@/lib/prisma'
import { resolveEntrants } from '@/lib/competition/entrants'
import type { LiveChampion } from '@/components/creator/tournament-live-bracket'

/**
 * Who has won, once anybody has.
 *
 * ── Read from the bracket, not from a stored field ──────────────────────────────────────────────
 * The Tournament row gains a champion when it is CLOSED. This has to answer the question one step
 * earlier — the final is decided but the record is still open — because that is exactly the moment
 * the screen needs to offer to crown somebody. So it reads the deciding match.
 *
 * ── Which match decides it ──────────────────────────────────────────────────────────────────────
 * The Grand Final in a double-elimination bracket; otherwise the last round's only match. Not "the
 * highest id" and not "the last row": a corrected bracket can be rebuilt in any order, and a
 * Tournament whose final has been reopened would otherwise report a champion who is currently
 * playing.
 *
 * Returns null while the deciding match has no winner, which is what keeps the crowning control
 * off the screen until there is somebody to crown.
 */
export async function championOfTournament(tournamentId: number): Promise<LiveChampion | null> {
  const rows = await prisma.playoffMatch.findMany({
    where: { tournamentId },
    orderBy: [{ round: 'asc' }, { slot: 'asc' }],
  })
  if (rows.length === 0) return null

  const grandFinals = rows.filter((m) => m.section === 'GF')
  const decider = grandFinals.length > 0
    // A reset Grand Final is a second GF match; the LAST one is the one that decides.
    ? grandFinals[grandFinals.length - 1]
    : (() => {
      const main = rows.filter((m) => m.section == null || m.section === 'WB')
      if (main.length === 0) return null
      const last = Math.max(...main.map((m) => m.round))
      const finals = main.filter((m) => m.round === last)
      // More than one match in the last round means the bracket is not finished being built.
      return finals.length === 1 ? finals[0] : null
    })()

  if (!decider || decider.winnerRegistrationId == null) return null

  const winnerId = decider.winnerRegistrationId
  const loserId = decider.homeRegistrationId === winnerId
    ? decider.awayRegistrationId
    : decider.homeRegistrationId

  const ids = [winnerId, loserId].filter((x): x is number => x != null)
  const regs = await prisma.registration.findMany({
    where: { id: { in: ids } },
    select: { id: true, username: true, displayName: true, cueverseId: true, discord: true, playerId: true },
  })
  const idn = await resolveEntrants(regs)
  const named = (id: number | null) => {
    if (id == null) return { name: null, cueverseId: null }
    const r = regs.find((x) => x.id === id)
    return {
      name: idn.get(id)?.displayName ?? r?.username ?? null,
      cueverseId: idn.get(id)?.cueverseId ?? r?.cueverseId ?? null,
    }
  }

  const champ = named(winnerId)
  const runner = named(loserId)

  // Written from the winner's side, so it reads the way a result is spoken: the champion's score first.
  const winnerWasHome = decider.homeRegistrationId === winnerId
  const winnerGames = winnerWasHome ? decider.homeGames : decider.awayGames
  const loserGames = winnerWasHome ? decider.awayGames : decider.homeGames
  const finalScore = winnerGames != null && loserGames != null ? `${winnerGames}–${loserGames}` : null

  return {
    name: champ.name ?? 'Unknown',
    cueverseId: champ.cueverseId,
    runnerUp: runner.name,
    runnerUpCueverseId: runner.cueverseId,
    finalScore,
    byForfeit: decider.forfeitRegistrationId != null,
  }
}
