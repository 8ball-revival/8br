/**
 * Return a reconstructed Season's playoffs to setup so its bracket can be re-seated.
 *
 * Placement is deliberately fixed once playoffs go live: after that, who plays whom is part of the
 * record. That is right for a real competition, and it also means a reconstruction that started its
 * playoffs from an incomplete field cannot simply be corrected in place.
 *
 * The merge is what changed here — a handle the bracket seats now resolves to somebody who is
 * already an entrant, so a position that could not be filled before can be. Undoing the partial
 * playoff and rebuilding it from the page is the honest way to take that in.
 *
 * Only ever for a reconstruction that has contributed nothing: not completed, no champion, no
 * ranking contribution, no rating-ledger row. Everything removed is rebuilt from the archived page
 * immediately afterwards.
 *
 * Usage: tsx scripts/archive-rewind-playoffs.mts --season ID [--apply]
 */
import { prisma } from '../src/lib/prisma.ts'
import { assertLocalDatabase } from '../src/lib/db-guard.ts'
import { transitionSeasonState } from '../src/lib/seasons/lifecycle.ts'

assertLocalDatabase()

const ARGS = process.argv.slice(2)
const APPLY = ARGS.includes('--apply')
const seasonId = Number(ARGS[ARGS.indexOf('--season') + 1])
if (!Number.isFinite(seasonId)) throw new Error('pass --season ID')

const ACTOR = { userId: 2, username: 'archive-playoffs' }

const s = await prisma.season.findUniqueOrThrow({
  where: { id: seasonId },
  select: {
    id: true, number: true, division: true, competitionYear: true,
    archiveTemplateKey: true, lifecycleState: true, championName: true, ladderAppliedAt: true, reconstruction: true,
  },
})

const refuse: string[] = []
if (!s.archiveTemplateKey) refuse.push('not an archive-linked Season')
if (!s.reconstruction) refuse.push('not a reconstruction')
if (String(s.lifecycleState) === 'COMPLETED') refuse.push('the Season is complete')
if (s.championName) refuse.push(`a champion is recorded (${s.championName})`)
if (s.ladderAppliedAt) refuse.push('a ranking contribution was applied')
const ledger = await prisma.ratingLedger.count({ where: { seasonId } })
if (ledger > 0) refuse.push(`${ledger} rating-ledger row(s) exist`)

const label = `${s.competitionYear} S${s.number}${s.division ?? ''}`
const scored = await prisma.seasonPlayoffMatch.count({ where: { seasonId, homeGames: { not: null } } })
const total = await prisma.seasonPlayoffMatch.count({ where: { seasonId } })

if (refuse.length > 0) {
  console.log(`REFUSED ${label}: ${refuse.join('; ')}`)
  await prisma.$disconnect()
  process.exit(1)
}

console.log(`${label} (${seasonId}) is ${s.lifecycleState} with ${scored} of ${total} playoff matches scored`)
if (!APPLY) {
  console.log('DRY RUN — would clear the playoff bracket and return the Season to playoff setup.')
  await prisma.$disconnect()
  process.exit(0)
}

await prisma.seasonPlayoffMatch.deleteMany({ where: { seasonId } })
if (String(s.lifecycleState) !== 'PLAYOFF_SETUP') {
  const back = await transitionSeasonState(ACTOR, seasonId, 'PLAYOFF_SETUP', {
    recovery: true,
    reason: 'archive reconstruction: the playoff field changed after an owner-confirmed merge, so the bracket is rebuilt from the archived page',
  })
  if (!back.ok) throw new Error(`rewind: ${back.error}`)
}

const after = await prisma.season.findUniqueOrThrow({ where: { id: seasonId }, select: { lifecycleState: true } })
console.log(`now ${after.lifecycleState} with ${await prisma.seasonPlayoffMatch.count({ where: { seasonId } })} playoff matches`)

await prisma.$disconnect()
