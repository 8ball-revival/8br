/**
 * When a bye is awarded.
 *
 * A bye used to be settled the instant the bracket was generated: the tie went COMPLETED and the
 * recipient appeared in round two straight away. That made the draft hard to rebuild by hand, which
 * is what this project mostly does with brackets — every placement edit refuses a COMPLETED tie, so
 * the bye tie and the round-two slot it had already filled were frozen before the admin touched
 * anything.
 *
 * The rule now: generation leaves the bye visible but unplayed and the next round's slot EMPTY.
 * Starting the playoffs awards the byes, reading whatever the bracket looks like at that moment.
 *
 * Run:  npx tsx --tsconfig scripts/tsconfig.verify.json scripts/verify-playoff-bye-timing.mts
 */
import React from 'react'
import { deleteFixtureAuditRows } from '../src/lib/verification/fixture-actors.ts'
import { renderToStaticMarkup } from 'react-dom/server'
import { prisma } from '../src/lib/prisma.ts'
import {
  generateSeasonBracket, startSeasonPlayoffs, setSeasonBracketSlot, swapSeasonBracketSlots,
} from '../src/lib/seasons/playoffs.ts'
import { MatchBox, type BracketSwapApi } from '../src/components/tournaments/bracket.tsx'
import type { BracketMatch } from '../src/lib/tournaments/service.ts'

let pass = 0, fail = 0
const check = (n: string, c: boolean, d = '') => {
  if (c) { pass++; console.log('  OK   ' + n) } else { fail++; console.log('  FAIL ' + n + (d ? ` — ${d}` : '')) }
}

const FIXTURE_COMP = 'zzbt-comp'

async function cleanup() {
  await prisma.season.deleteMany({ where: { slug: { startsWith: 'zzbt-season-' } } }).catch(() => {})
  await prisma.competitionSeries.deleteMany({ where: { slug: FIXTURE_COMP } }).catch(() => {})
  // The suite's own audit trail goes with its records — a log describing Seasons that no longer
  // exist is not a record of anything, and somebody has to adjudicate it later.
  await deleteFixtureAuditRows(prisma, ['bye-timing-verify']).catch(() => {})
}
await cleanup()

const actor = { userId: 990101, username: 'bye-timing-verify' }
let seasonNo = 8100

/** A Season in PLAYOFF_SETUP with `entrants` approved, included players. No groups needed — the
 *  bracket is generated from the seeding order alone. */
async function fixtureSeason(entrants: number, doubleElim = false) {
  const comp = await prisma.competitionSeries.findFirst({ where: { slug: FIXTURE_COMP }, select: { id: true } })
    ?? await prisma.competitionSeries.create({ data: { name: 'zz Bye Timing', shortName: 'zzbt', slug: FIXTURE_COMP, active: true }, select: { id: true } })
  const number = seasonNo++
  const s = await prisma.season.create({
    data: {
      competitionSeriesId: comp.id, number, competitionYear: 2091, slug: `zzbt-season-${number}`,
      lifecycleState: 'PLAYOFF_SETUP', lounge: 'Social', accessMode: 'OPEN', playoffDoubleElim: doubleElim,
      groupStageGames: 10, earlyRaceTo: 7, semifinalRaceTo: 9, finalRaceTo: 9,
    },
    select: { id: true },
  })
  // Seeding is read from the GROUP RESULTS, so a single finished group stands in for the season.
  const group = await prisma.seasonGroup.create({
    data: { seasonId: s.id, code: 'A', ordinal: 0, published: true }, select: { id: true },
  })
  const ids: number[] = []
  for (let i = 1; i <= entrants; i++) {
    const e = await prisma.seasonEntrant.create({
      data: { seasonId: s.id, username: `zzbt${number}_${i}`, cueverseId: `zzbt${number}_${i}`, status: 'APPROVED', playoffIncluded: true },
      select: { id: true },
    })
    // Rank i, and points descending with it, so entrant i seeds i — an unambiguous order to assert on.
    await prisma.seasonStanding.create({
      data: {
        seasonId: s.id, groupId: group.id, entrantId: e.id, username: `zzbt${number}_${i}`,
        played: entrants - 1, wins: entrants - i, losses: i - 1, draws: 0,
        gamesWon: (entrants - i) * 7, gamesLost: (i - 1) * 7,
        points: (entrants - i) * 3, rank: i, qualified: true,
      },
    })
    ids.push(e.id)
  }
  return { seasonId: s.id, ids }
}

