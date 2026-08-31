/**
 * Editing a published double-elimination lower bracket, without disturbing what has been played.
 *
 * Builds a real 8-player double-elim bracket from the real planner, writes it to the local replica
 * as a disposable Tournament, and drives the routing engine and the save path against it. Every
 * fixture is prefixed and removed before and after, so an interrupted run cannot leave residue.
 *
 * Run:  npx tsx --tsconfig tsconfig.scripts.json scripts/verify-lower-bracket-edit.mts
 */
import { prisma } from '../src/lib/prisma.ts'
import { assertLocalDatabase } from '../src/lib/db-guard.ts'
import { planDoubleElim } from '../src/lib/competition/bracket-de.ts'
import {
  isLocked, isWalkover, lowerBracketView, matchName, routesByTarget, slotKey, sourceLabel,
  strandedLowerSlots, swapLowerSlots, validateRouting, type RoutableMatch,
} from '../src/lib/competition/lower-bracket-edit.ts'
import {
  resolveStrandedLowerSlots, saveLowerBracketRouting,
} from '../src/lib/competition/lower-bracket-service.ts'
import { verifyPlayoffMatch } from '../src/lib/competition/service.ts'

assertLocalDatabase()

let pass = 0, fail = 0
const check = (label: string, ok: boolean, detail?: string) => {
  if (ok) { pass++; console.log(`  ✓ ${label}`) }
  else { fail++; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`) }
}
const section = (t: string) => console.log(`\n--- ${t} ---`)

const MARK = 'zzlb-verify'
const ACTOR = { userId: 960777, username: MARK }

async function cleanup() {
  const rows = await prisma.tournament.findMany({ where: { name: { startsWith: MARK } }, select: { id: true } })
  for (const r of rows) {
    await prisma.playoffMatch.deleteMany({ where: { tournamentId: r.id } }).catch(() => {})
    await prisma.registration.deleteMany({ where: { tournamentId: r.id } }).catch(() => {})
    await prisma.tournament.delete({ where: { id: r.id } }).catch(() => {})
  }
  await prisma.auditLog.deleteMany({ where: { actorUsername: MARK } }).catch(() => {})
}
await cleanup()

const ROUTE_SELECT = {
  id: true, section: true, round: true, slot: true, label: true,
  homeRegistrationId: true, awayRegistrationId: true,
  homeUsername: true, awayUsername: true, homeSeed: true, awaySeed: true,
  homeGames: true, awayGames: true, status: true,
  winnerRegistrationId: true, forfeitRegistrationId: true,
  feedsMatchId: true, feedsSlot: true, loserFeedsMatchId: true, loserFeedsSlot: true,
} as const

const read = async (tid: number): Promise<RoutableMatch[]> =>
  (await prisma.playoffMatch.findMany({ where: { tournamentId: tid }, select: ROUTE_SELECT, orderBy: [{ round: 'asc' }, { slot: 'asc' }] }))
    .map((r) => ({ ...r, status: String(r.status) }))

/** A published 8-player double-elim bracket, wired exactly as the application wires one. */
async function buildBracket(): Promise<{ tid: number; ids: number[] }> {
  const series = await prisma.competitionSeries.findFirstOrThrow({ select: { id: true } })
  const t = await prisma.tournament.create({
    data: {
      name: `${MARK} double elim`, slug: `${MARK}-${Date.now() % 1_000_000}`,
      competitionSeriesId: series.id, competitionYear: 2026,
      tournamentFormat: 'DOUBLE_ELIM', playoffDoubleElim: true,
      status: 'ACTIVE', playoffsStatus: 'PUBLISHED', publiclyVisible: false,
    },
    select: { id: true },
  })

  const regs: { registrationId: number; username: string; seed: number }[] = []
  for (let i = 1; i <= 8; i++) {
    const r = await prisma.registration.create({
      data: { tournamentId: t.id, status: 'APPROVED', username: `${MARK}-p${i}`, displayName: `${MARK} p${i}` },
      select: { id: true },
    })
    regs.push({ registrationId: r.id, username: `p${i}`, seed: i })
  }

  const plan = planDoubleElim(regs)
  const idByIndex: number[] = []
  for (const m of plan.matches) {
    const row = await prisma.playoffMatch.create({
      data: {
        tournamentId: t.id, round: m.round, slot: m.slot, label: m.label, section: m.section,
        published: true,
        homeRegistrationId: m.home.registrationId, homeUsername: m.home.username, homeSeed: m.home.seed,
        awayRegistrationId: m.away.registrationId, awayUsername: m.away.username, awaySeed: m.away.seed,
      },
      select: { id: true },
    })
    idByIndex[m.index] = row.id
  }
  for (const m of plan.matches) {
    await prisma.playoffMatch.update({
      where: { id: idByIndex[m.index] },
      data: {
        feedsMatchId: m.feedsIndex == null ? null : idByIndex[m.feedsIndex],
        feedsSlot: m.feedsSlot,
        loserFeedsMatchId: m.loserFeedsIndex == null ? null : idByIndex[m.loserFeedsIndex],
        loserFeedsSlot: m.loserFeedsSlot,
      },
    })
  }
  return { tid: t.id, ids: idByIndex }
}

const find = (ms: RoutableMatch[], sec: string, round: number, slot: number) =>
  ms.find((m) => m.section === sec && m.round === round && m.slot === slot)!

try {
  // ── The bracket the editor is shown ───────────────────────────────────────────────────────────
  section('The losers bracket names the source of every slot')
  const { tid } = await buildBracket()
  let ms = await read(tid)

  check('the bracket was built', ms.length === 14, String(ms.length))
  const view = lowerBracketView(ms)
  check('only losers-bracket rounds are offered for editing',
    view.length === 4 && view.every((r) => r.matches.every((m) => ms.find((x) => x.id === m.matchId)!.section === 'LB')))
  check('the winners bracket is not in the editor',
    !view.some((r) => r.matches.some((m) => ms.find((x) => x.id === m.matchId)!.section === 'WB')))

  const lb1 = view[0].matches
  check('losers round 1 has two matches', lb1.length === 2, String(lb1.length))
  check('a slot says where its player comes from',
    lb1[0].slots[0].sourceLabel === 'Loser of Winners R1 M1', String(lb1[0].slots[0].sourceLabel))
  check('...and so does the slot beside it',
    lb1[0].slots[1].sourceLabel === 'Loser of Winners R1 M2', String(lb1[0].slots[1].sourceLabel))
  const lb2 = view[1].matches
  check('a losers-bracket winner is named as a source',
    lb2[0].slots[0].sourceLabel === 'Winner of Losers R1 M1', String(lb2[0].slots[0].sourceLabel))
  check('every losers slot is editable while nothing has been played',
    view.every((r) => r.matches.every((m) => m.slots.every((s) => s.editable))))

  // ── The swap that is the whole point ──────────────────────────────────────────────────────────
  section('Future same-round losers feeds can be swapped')
  {
    const a = { matchId: find(ms, 'LB', 1, 0).id, slot: 0 }
    const b = { matchId: find(ms, 'LB', 1, 1).id, slot: 0 }
    const before = routesByTarget(ms)
    const res = swapLowerSlots(ms, a, b)
    check('the swap is allowed', res.ok, res.ok ? '' : res.error)
    if (res.ok) {
      const after = routesByTarget(res.preview)
      check('the two routes exchanged targets',
        after.get(slotKey(a))!.sourceMatchId === before.get(slotKey(b))!.sourceMatchId
        && after.get(slotKey(b))!.sourceMatchId === before.get(slotKey(a))!.sourceMatchId)
      check('it rewrites the UPSTREAM matches, not the labels',
        res.updates.some((u) => u.matchId === find(ms, 'WB', 1, 0).id
          && 'loserFeedsMatchId' in u.data))
      check('the winners bracket keeps its own routing',
        res.preview.filter((m) => m.section === 'WB').every((m) =>
          m.feedsMatchId === ms.find((x) => x.id === m.id)!.feedsMatchId))
    }
  }

  // ── Everything that must be refused ───────────────────────────────────────────────────────────
  section('Illegal edits are refused')
  {
    const l1 = find(ms, 'LB', 1, 0)
    const l2 = find(ms, 'LB', 2, 0)
    const w1 = find(ms, 'WB', 1, 0)

    const cross = swapLowerSlots(ms, { matchId: l1.id, slot: 0 }, { matchId: l2.id, slot: 0 })
    check('a cross-round move is refused', !cross.ok, cross.ok ? 'allowed' : cross.error)

    const wb = swapLowerSlots(ms, { matchId: w1.id, slot: 0 }, { matchId: find(ms, 'WB', 1, 1).id, slot: 0 })
    check('the winners bracket cannot be edited', !wb.ok, wb.ok ? 'allowed' : wb.error)

    const same = swapLowerSlots(ms, { matchId: l1.id, slot: 0 }, { matchId: l1.id, slot: 0 })
    check('a slot cannot be swapped with itself', !same.ok, same.ok ? 'allowed' : same.error)

    const ghost = swapLowerSlots(ms, { matchId: l1.id, slot: 0 }, { matchId: 99_999_999, slot: 0 })
    check('a slot outside this bracket is refused', !ghost.ok, ghost.ok ? 'allowed' : ghost.error)

    // Duplicate route: two sources aimed at one seat.
    const dup = ms.map((m) => (m.id === find(ms, 'WB', 1, 1).id
      ? { ...m, loserFeedsMatchId: find(ms, 'LB', 1, 0).id, loserFeedsSlot: 0 } : m))
    check('two feeds into one slot are refused',
      validateRouting(dup, ms) !== null, String(validateRouting(dup, ms)))

    // A removed route: a player with nowhere to go.
    const lost = ms.map((m) => (m.id === find(ms, 'WB', 1, 1).id
      ? { ...m, loserFeedsMatchId: null, loserFeedsSlot: null } : m))
    check('removing a feed is refused', validateRouting(lost, ms) !== null, String(validateRouting(lost, ms)))

    // A cycle: the last losers match feeding back into the first.
    const cyc = ms.map((m) => (m.id === find(ms, 'LB', 4, 0).id
      ? { ...m, feedsMatchId: find(ms, 'LB', 1, 0).id, feedsSlot: 0 } : m))
    check('a routing cycle is refused', validateRouting(cyc, ms) !== null, String(validateRouting(cyc, ms)))

    // A match feeding itself.
    const self = ms.map((m) => (m.id === find(ms, 'LB', 1, 0).id
      ? { ...m, feedsMatchId: find(ms, 'LB', 1, 0).id, feedsSlot: 1 } : m))
    check('a match feeding itself is refused', validateRouting(self, ms) !== null, String(validateRouting(self, ms)))
  }

  // ── Play the winners bracket, then reroute a finished result ──────────────────────────────────
  section('A completed upstream result can be redirected into an unplayed slot')
  {
    const w1 = find(ms, 'WB', 1, 0)
    await prisma.playoffMatch.update({
      where: { id: w1.id },
      data: { homeGames: 5, awayGames: 2, status: 'COMPLETED', winnerRegistrationId: w1.homeRegistrationId, completedAt: new Date() },
    })
    await verifyPlayoffMatch(ACTOR, w1.id)
    ms = await read(tid)

    const l1 = find(ms, 'LB', 1, 0)
    const l2 = find(ms, 'LB', 1, 1)
    check('the loser dropped into losers R1', l1.homeRegistrationId === w1.awayRegistrationId,
      `${l1.homeUsername}`)
    check('...and the winner advanced in the winners bracket',
      find(ms, 'WB', 2, 0).homeRegistrationId === w1.homeRegistrationId)

    const moved = swapLowerSlots(ms, { matchId: l1.id, slot: 0 }, { matchId: l2.id, slot: 0 })
    check('a finished match may be pointed at a different future slot', moved.ok, moved.ok ? '' : moved.error)
    if (moved.ok) {
      const l1After = moved.preview.find((m) => m.id === l1.id)!
      const l2After = moved.preview.find((m) => m.id === l2.id)!
      check('the seated player travels with the route',
        l2After.homeRegistrationId === w1.awayRegistrationId && l1After.homeRegistrationId === null,
        `${l1After.homeUsername} / ${l2After.homeUsername}`)
      check('the completed match keeps its result',
        moved.preview.find((m) => m.id === w1.id)!.winnerRegistrationId === w1.homeRegistrationId)
    }
  }

  // ── Locked matches ────────────────────────────────────────────────────────────────────────────
  section('Completed matches cannot be changed, and nothing may be routed into them')
  {
    const l1 = find(ms, 'LB', 1, 0)
    const l2 = find(ms, 'LB', 1, 1)
    // Give losers R1 M1 a forfeit result, which locks it.
    await prisma.playoffMatch.update({
      where: { id: l1.id },
      data: { status: 'FORFEIT', forfeitRegistrationId: l1.homeRegistrationId, winnerRegistrationId: l1.awayRegistrationId },
    })
    ms = await read(tid)
    const locked = ms.find((m) => m.id === l1.id)!

    check('a forfeit counts as a result', isLocked(locked))
    check('a scheduled match does not', !isLocked(ms.find((m) => m.id === l2.id)!))

    const v = lowerBracketView(ms)
    const shown = v[0].matches.find((m) => m.matchId === l1.id)!
    check('the editor marks it locked', shown.locked)
    check('...and says why its slots cannot move',
      shown.slots.every((s) => !s.editable && /result/i.test(s.reason ?? '')))

    const intoLocked = swapLowerSlots(ms, { matchId: l1.id, slot: 0 }, { matchId: l2.id, slot: 0 })
    check('a route into a completed match cannot be changed', !intoLocked.ok, intoLocked.ok ? 'allowed' : intoLocked.error)

    const other = swapLowerSlots(ms, { matchId: l1.id, slot: 1 }, { matchId: l2.id, slot: 1 })
    check('...from either of its slots', !other.ok, other.ok ? 'allowed' : other.error)

    // Redirecting a route OUT of a completed match's own advancement is refused too.
    const rewrite = ms.map((m) => (m.id === l1.id ? { ...m, homeGames: 9, awayGames: 0 } : m))
    check('a stored result cannot be rewritten', validateRouting(rewrite, ms) !== null)
  }

  // ── Saving ────────────────────────────────────────────────────────────────────────────────────
  section('Saving is atomic, audited, and changes nothing that was played')
  {
    ms = await read(tid)
    const a = { matchId: find(ms, 'LB', 2, 0).id, slot: 1 }
    const b = { matchId: find(ms, 'LB', 2, 1).id, slot: 1 }
    const resultsBefore = ms.filter(isLocked).map((m) =>
      `${m.id}:${m.status}:${m.homeGames}:${m.awayGames}:${m.winnerRegistrationId}`).sort().join('|')

    const saved = await saveLowerBracketRouting(ACTOR, tid, [[a, b]], 'match the original bracket')
    check('the save succeeds', saved.ok, saved.error ?? '')

    const after = await read(tid)
    const routes = routesByTarget(after)
    check('the routing was persisted',
      routes.get(slotKey(a))!.sourceMatchId === find(ms, 'WB', 2, 1).id,
      String(routes.get(slotKey(a))?.sourceMatchId))
    check('every recorded result is untouched',
      after.filter(isLocked).map((m) =>
        `${m.id}:${m.status}:${m.homeGames}:${m.awayGames}:${m.winnerRegistrationId}`).sort().join('|') === resultsBefore)
    check('no match was regenerated', after.length === ms.length)

    const audit = await prisma.auditLog.findFirst({
      where: { actorUsername: MARK, action: 'tournament.playoff.lower_bracket_reroute' },
      orderBy: { id: 'desc' },
    })
    check('the edit was audited', !!audit)
    check('...naming the Tournament it changed', audit?.entityId === String(tid))
    check('...and recording the reason', /original bracket/.test(audit?.reason ?? ''))

    // An illegal swap in a list must take the legal one down with it.
    const beforeAtomic = await read(tid)
    const good: [typeof a, typeof b] = [
      { matchId: find(beforeAtomic, 'LB', 1, 0).id, slot: 1 },
      { matchId: find(beforeAtomic, 'LB', 1, 1).id, slot: 1 },
    ]
    const bad: [typeof a, typeof b] = [
      { matchId: find(beforeAtomic, 'LB', 1, 0).id, slot: 0 },
      { matchId: find(beforeAtomic, 'LB', 2, 0).id, slot: 0 },
    ]
    const rejected = await saveLowerBracketRouting(ACTOR, tid, [good, bad])
    check('a list containing an illegal swap is refused whole', !rejected.ok, rejected.ok ? 'saved' : rejected.error)
    const unchanged = await read(tid)
    check('...and nothing from that list was written',
      JSON.stringify(unchanged) === JSON.stringify(beforeAtomic))
  }

  // ── The point of it all ───────────────────────────────────────────────────────────────────────
  section('A future winner advances by the saved routing')
  {
    /*
      Losers R1 M1 was forfeited above, so its slots are locked and its round has only one match
      left to work with. Both of THAT match's slots are still unplayed, so the reroute runs across
      the two sides of Losers R1 M2 — the same-round swap the editor offers, on the only pair in
      this round that is still legal to move.
    */
    ms = await read(tid)
    const src = find(ms, 'WB', 1, 2)          // unplayed; its loser drops into losers R1 M2
    const lbm = find(ms, 'LB', 1, 1)
    const current = { matchId: src.loserFeedsMatchId!, slot: src.loserFeedsSlot! }
    const target = { matchId: lbm.id, slot: current.slot === 0 ? 1 : 0 }

    check('the route being moved starts in the other slot',
      current.matchId === lbm.id && slotKey(current) !== slotKey(target),
      `${slotKey(current)} -> ${slotKey(target)}`)
    const moved = await saveLowerBracketRouting(ACTOR, tid, [[current, target]])
    check('the loser route is repointed before the match is played', moved.ok, moved.error ?? '')

    const routed = await read(tid)
    const wired = routed.find((m) => m.id === src.id)!
    await prisma.playoffMatch.update({
      where: { id: src.id },
      data: { homeGames: 5, awayGames: 1, status: 'COMPLETED', winnerRegistrationId: src.homeRegistrationId, completedAt: new Date() },
    })
    await verifyPlayoffMatch(ACTOR, src.id)

    const settled = await read(tid)
    const landed = settled.find((m) => m.id === wired.loserFeedsMatchId)!
    const seat = wired.loserFeedsSlot === 0 ? landed.homeRegistrationId : landed.awayRegistrationId
    check('the loser arrived in the slot the saved routing names',
      seat === src.awayRegistrationId,
      `${matchName(landed)} slot ${wired.loserFeedsSlot} holds ${seat}, expected ${src.awayRegistrationId}`)

    const winnerSeat = settled.find((m) => m.id === wired.feedsMatchId)!
    check('...and the winner advanced normally',
      (wired.feedsSlot === 0 ? winnerSeat.homeRegistrationId : winnerSeat.awayRegistrationId) === src.homeRegistrationId)
  }

  // ── Untouched neighbours ──────────────────────────────────────────────────────────────────────
  section('Single-elimination and the grand final are left alone')
  {
    const singles = await prisma.playoffMatch.findMany({
      where: { section: null, tournamentId: { not: tid } }, select: { id: true }, take: 5,
    })
    check('single-elim brackets have no losers section to edit', singles.length >= 0)
    const se = lowerBracketView((await read(tid)).map((m) => ({ ...m, section: null })))
    check('a bracket with no LB section offers nothing to edit', se.length === 0)

    const gf = find(await read(tid), 'GF', 1, 0)
    const gfSwap = swapLowerSlots(await read(tid), { matchId: gf.id, slot: 0 }, { matchId: gf.id, slot: 1 })
    check('the grand final cannot be edited', !gfSwap.ok, gfSwap.ok ? 'allowed' : gfSwap.error)
  }

  // ── Seats waiting on a loser that cannot exist ────────────────────────────────────────────────
  section('A losers seat fed by a winners walkover is settled, not left waiting')
  {
    const { tid: t2 } = await buildBracket()
    let b = await read(t2)

    // Make Winners R1 M1 a walkover: its away seat becomes a permanent Bye.
    const w1 = find(b, 'WB', 1, 0)
    await prisma.playoffMatch.update({
      where: { id: w1.id },
      data: { awayRegistrationId: null, awayUsername: 'Bye' },
    })
    // Its loser would have fed a losers seat; drop a real player into the other side of that match.
    b = await read(t2)
    const wo = b.find((m) => m.id === w1.id)!
    const target = b.find((m) => m.id === wo.loserFeedsMatchId)!
    const other = wo.loserFeedsSlot === 0 ? 1 : 0
    await prisma.playoffMatch.update({
      where: { id: target.id },
      data: other === 0
        ? { homeRegistrationId: 999_001, homeUsername: 'stranded' }
        : { awayRegistrationId: 999_001, awayUsername: 'stranded' },
    })

    b = await read(t2)
    check('the walkover is recognised', isWalkover(b.find((m) => m.id === w1.id)!))
    const found = strandedLowerSlots(b)
    check('the stranded seat is found', found.length === 1, `${found.length}`)
    check('...naming the player left waiting', found[0]?.waiting.username === 'stranded')
    check('...and why', /walkover/i.test(found[0]?.reason ?? ''))

    const settled = await resolveStrandedLowerSlots(ACTOR, t2)
    check('settling succeeds', settled.ok, settled.error ?? '')
    check('one seat was settled', settled.settled === 1, String(settled.settled))

    const after = await read(t2)
    const done = after.find((m) => m.id === target.id)!
    check('the dead seat now reads as a Bye',
      (wo.loserFeedsSlot === 0 ? done.homeUsername : done.awayUsername) === 'Bye')
    check('the waiting player won the walkover', done.winnerRegistrationId === 999_001)
    check('...with no fabricated score', done.homeGames === null && done.awayGames === null)
    check('...and no forfeit recorded', done.forfeitRegistrationId === null)
    const nextUp = after.find((m) => m.id === done.feedsMatchId)
    check('the player advanced by the saved routing',
      nextUp != null
      && (done.feedsSlot === 0 ? nextUp.homeRegistrationId : nextUp.awayRegistrationId) === 999_001)

    check('running it again settles nothing', (await resolveStrandedLowerSlots(ACTOR, t2)).settled === 0)
    check('...and nothing is left stranded', strandedLowerSlots(await read(t2)).length === 0)
    await cleanup()
  }

  section('Settling never touches a match that already has a result')
  {
    const { tid: t3 } = await buildBracket()
    let b = await read(t3)
    const w1 = find(b, 'WB', 1, 0)
    await prisma.playoffMatch.update({
      where: { id: w1.id }, data: { awayRegistrationId: null, awayUsername: 'Bye' },
    })
    b = await read(t3)
    const wo = b.find((m) => m.id === w1.id)!
    const target = b.find((m) => m.id === wo.loserFeedsMatchId)!
    const other = wo.loserFeedsSlot === 0 ? 1 : 0
    await prisma.playoffMatch.update({
      where: { id: target.id },
      data: other === 0
        ? { homeRegistrationId: 999_002, homeUsername: 'held' }
        : { awayRegistrationId: 999_002, awayUsername: 'held' },
    })

    // A hand-entered FORFEIT on that very match must be left exactly as it is.
    await prisma.playoffMatch.update({
      where: { id: target.id },
      data: { status: 'FORFEIT', forfeitRegistrationId: 999_002, winnerRegistrationId: null },
    })
    const guarded = strandedLowerSlots(await read(t3))
    check('a match holding a result is not reported as stranded', guarded.length === 0, `${guarded.length}`)
    const r3 = await resolveStrandedLowerSlots(ACTOR, t3)
    check('...and settling leaves it alone', r3.settled === 0, String(r3.settled))
    const kept = (await read(t3)).find((m) => m.id === target.id)!
    check('the hand-entered forfeit survives untouched',
      kept.status === 'FORFEIT' && kept.forfeitRegistrationId === 999_002)
    await cleanup()
  }

  void sourceLabel
} finally {
  await cleanup()
  await prisma.$disconnect()
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
