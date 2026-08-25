/**
 * 2010 Season 1, Division A, Group D: the fifth slot was Craig, not Neo.
 *
 * ── What the archive says ────────────────────────────────────────────────────────────────────────
 * The 8brcam Group D grid names its seven columns Ian, Trey, Craig, Joey, Craig, Daz, Jordy — two
 * Craigs — and the fifth row is `I_Am_Almost_God`, whose record (4 played, 1-2-1, 20-20, 50%) is
 * exactly what this Season already stores against Neo. The results were never wrong; the person
 * they were filed under was.
 *
 * ── Why this is a re-attribution and not a merge ─────────────────────────────────────────────────
 * Neo and Craig are both real, distinct players who each keep their own history. Nothing is being
 * combined: one entrant slot moves from one to the other, and every match, score and standing in it
 * stays exactly as recorded. Neo simply stops being credited for a Season he did not play.
 *
 * ── The ledger is rebuilt, not edited ────────────────────────────────────────────────────────────
 * Rating is derived, so the four ledger rows this slot produced cannot be patched in place: Elo is
 * path-dependent, and every later rating for both players is computed from the ones before it.
 * Rebuilding replays every eligible record from the start, which is the only way the change reaches
 * the ratings that came after it.
 */
import { prisma } from '../src/lib/prisma.ts'
import { assertLocalDatabase } from '../src/lib/db-guard.ts'

assertLocalDatabase()

const ENTRANT = 47683
const SEASON = 5477
const NEO = 'cmsys8lj000016rigqrgtm4qb'
const CRAIG = 'cmt83opsx00bh6rmk70mloabr'

const before = await prisma.seasonEntrant.findUniqueOrThrow({
  where: { id: ENTRANT },
  select: { id: true, seasonId: true, playerId: true, username: true, displayName: true, cueverseId: true },
})
console.log('before:', JSON.stringify(before))
if (before.seasonId !== SEASON) throw new Error(`entrant ${ENTRANT} is not in Season ${SEASON}`)
if (before.playerId !== NEO) throw new Error(`entrant ${ENTRANT} is not Neo — refusing to guess`)

const craig = await prisma.player.findUniqueOrThrow({
  where: { id: CRAIG },
  select: { id: true, primaryName: true, cueverseId: true },
})
if (craig.cueverseId?.toLowerCase() !== 'mvp_chiddy') throw new Error('target is not mvp_chiddy')

const result = await prisma.$transaction(async (tx) => {
  await tx.seasonEntrant.update({
    where: { id: ENTRANT },
    data: {
      playerId: craig.id,
      username: craig.cueverseId ?? craig.primaryName,
      displayName: craig.primaryName,
      cueverseId: craig.cueverseId,
    },
  })

  /*
   * The denormalised name on a match and a standing is the label the row was written with, so it
   * has to move too — otherwise the group grid keeps saying "Neo" over Craig's results.
   */
  const home = await tx.seasonMatch.updateMany({
    where: { seasonId: SEASON, homeEntrantId: ENTRANT },
    data: { homeUsername: craig.primaryName },
  })
  const away = await tx.seasonMatch.updateMany({
    where: { seasonId: SEASON, awayEntrantId: ENTRANT },
    data: { awayUsername: craig.primaryName },
  })
  const standing = await tx.seasonStanding.updateMany({
    where: { entrantId: ENTRANT },
    data: { username: craig.primaryName },
  })

  const { rebuildRatingLedger } = await import('../src/lib/stats/ledger.ts')
  const ledger = await rebuildRatingLedger(tx)
  return { home: home.count, away: away.count, standing: standing.count, ledger }
}, { timeout: 120_000 })

console.log('updated:', JSON.stringify(result))
console.log('after:', JSON.stringify(await prisma.seasonEntrant.findUniqueOrThrow({
  where: { id: ENTRANT },
  select: { playerId: true, username: true, displayName: true, cueverseId: true },
})))

for (const [label, id] of [['neo', NEO], ['craig mvp_chiddy', CRAIG]] as const) {
  const n = await prisma.ratingLedger.count({ where: { playerId: id, seasonId: SEASON } })
  const all = await prisma.ratingLedger.count({ where: { playerId: id } })
  console.log(`${label}: ${n} ledger row(s) in Season ${SEASON}, ${all} overall`)
}

await prisma.$disconnect()
