/**
 * Playoff setup for a RECONSTRUCTED season: the field and the seeding are both editable, and the
 * generated bracket can be rearranged afterwards.
 *
 * A season being rebuilt from an archive was seeded however it was seeded at the time, so nothing
 * here may be derived-and-locked. Asserts that everyone starts included, that an explicit seed order
 * overrides group finish, and that moving a player already in the bracket SWAPS rather than
 * duplicating or dropping anyone.
 *
 * Builds its own `zzpo` season and removes it.
 *
 * Run:  npx tsx --tsconfig scripts/tsconfig.verify.json scripts/verify-season-playoff-editing.mts
 */
import { prisma } from '../src/lib/prisma.ts'
import {
  loadSeasonSeeding, enterSeasonPlayoffSetup, setSeasonPlayoffIncluded, setSeasonSeedOrder,
  setSeasonBracketSlot, generateSeasonBracket, setSeasonPlayoffField,
} from '../src/lib/seasons/playoffs.ts'

let pass = 0, fail = 0
const check = (n: string, ok: boolean, d = '') => {
  if (ok) { pass++; console.log('  ✓ ' + n) } else { fail++; console.log('  ✗ ' + n + (d ? ` — ${d}` : '')) }
}
const actor = { userId: 970001, username: 'zzpo-verify' }
const TAG = 'zzpo'

async function cleanup() {
  const seasons = await prisma.season.findMany({ where: { slug: { startsWith: TAG } }, select: { id: true } })
  const ids = seasons.map((s) => s.id)
  if (ids.length) {
    await prisma.seasonPlayoffMatch.deleteMany({ where: { seasonId: { in: ids } } }).catch(() => {})
    await prisma.seasonMatch.deleteMany({ where: { seasonId: { in: ids } } }).catch(() => {})
    await prisma.seasonStanding.deleteMany({ where: { seasonId: { in: ids } } }).catch(() => {})
    await prisma.seasonGroupPlayer.deleteMany({ where: { group: { seasonId: { in: ids } } } }).catch(() => {})
    await prisma.seasonGroup.deleteMany({ where: { seasonId: { in: ids } } }).catch(() => {})
    await prisma.seasonEntrant.deleteMany({ where: { seasonId: { in: ids } } }).catch(() => {})
    await prisma.season.deleteMany({ where: { id: { in: ids } } }).catch(() => {})
  }
  await prisma.player.deleteMany({ where: { primaryName: { startsWith: TAG } } }).catch(() => {})
  await prisma.auditLog.deleteMany({ where: { actorUsername: 'zzpo-verify' } }).catch(() => {})
}