type Row = Awaited<ReturnType<typeof rows>>[number]

const rows = (seasonId: number) =>
  prisma.seasonPlayoffMatch.findMany({ where: { seasonId }, orderBy: [{ round: 'asc' }, { slot: 'asc' }] })

/** Slots that another tie feeds into — the same topology test the production code applies. */
function entrySlots(all: Row[]) {
  const fed = new Set<string>()
  for (const m of all) {
    if (m.feedsMatchId != null) fed.add(`${m.feedsMatchId}:${m.feedsSlot ?? 0}`)
    if (m.loserFeedsMatchId != null) fed.add(`${m.loserFeedsMatchId}:${m.loserFeedsSlot ?? 0}`)
  }
  return (id: number, slot: 0 | 1) => !fed.has(`${id}:${slot}`)
}

/** Ties holding exactly one player, where the empty side is an entry slot — i.e. real byes. */
function byeTiesOf(all: Row[]) {
  const isEntry = entrySlots(all)
  return all.filter((m) => {
    if ((m.homeEntrantId == null) === (m.awayEntrantId == null)) return false
    return m.homeEntrantId == null ? isEntry(m.id, 0) : isEntry(m.id, 1)
  })
}

try {
  // A five-player field fills an eight-slot bracket: three byes, one contested first-round tie.
  console.log('--- Generation leaves byes unplayed and round two empty ---')
  const { seasonId, ids } = await fixtureSeason(5)
  {
    const gen = await generateSeasonBracket(actor, seasonId)
    check('bracket generates', gen.ok, gen.error)

    const all = await rows(seasonId)
    const byeTies = byeTiesOf(all)
    check('the draw really does contain byes — otherwise this suite proves nothing',
      byeTies.length === 3, `${byeTies.length} byes`)

    check('no bye tie has been decided', byeTies.every((m) => m.winnerEntrantId == null),
      `${byeTies.filter((m) => m.winnerEntrantId != null).length} decided`)
    check('no bye tie has been marked COMPLETED', byeTies.every((m) => m.status !== 'COMPLETED'))
    check('the empty side still reads "Bye", so it is not mistaken for a TBD',
      byeTies.every((m) => (m.homeEntrantId == null ? m.homeUsername : m.awayUsername) === 'Bye'))

    // The point of the whole change.
    const beyond = all.filter((m) => m.round > 1)
    const occupied = beyond.flatMap((m) => [m.homeEntrantId, m.awayEntrantId]).filter((v) => v != null)
    check('every slot beyond round one is empty', occupied.length === 0, `${occupied.length} occupied`)

  }

  console.log('')
  console.log('--- An unsettled bye tie is still editable, which is the whole point ---')
  {
    // A separate draw: placing into a bye slot MOVES a player, so doing it above would leave the
    // field the start-of-playoffs checks depend on rearranged.
    const { seasonId: sid } = await fixtureSeason(5)
    await generateSeasonBracket(actor, sid)
    const all = await rows(sid)
    const bye = byeTiesOf(all).find((m) => m.round === 1)!
    const emptySide = bye.homeEntrantId == null ? 'home' as const : 'away' as const
    const occupant = bye.homeEntrantId ?? bye.awayEntrantId
    const mover = all.flatMap((m) => [m.homeEntrantId, m.awayEntrantId])
      .find((id): id is number => id != null && id !== occupant)!

    // Under the old behaviour this tie was COMPLETED at generation and this call was refused.
    const set = await setSeasonBracketSlot(actor, sid, bye.id, emptySide, mover)
    check('a player can be placed into a bye tie', set.ok, set.error)
    const after = await prisma.seasonPlayoffMatch.findUnique({ where: { id: bye.id } })
    check('...and the placement took',
      (emptySide === 'home' ? after?.homeEntrantId : after?.awayEntrantId) === mover)

    const cleared = await setSeasonBracketSlot(actor, sid, bye.id, emptySide, null)
    check('and the slot can be emptied again', cleared.ok, cleared.error)
    const back = await prisma.seasonPlayoffMatch.findUnique({ where: { id: bye.id } })
    check('...leaving it genuinely empty',
      (emptySide === 'home' ? back?.homeEntrantId : back?.awayEntrantId) == null)
  }

  console.log('')
  console.log('--- Starting the playoffs awards them ---')
  {
    const before = await rows(seasonId)
    const expected = byeTiesOf(before)
    const start = await startSeasonPlayoffs(actor, seasonId)
    check('playoffs start', start.ok, start.error)

    const all = await rows(seasonId)
    const settled = all.filter((m) => expected.some((b) => b.id === m.id))
    check('every bye tie is now decided',
      settled.length > 0 && settled.every((m) => m.winnerEntrantId != null),
      `${settled.filter((m) => m.winnerEntrantId == null).length} still open`)
    check('the winner is the real player, never the empty side',
      settled.every((m) => m.winnerEntrantId === (m.homeEntrantId ?? m.awayEntrantId)))

    const r2 = all.filter((m) => m.round === 2)
    const advanced = r2.flatMap((m) => [m.homeEntrantId, m.awayEntrantId]).filter((v) => v != null)
    check('round two now holds exactly the bye recipients',
      advanced.length === expected.length, `${advanced.length} seated, ${expected.length} byes`)

    const contested = all.find((m) => m.round === 1 && m.homeEntrantId != null && m.awayEntrantId != null)
    check('the one genuinely contested tie is left alone',
      contested != null && contested.winnerEntrantId == null)

    const isEntry = entrySlots(all)
    const waiting = r2.find((m) => m.homeEntrantId == null || m.awayEntrantId == null)
    check('the round-two slot waiting on that tie is a fed slot, not a bye',
      waiting != null && !isEntry(waiting.id, waiting.homeEntrantId == null ? 0 : 1))

    check('placement is refused once the bracket is published',
      !(await setSeasonBracketSlot(actor, seasonId, contested!.id, 'home', ids[0]!)).ok)
  }

  console.log('')
  console.log('--- The bracket that gets settled is the EDITED one, not the generated one ---')
  {
    const { seasonId: sid } = await fixtureSeason(5)
    await generateSeasonBracket(actor, sid)
    const all = await rows(sid)
    const byeTie = byeTiesOf(all).find((m) => m.round === 1)!
    const contested = all.find((m) => m.round === 1 && m.homeEntrantId != null && m.awayEntrantId != null)!
    const emptySide = byeTie.homeEntrantId == null ? 'home' as const : 'away' as const
    const moved = contested.awayEntrantId!

    const sw = await swapSeasonBracketSlots(actor, sid,
      { matchId: byeTie.id, side: emptySide }, { matchId: contested.id, side: 'away' })
    check('a player can be dragged out of a contested tie into a bye slot', sw.ok, sw.error)

    const start = await startSeasonPlayoffs(actor, sid)
    check('the edited bracket starts', start.ok, start.error)

    const after = await rows(sid)
    const nowPaired = after.find((m) => m.id === byeTie.id)!
    const nowAlone = after.find((m) => m.id === contested.id)!

    check('the tie that gained an opponent is NOT awarded as a bye',
      nowPaired.winnerEntrantId == null && nowPaired.status !== 'COMPLETED')
    check('...and it holds both players',
      nowPaired.homeEntrantId != null && nowPaired.awayEntrantId != null)
    check('the tie the player left IS now a bye, and is awarded',
      nowAlone.winnerEntrantId != null && nowAlone.winnerEntrantId === nowAlone.homeEntrantId)
    check('the slot they vacated is labelled "Bye" rather than left blank',
      nowAlone.awayUsername === 'Bye', String(nowAlone.awayUsername))
    check('the moved player advanced nowhere — they have a tie to play',
      !after.some((m) => m.round > 1 && (m.homeEntrantId === moved || m.awayEntrantId === moved)))
  }

  console.log('')
  console.log('--- Double elimination behaves the same way ---')
  {
    const { seasonId: sid } = await fixtureSeason(5, true)
    await generateSeasonBracket(actor, sid)
    const all = await rows(sid)
    const wb1 = all.filter((m) => m.section === 'WB' && m.round === 1)
    check('a double-elim draw is generated', wb1.length >= 2, `${all.length} ties`)
    check('no winners-bracket tie is pre-decided at generation',
      wb1.every((m) => m.winnerEntrantId == null))

    const isEntry = entrySlots(all)
    const lb = all.filter((m) => m.section === 'LB')
    check('losers-bracket slots are fed slots, never entry slots',
      lb.length > 0 && lb.every((m) => !isEntry(m.id, 0) && !isEntry(m.id, 1)))
    check('nothing is seated in the losers bracket before a ball is struck',
      lb.every((m) => m.homeEntrantId == null && m.awayEntrantId == null))
    const wbLater = all.filter((m) => m.section === 'WB' && m.round > 1)
    check('and nothing is seated beyond winners-bracket round one either',
      wbLater.length > 0 && wbLater.every((m) => m.homeEntrantId == null && m.awayEntrantId == null),
      `${wbLater.flatMap((m) => [m.homeEntrantId, m.awayEntrantId]).filter((v) => v != null).length} occupied`)

    await startSeasonPlayoffs(actor, sid)
    const after = await rows(sid)
    const decided = after.filter((m) => m.winnerEntrantId != null)
    check('starting awards winners-bracket round-one byes only',
      decided.length > 0 && decided.every((m) => m.section === 'WB' && m.round === 1),
      decided.map((m) => `${m.section}:r${m.round}`).join(',') || 'none')
    check('the losers bracket stays empty and undecided',
      after.filter((m) => m.section === 'LB')
        .every((m) => m.winnerEntrantId == null && m.homeEntrantId == null && m.awayEntrantId == null))
  }

  console.log('')
  console.log('--- A full field has no byes at all ---')
  {
    const { seasonId: sid } = await fixtureSeason(8)
    await generateSeasonBracket(actor, sid)
    await startSeasonPlayoffs(actor, sid)
    const all = await rows(sid)
    check('nobody is advanced when every first-round tie has two players',
      all.every((m) => m.winnerEntrantId == null),
      `${all.filter((m) => m.winnerEntrantId != null).length} decided`)
    check('and no slot beyond round one is occupied',
      all.filter((m) => m.round > 1).every((m) => m.homeEntrantId == null && m.awayEntrantId == null))
  }

  console.log('')
  console.log('--- In the editor, a bye slot accepts a player ---')
  {
    // A bye tie is now un-decided during setup, so the admin will try to drag someone onto it. That
    // only works if the bye row is a drop target — it used to be inert, which did not matter while
    // byes were settled at generation and the whole tie was locked.
    const swap: BracketSwapApi = { selected: null, pick: () => {}, drop: () => {} }
    const withBye: BracketMatch = {
      id: 1, a: { name: 'alice', handle: 'alice', slug: 'alice', seed: 1 }, b: { name: 'Bye' }, winner: null,
    }
    const editable = renderToStaticMarkup(React.createElement(MatchBox, { match: withBye, swap }))
    const readonly = renderToStaticMarkup(React.createElement(MatchBox, { match: withBye }))

    // Two rows in the card; both must be reachable when the bracket is editable.
    check('both rows are interactive in an editable bracket',
      (editable.match(/role="button"/g) ?? []).length === 2,
      `${(editable.match(/role="button"/g) ?? []).length} interactive rows`)
    check('the bye row is keyboard reachable',
      (editable.match(/tabindex="0"/g) ?? []).length === 2)
    check('the bye row invites a drop rather than a drag',
      /Drop a player here/.test(editable))

    // Draggable is the half that must NOT apply to a bye: there is nobody there to pick up.
    check('exactly one row is draggable — the player, not the bye',
      (editable.match(/draggable="true"/g) ?? []).length === 1,
      `${(editable.match(/draggable="true"/g) ?? []).length} draggable`)
    check('the player row is the draggable one', /Drag to move alice/.test(editable))
    // One grab cursor in the whole card, and it belongs to the player row. (The lookahead keeps
    // `cursor-grabbing` from being counted as a second one.)
    check('only the player row offers a grab cursor',
      (editable.match(/cursor-grab(?![a-z])/g) ?? []).length === 1,
      `${(editable.match(/cursor-grab(?![a-z])/g) ?? []).length} grab cursors`)
    check('the bye row offers a drop cursor instead', /cursor-copy/.test(editable))

    // And none of this leaks into a read-only bracket.
    check('a bracket with no swap api stays entirely inert',
      !/role="button"/.test(readonly) && !/draggable="true"/.test(readonly))
    check('an empty TBD slot is still a drop target too',
      /role="button"/.test(renderToStaticMarkup(React.createElement(MatchBox, {
        match: { id: 2, a: { name: 'alice', handle: 'alice', slug: 'alice' }, b: undefined, winner: null } as BracketMatch, swap,
      }))))
  }
} catch (e) {
  fail++
  console.error(e)
} finally {
  await cleanup()
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
await prisma.$disconnect()
process.exit(fail === 0 ? 0 : 1)
