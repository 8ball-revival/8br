import 'server-only'
import { prisma } from '@/lib/prisma'
import { regenerateTournamentSnapshot } from '@/lib/tournaments/migrate'
import { roundColumnName } from '@/lib/tournaments/live'

/**
 * Bridge a LIVE cup (edited via PlayoffMatch) into the snapshot architecture that powers
 * the cups list, rankings, records, and career history.
 *
 * - Always regenerates the derived-data snapshot so the tournament appears/updates in the list.
 * - Only when the tournament is COMPLETED do we materialise its bracket into `TournamentBracketMatch`
 *   (the snapshot bracket source) and set champion/runner-up, so real results feed the
 *   ranking/records pipeline. Draft/live cups keep `TournamentBracketMatch` empty — the tournament page
 *   renders them live from PlayoffMatch — so nothing fake ever enters the historical data.
 */
export async function syncLiveTournamentToSnapshot(tournamentId: number): Promise<void> {
  const tournament = await prisma.tournament.findUnique({ where: { id: tournamentId } })
  if (!tournament) return

  // Materialise the bracket into the snapshot when the tournament is completed OR has a
  // published bracket (whose completed rounds already feed rankings). Draft (unpublished)
  // tournaments are intentionally kept out of the snapshot until published.
  const publishedCount = await prisma.playoffMatch.count({ where: { tournamentId, published: true } })
  if (tournament.tournamentFormat === 'SWISS') {
    // Swiss has no bracket; its per-round matches feed the Ladder only once the tournament COMPLETES
    // (each decided match credits both players' individual W/L through the same snapshot engine).
    if (tournament.lifecycleState === 'COMPLETED') await materialiseSwiss(tournamentId)
  } else if (tournament.lifecycleState === 'COMPLETED' || publishedCount > 0) {
    await materialiseBracket(tournamentId)
  }
  await regenerateTournamentSnapshot()
}

/** Materialize a completed Swiss tournament's decided matches into the snapshot bracket rows so the
 *  Ladder credits each participant's individual results. Byes (no opponent) are skipped. The
 *  champion/runner-up were already set on the tournament row by completeSwiss. */
async function materialiseSwiss(tournamentId: number): Promise<void> {
  const rows = await prisma.swissMatch.findMany({
    where: { tournamentId, isBye: false, winnerRegistrationId: { not: null } },
    orderBy: [{ round: 'asc' }, { boardOrder: 'asc' }],
  })
  const regs = await prisma.registration.findMany({ where: { tournamentId }, select: { id: true, cueverseId: true } })
  const handleByReg = new Map(regs.map((r) => [r.id, r.cueverseId]))
  await prisma.$transaction(async (tx) => {
    await tx.tournamentBracketMatch.deleteMany({ where: { tournamentId, bracketKind: 'MAIN' } })
    for (const r of rows) {
      await tx.tournamentBracketMatch.create({
        data: {
          tournamentId,
          bracketKind: 'MAIN',
          roundName: `Swiss Round ${r.round}`,
          roundOrder: r.round,
          matchOrder: r.boardOrder,
          aPresent: true,
          aName: r.homeName,
          aHandle: r.homeRegistrationId != null ? handleByReg.get(r.homeRegistrationId) ?? null : null,
          aScore: r.homeGames,
          bPresent: true,
          bName: r.awayName,
          bHandle: r.awayRegistrationId != null ? handleByReg.get(r.awayRegistrationId) ?? null : null,
          bScore: r.awayGames,
          winner: r.winnerRegistrationId === r.homeRegistrationId ? 'a' : 'b',
        },
      })
    }
  })
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
    await tx.tournamentBracketMatch.deleteMany({ where: { tournamentId, bracketKind: 'MAIN' } })
    for (const r of rows) {
      await tx.tournamentBracketMatch.create({
        data: {
          tournamentId,
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

      /*
       * Record the CueVerse ID as well as the name.
       *
       * Only Swiss ever wrote this, so a completed bracket left championHandle null — and a title is
       * a person, which a display name alone does not identify. A team has no CueVerse ID and gets
       * none here: its members are credited from the roster instead.
       */
      const idOf = async (regId: number | null) => {
        if (regId == null) return null
        const r = await tx.registration.findUnique({ where: { id: regId }, select: { cueverseId: true, playerId: true } })
        if (!r) return null
        if (r.playerId) {
          const p = await tx.player.findUnique({ where: { id: r.playerId }, select: { cueverseId: true } })
          if (p?.cueverseId) return p.cueverseId
        }
        return r.cueverseId ?? null
      }
      const isTeam = (await tx.tournament.findUnique({
        where: { id: tournamentId }, select: { participantFormat: true },
      }))?.participantFormat === 'TEAM'
      const champReg = homeWon ? final.homeRegistrationId : final.awayRegistrationId
      const runnerReg = homeWon ? final.awayRegistrationId : final.homeRegistrationId

      /*
       * The Finals-forfeit marker is computed from the same Final this block just read.
       *
       * This runs on every lifecycle transition, so correcting a Final — either way round — puts the
       * marker right on the next transition without a separate code path that could be forgotten.
       */
      const { syncFinalsForfeit } = await import('./finals-forfeit')

      await tx.tournament.update({
        where: { id: tournamentId },
        data: {
          championName: championName ?? null,
          runnerUpName: runnerUpName ?? null,
          championHandle: isTeam ? null : await idOf(champReg),
          runnerUpHandle: isTeam ? null : await idOf(runnerReg),
          finalScore: cScore != null && rScore != null ? `${cScore}–${rScore}` : null,
        },
      })
      await syncFinalsForfeit(tx, 'tournament', tournamentId)
    }
  })
}