async function main() {
  await cleanup()

  const series = await prisma.competitionSeries.findFirst({ where: { active: true }, select: { id: true } })
  if (!series) { check('a Competition exists', false); return }
  const last = await prisma.season.findFirst({ orderBy: { number: 'desc' }, select: { number: true } })
  const num = (last?.number ?? 0) + 1
  const season = await prisma.season.create({
    data: {
      number: num, competitionYear: 2026, competitionSeriesId: series.id,
      slug: `${TAG}-season-${num}`, lifecycleState: 'GROUPS_CLOSED',
    },
    select: { id: true },
  })
  const group = await prisma.seasonGroup.create({
    data: { seasonId: season.id, code: 'A', ordinal: 0, published: true }, select: { id: true },
  })

  // Eight players, given deliberately DESCENDING group positions so a manual seed order is
  // distinguishable from the derived one.
  const entrants: number[] = []
  for (let n = 1; n <= 8; n++) {
    const p = await prisma.player.create({
      data: { primaryName: `${TAG}_p${n}`, cueverseId: `${TAG}_p${n}`, active: true }, select: { id: true },
    })
    const e = await prisma.seasonEntrant.create({
      data: { seasonId: season.id, playerId: p.id, username: `${TAG}_p${n}`, displayName: `${TAG}_p${n}`, status: 'APPROVED' },
      select: { id: true },
    })
    entrants.push(e.id)
    await prisma.seasonGroupPlayer.create({ data: { groupId: group.id, entrantId: e.id } })
    await prisma.seasonStanding.create({
      data: { seasonId: season.id, groupId: group.id, entrantId: e.id, username: `${TAG}_p${n}`, rank: n, points: 100 - n },
    })
  }

  console.log('--- Everyone starts in the field ---')
  const entered = await enterSeasonPlayoffSetup(actor, season.id)
  check('playoff setup opens', entered.ok, entered.error)
  let seeding = await loadSeasonSeeding(season.id)
  check('every eligible entrant is included by default', seeding.filter((r) => r.included).length === 8,
    `${seeding.filter((r) => r.included).length} of 8`)
  check('everyone has a seed', seeding.filter((r) => r.overallSeed != null).length === 8)

  console.log('\n--- The field is a simple in/out switch ---')
  const out = await setSeasonPlayoffIncluded(actor, season.id, entrants[7], false)
  check('a player can be excluded', out.ok, out.error)
  seeding = await loadSeasonSeeding(season.id)
  check('they drop out of the field', seeding.find((r) => r.entrantId === entrants[7])?.included === false)
  check('the remaining seeds close up', seeding.filter((r) => r.included).length === 7)
  check('no gap is left in the seeding',
    seeding.filter((r) => r.included).map((r) => r.overallSeed).join(',') === '1,2,3,4,5,6,7')
  const back = await setSeasonPlayoffIncluded(actor, season.id, entrants[7], true)
  check('and can be put back', back.ok && (await loadSeasonSeeding(season.id)).filter((r) => r.included).length === 8)

  console.log('\n--- Select all / none ---')
  const none = await setSeasonPlayoffField(actor, season.id, false)
  check('the whole field can be cleared', none.ok, none.error)
  seeding = await loadSeasonSeeding(season.id)
  check('nobody is left in the field', seeding.every((r) => !r.included),
    `${seeding.filter((r) => r.included).length} still in`)
  check('clearing the field also clears the seeding', seeding.every((r) => r.overallSeed == null))
  const all = await setSeasonPlayoffField(actor, season.id, true)
  check('and re-selected in one go', all.ok, all.error)
  seeding = await loadSeasonSeeding(season.id)
  check('everyone is back in', seeding.filter((r) => r.included).length === 8)
  check('and seeded again', seeding.filter((r) => r.overallSeed != null).length === 8)

  console.log('\n--- Seeding can be overwritten ---')
  const reversed = [...entrants].reverse()
  const seeded = await setSeasonSeedOrder(actor, season.id, reversed)
  check('an explicit order is accepted', seeded.ok, seeded.error)
  seeding = await loadSeasonSeeding(season.id)
  const order = seeding.filter((r) => r.included).sort((a, b) => a.overallSeed! - b.overallSeed!).map((r) => r.entrantId)
  check('the manual order wins over group finish', JSON.stringify(order) === JSON.stringify(reversed),
    `got ${order.join(',')}`)
  check('the player who finished LAST is now seed 1',
    seeding.find((r) => r.entrantId === entrants[7])?.overallSeed === 1)

  console.log('\n--- The generated bracket can be rearranged ---')
  const gen = await generateSeasonBracket(actor, season.id)
  check('bracket generated', gen.ok, gen.error)
  const before = await prisma.seasonPlayoffMatch.findMany({
    where: { seasonId: season.id }, orderBy: [{ round: 'asc' }, { slot: 'asc' }],
    select: { id: true, homeEntrantId: true, awayEntrantId: true },
  })
  const first = before[0]
  const second = before[1]
  check('at least two ties to move between', Boolean(first && second))

  const mover = second.homeEntrantId!
  const displaced = first.homeEntrantId!
  const moved = await setSeasonBracketSlot(actor, season.id, first.id, 'home', mover)
  check('a player can be moved into another tie', moved.ok, moved.error)

  const after = await prisma.seasonPlayoffMatch.findMany({
    where: { seasonId: season.id }, select: { id: true, homeEntrantId: true, awayEntrantId: true },
  })
  const a1 = after.find((m) => m.id === first.id)!
  const a2 = after.find((m) => m.id === second.id)!
  check('the mover now holds the target slot', a1.homeEntrantId === mover)
  check('the displaced player took the vacated slot (a SWAP, not a duplicate)', a2.homeEntrantId === displaced)

  const occupancy = after.flatMap((m) => [m.homeEntrantId, m.awayEntrantId]).filter((x): x is number => x != null)
  check('nobody appears twice in the bracket', new Set(occupancy).size === occupancy.length,
    `${occupancy.length} slots, ${new Set(occupancy).size} distinct`)
  check('nobody was dropped', new Set(occupancy).size === new Set(
    before.flatMap((m) => [m.homeEntrantId, m.awayEntrantId]).filter((x): x is number => x != null)).size)

  console.log('\n--- A decided tie is protected ---')
  await prisma.seasonPlayoffMatch.update({ where: { id: first.id }, data: { status: 'COMPLETED', homeGames: 9, awayGames: 3 } })
  const blocked = await setSeasonBracketSlot(actor, season.id, first.id, 'home', entrants[0])
  check('moving a player out of a completed tie is refused', !blocked.ok, 'it was allowed')

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
}

main()
  .catch((e) => { console.error(e); fail++ })
  .finally(async () => {
    await cleanup()
    await prisma.$disconnect()
    process.exit(fail === 0 ? 0 : 1)
  })
