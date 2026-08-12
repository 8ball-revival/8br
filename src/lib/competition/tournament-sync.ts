import 'server-only'
import { prisma } from '@/lib/prisma'
import { regenerateCupSnapshot } from '@/lib/cups/migrate'
import { roundColumnName } from '@/lib/cups/live'

/**
 * Bridge a LIVE cup (edited via PlayoffMatch) into the snapshot architecture that powers
 * the cups list, rankings, records, and career history.
 *
 * - Always regenerates the derived-data snapshot so the cup appears/updates in the list.
 * - Only when the cup is COMPLETED do we materialise its bracket into `TournamentBracketMatch`
 *   (the snapshot bracket source) and set champion/runner-up, so real results feed the
 *   ranking/records pipeline. Draft/live cups keep `TournamentBracketMatch` empty — the cup page
 *   renders them live from PlayoffMatch — so nothing fake ever enters the historical data.
 */
export async function syncLiveCupToSnapshot(tournamentId: number): Promise<void> {
  const tournament = await prisma.tournament.findUnique({ where: { id: tournamentId } })
  if (!tournament || tournament.competitionType !== 'CUP') return
  if (tournament.importedFromFixture) return // never rewrite an imported historical cup

  // Materialise the bracket into the snapshot when the cup is completed OR has a published
  // bracket (a live/converted cup whose completed rounds already feed rankings). Draft
  // (unpublished) cups are intentionally kept out of the snapshot until published.
  const publishedCount = await prisma.playoffMatch.count({ where: { tournamentId, published: true } })
  if (tournament.cupStatus === 'completed' || publishedCount > 0) {
    await materialiseBracket(tournamentId)
  }
  await regenerateCupSnapshot()
}

async function materialiseBracket(tournamentId: number): Promise<void> {
  const rows = await prisma.playoffMatch.findMany({
    where: { tournamentId },
    orderBy: [{ round: 'asc' }, { slot: 'asc' }],
  })
  if (!rows.length) return
  const totalRounds = Math.max(...rows.map((r) => r.round))

  // Carry each entrant's public handle (cueverseId) into the snapshot slots so the
  // ranking engine's identity resolver can match the exact profile, not just the name.
  const regs = await prisma.registration.findMany({ where: { tournamentId }, select: { id: true, cueverseId: true } })
  const handleByReg = new Map(regs.map((r) => [r.id, r.cueverseId]))

  await prisma.$transaction(async (tx) => {
    await tx.tournamentBracketMatch.deleteMany({ where: { competitionId: tournamentId, bracketKind: 'MAIN' } })
    for (const r of rows) {
      await tx.tournamentBracketMatch.create({
        data: {
          competitionId: tournamentId,
          bracketKind: 'MAIN',
          roundName: roundColumnName(r.round, totalRounds),
          roundOrder: r.round,
          matchOrder: r.slot,
          aPresent: r.homeUsername != null,
          aName: r.homeUsername,
          aHandle: r.homeRegistrationId != null ? handleByReg.get(r.homeRegistrationId) ?? null : null,
          aSeed: r.homeSeed,
          aScore: r.homeGames,
          bPresent: r.awayUsername != null,
          bName: r.awayUsername,
          bHandle: r.awayRegistrationId != null ? handleByReg.get(r.awayRegistrationId) ?? null : null,
          bSeed: r.awaySeed,
          bScore: r.awayGames,
          winner: r.winnerRegistrationId == null ? null : r.winnerRegistrationId === r.homeRegistrationId ? 'a' : 'b',
          note: r.note,
        },
      })
    }

    // Champion / runner-up from the final (highest round, single match).
    const final = rows.filter((r) => r.round === totalRounds).sort((a, b) => a.slot - b.slot)[0]
    if (final && final.winnerRegistrationId != null) {
      const homeWon = final.winnerRegistrationId === final.homeRegistrationId
      const championName = homeWon ? final.homeUsername : final.awayUsername
      const runnerUpName = homeWon ? final.awayUsername : final.homeUsername
      const cScore = homeWon ? final.homeGames : final.awayGames
      const rScore = homeWon ? final.awayGames : final.homeGames
      await tx.tournament.update({
        where: { id: tournamentId },
        data: {
          championName: championName ?? null,
          runnerUpName: runnerUpName ?? null,
          finalScore: cScore != null && rScore != null ? `${cScore}–${rScore}` : null,
        },
      })
    }
  })
}
