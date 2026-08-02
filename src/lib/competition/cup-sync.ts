import 'server-only'
import { prisma } from '@/lib/prisma'
import { regenerateCupSnapshot } from '@/lib/cups/migrate'
import { roundColumnName } from '@/lib/cups/live'

/**
 * Bridge a LIVE cup (edited via PlayoffMatch) into the snapshot architecture that powers
 * the cups list, rankings, records, and career history.
 *
 * - Always regenerates the derived-data snapshot so the cup appears/updates in the list.
 * - Only when the cup is COMPLETED do we materialise its bracket into `CupBracketMatch`
 *   (the snapshot bracket source) and set champion/runner-up, so real results feed the
 *   ranking/records pipeline. Draft/live cups keep `CupBracketMatch` empty — the cup page
 *   renders them live from PlayoffMatch — so nothing fake ever enters the historical data.
 */
export async function syncLiveCupToSnapshot(seasonId: number): Promise<void> {
  const season = await prisma.season.findUnique({ where: { id: seasonId } })
  if (!season || season.competitionType !== 'CUP') return
  if (season.importedFromFixture) return // never rewrite an imported historical cup

  if (season.cupStatus === 'completed') {
    await materialiseBracket(seasonId)
  }
  await regenerateCupSnapshot()
}

async function materialiseBracket(seasonId: number): Promise<void> {
  const rows = await prisma.playoffMatch.findMany({
    where: { seasonId },
    orderBy: [{ round: 'asc' }, { slot: 'asc' }],
  })
  if (!rows.length) return
  const totalRounds = Math.max(...rows.map((r) => r.round))

  await prisma.$transaction(async (tx) => {
    await tx.cupBracketMatch.deleteMany({ where: { competitionId: seasonId, bracketKind: 'MAIN' } })
    for (const r of rows) {
      await tx.cupBracketMatch.create({
        data: {
          competitionId: seasonId,
          bracketKind: 'MAIN',
          roundName: roundColumnName(r.round, totalRounds),
          roundOrder: r.round,
          matchOrder: r.slot,
          aPresent: r.homeUsername != null,
          aName: r.homeUsername,
          aHandle: null,
          aSeed: r.homeSeed,
          aScore: r.homeGames,
          bPresent: r.awayUsername != null,
          bName: r.awayUsername,
          bHandle: null,
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
      await tx.season.update({
        where: { id: seasonId },
        data: {
          championName: championName ?? null,
          runnerUpName: runnerUpName ?? null,
          finalScore: cScore != null && rScore != null ? `${cScore}–${rScore}` : null,
        },
      })
    }
  })
}
