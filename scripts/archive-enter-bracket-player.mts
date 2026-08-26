/**
 * Enter a player the archived bracket proves played, but the manifest never listed.
 *
 * ── Why this needs its own tool ──────────────────────────────────────────────────────────────────
 * Three people hold an entry position on a complete, validated bracket page and are not in their
 * Season's entrant list, because the manifest's participant table does not name them. The bracket is
 * the better evidence of who played — it is a drawing of the draw — but a bracket position can only
 * be filled by an entrant, and entering somebody is only possible while registration is open.
 *
 * So the Season has to be walked back through its own lifecycle and rebuilt. Everything undone here
 * is regenerated from the manifest immediately afterwards by the ordinary importers; nothing is
 * recovered from memory or reconstructed by hand.
 *
 * ── What it will not do ──────────────────────────────────────────────────────────────────────────
 * It refuses on anything that has contributed a result: completed, champion recorded, ranking
 * applied, or any rating-ledger row. Those are records, not drafts. And it only ever enters a
 * handle the caller names — it does not go looking for people to add.
 *
 * Usage: tsx scripts/archive-enter-bracket-player.mts --season ID --handle NAME [--apply]
 */
import { prisma } from '../src/lib/prisma.ts'
import { assertLocalDatabase } from '../src/lib/db-guard.ts'
import { resolveCanonical } from '../src/lib/archive/canonical-identity.ts'
import { transitionSeasonState } from '../src/lib/seasons/lifecycle.ts'
import { addSeasonEntrant } from '../src/lib/seasons/service.ts'

assertLocalDatabase()

const ARGS = process.argv.slice(2)
const APPLY = ARGS.includes('--apply')
const seasonId = Number(ARGS[ARGS.indexOf('--season') + 1])
const handle = ARGS[ARGS.indexOf('--handle') + 1]
if (!Number.isFinite(seasonId) || !handle) throw new Error('usage: --season ID --handle NAME [--apply]')

const ACTOR = { userId: 2, username: 'archive-import' }

const s = await prisma.season.findUniqueOrThrow({
  where: { id: seasonId },
  select: {
    id: true, number: true, division: true, competitionYear: true, archiveTemplateKey: true,
    lifecycleState: true, championName: true, ladderAppliedAt: true, reconstruction: true,
  },
})
const label = `${s.competitionYear} S${s.number}${s.division ?? ''}`

// ── Guards. Anything that has contributed a result is a record, not a draft. ─────────────────────
const refuse: string[] = []
if (!s.archiveTemplateKey) refuse.push('not an archive-linked Season')
if (!s.reconstruction) refuse.push('not a reconstruction')
if (String(s.lifecycleState) === 'COMPLETED') refuse.push('the Season is complete')
if (s.championName) refuse.push(`a champion is recorded (${s.championName})`)
if (s.ladderAppliedAt) refuse.push('a ranking contribution was applied')
const ledger = await prisma.ratingLedger.count({ where: { seasonId } })
if (ledger > 0) refuse.push(`${ledger} rating-ledger row(s) exist`)

const id = await resolveCanonical(seasonId, handle)
if (id.resolution !== 'resolved' || !id.playerId) refuse.push(`${handle} does not resolve to one Player (${id.resolution})`)
if (id.entrantId) refuse.push(`${handle} is already an entrant in this Season`)

if (refuse.length > 0) {
  console.log(`REFUSED ${label}: ${refuse.join('; ')}`)
  await prisma.$disconnect()
  process.exit(1)
}

const before = {
  entrants: await prisma.seasonEntrant.count({ where: { seasonId } }),
  groups: await prisma.seasonGroup.count({ where: { seasonId } }),
  matches: await prisma.seasonMatch.count({ where: { seasonId } }),
  scored: await prisma.seasonMatch.count({ where: { seasonId, homeGames: { not: null } } }),
  standings: await prisma.seasonStanding.count({ where: { seasonId } }),
  playoff: await prisma.seasonPlayoffMatch.count({ where: { seasonId } }),
}
console.log(`${label} (${seasonId}) — ${s.lifecycleState}`)
console.log(`  entering: ${handle} → Player ${id.playerId}`)
console.log(`  current: ${JSON.stringify(before)}`)
console.log(`  the group stage will be rebuilt from the manifest after the entrant is added`)

if (!APPLY) {
  console.log('\nDRY RUN — nothing changed. Re-run with --apply.')
  await prisma.$disconnect()
  process.exit(0)
}

/*
 * Undo the derived work, add the person, and let the ordinary importers rebuild.
 *
 * The order matters: the bracket and the group stage are both derived from the entrant field, so
 * both go before the field changes. The recovery transition is the lifecycle's own designed route
 * back, and is audited as such rather than done behind the service's back.
 */
await prisma.$transaction(async (tx) => {
  await tx.seasonPlayoffMatch.deleteMany({ where: { seasonId } })
  await tx.seasonStanding.deleteMany({ where: { seasonId } })
  await tx.seasonMatch.deleteMany({ where: { seasonId } })
  await tx.seasonGroupPlayer.deleteMany({ where: { group: { seasonId } } })
  await tx.seasonGroup.deleteMany({ where: { seasonId } })
}, { timeout: 120_000 })

const back = await transitionSeasonState(ACTOR, seasonId, 'REGISTRATION_OPEN', {
  recovery: true,
  reason: `archive reconstruction: the archived bracket seats ${handle}, who the manifest does not list as a participant`,
})
if (!back.ok) throw new Error(`rewind: ${back.error}`)

const added = await addSeasonEntrant(ACTOR, seasonId, id.playerId!)
if (!added.ok) throw new Error(`enter ${handle}: ${added.error}`)

const after = await prisma.seasonEntrant.count({ where: { seasonId } })
console.log(`  entered — ${before.entrants} → ${after} entrant(s); Season is now ${(await prisma.season.findUniqueOrThrow({ where: { id: seasonId }, select: { lifecycleState: true } })).lifecycleState}`)
console.log('  now run: import-archive-seasons.mts --apply --season ' + seasonId + '  then  archive-import-playoffs.mts --apply --season ' + seasonId)

await prisma.$disconnect()
