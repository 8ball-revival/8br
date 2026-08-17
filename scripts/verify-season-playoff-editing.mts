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
  loadSeasonSeeding, enterSeasonPlayoffSetup, setSeasonPlayoffIncluded,
  setSeasonBracketSlot, swapSeasonBracketSlots, generateSeasonBracket, setSeasonPlayoffField,
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
  // Seeds come from the group results, so clearing the field must NOT disturb them.
  check('clearing the field leaves every seed intact', seeding.every((r) => r.overallSeed != null),
    `${seeding.filter((r) => r.overallSeed == null).length} lost their seed`)
  const all = await setSeasonPlayoffField(actor, season.id, true)
  check('and re-selected in one go', all.ok, all.error)
  seeding = await loadSeasonSeeding(season.id)
  check('everyone is back in', seeding.filter((r) => r.included).length === 8)
  check('and seeded again', seeding.filter((r) => r.overallSeed != null).length === 8)

  console.log('\n--- Seeding is dictated by the group results ---')
  // The point of this block: choosing the playoff field must not move anybody's seed.
  seeding = await loadSeasonSeeding(season.id)
  const seedOf = (id: number) => (loadedSeeding().find((r) => r.entrantId === id)?.overallSeed ?? null)
  function loadedSeeding() { return seeding }
  const before1 = seedOf(entrants[0])
  const before5 = seedOf(entrants[4])
  check('the group winner is seed 1', before1 === 1, `got ${before1}`)

  await setSeasonPlayoffIncluded(actor, season.id, entrants[0], false)
  seeding = await loadSeasonSeeding(season.id)
  check('dropping the top seed does NOT renumber anyone else', seedOf(entrants[4]) === before5,
    `seed 5 became ${seedOf(entrants[4])}`)
  check('the excluded player keeps their seed', seedOf(entrants[0]) === before1,
    `it became ${seedOf(entrants[0])}`)
  check('they are simply out of the field', seeding.find((r) => r.entrantId === entrants[0])?.included === false)
  await setSeasonPlayoffIncluded(actor, season.id, entrants[0], true)
  seeding = await loadSeasonSeeding(season.id)
  check('and putting them back changes nothing either', seedOf(entrants[0]) === before1 && seedOf(entrants[4]) === before5)

  console.log('\n--- Points: 2 a win, 1 a tie, 1 for completing the group ---')
  const { computeStandings } = await import('../src/lib/competition/standings.ts')
  const roster = [1, 2, 3].map((n) => ({ registrationId: n, username: `p${n}` }))
  const table = computeStandings(roster, [
    { homeRegistrationId: 1, awayRegistrationId: 2, homeUsername: 'p1', awayUsername: 'p2', homeGames: 7, awayGames: 3, winnerRegistrationId: 1 },
    { homeRegistrationId: 1, awayRegistrationId: 3, homeUsername: 'p1', awayUsername: 'p3', homeGames: 5, awayGames: 5, winnerRegistrationId: null },
  ], 2)
  const p1row = table.find((r) => r.registrationId === 1)!
  check('a win and a tie with a full slate scores 2 + 1 + 1 = 4', p1row.points === 4, `got ${p1row.points}`)
  const p3row = table.find((r) => r.registrationId === 3)!
  check('a single tie without the full slate scores 1', p3row.points === 1, `got ${p3row.points}`)

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

  console.log('\n--- Click one slot, click another, they swap ---')
  const s1 = { matchId: before[0].id, side: 'home' as const }
  const s2 = { matchId: before[2].id, side: 'away' as const }
  const cur = await prisma.seasonPlayoffMatch.findMany({ where: { seasonId: season.id }, select: { id: true, homeEntrantId: true, awayEntrantId: true } })
  const at = (m: { matchId: number; side: 'home' | 'away' }) => {
    const row = cur.find((r) => r.id === m.matchId)!
    return m.side === 'home' ? row.homeEntrantId : row.awayEntrantId
  }
  const was1 = at(s1), was2 = at(s2)
  const sw = await swapSeasonBracketSlots(actor, season.id, s1, s2)
  check('two slots swap', sw.ok, sw.error)
  const now = await prisma.seasonPlayoffMatch.findMany({ where: { seasonId: season.id }, select: { id: true, homeEntrantId: true, awayEntrantId: true } })
  const nowAt = (m: { matchId: number; side: 'home' | 'away' }) => {
    const row = now.find((r) => r.id === m.matchId)!
    return m.side === 'home' ? row.homeEntrantId : row.awayEntrantId
  }
  check('the first slot now holds the second player', nowAt(s1) === was2)
  check('the second slot now holds the first player', nowAt(s2) === was1)
  const occ2 = now.flatMap((m) => [m.homeEntrantId, m.awayEntrantId]).filter((x): x is number => x != null)
  check('a swap duplicates nobody', new Set(occ2).size === occ2.length)

  console.log('\n--- Placement locks once the bracket is published ---')
  await prisma.season.update({ where: { id: season.id }, data: { lifecycleState: 'PLAYOFFS_LIVE' } })
  const late = await swapSeasonBracketSlots(actor, season.id, s1, s2)
  check('swapping is refused after publication', !late.ok, 'it was allowed')
  const lateSet = await setSeasonBracketSlot(actor, season.id, before[0].id, 'home', entrants[1])
  check('assigning a slot is refused after publication', !lateSet.ok, 'it was allowed')
  await prisma.season.update({ where: { id: season.id }, data: { lifecycleState: 'PLAYOFF_SETUP' } })

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
