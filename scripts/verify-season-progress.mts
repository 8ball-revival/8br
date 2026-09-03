/**
 * Season Progress and Yahoo Archives — the homepage's lower row, checked against real behaviour.
 *
 * ── Why this builds a season rather than asserting on one ───────────────────────────────────────
 * Every figure this panel shows is written by `recomputeSeasonStandings`, and the interesting cases
 * are all about what a result IS: a forfeit that moves the set record but counts no games, a draw
 * that scores without a winner, a no-contest that must contribute nothing, an edited score that has
 * to change the aggregate immediately. None of that can be checked by reading a finished season —
 * it needs results to be entered, and then changed.
 *
 * So the suite drives the genuine pipeline: entrants, groups, `publishSeasonGroups`,
 * `saveSeasonGroupResults`. If the panel and the competition engine ever disagree about what a
 * forfeit is worth, this fails, because both sides of the comparison are the real code.
 *
 * ── The fixtures, and why this Season ───────────────────────────────────────────────────────────
 * 8BRCAM Season 2 of 2026 is used because it is genuinely EMPTY — no entrants, no groups, no
 * standings, registration still open. So the teardown restores it exactly: deleting what was
 * created returns it to zero rows, which is where it started. Nothing historical is touched, and
 * the suite refuses to run at all if that Season turns out to have real data in it.
 *
 * Run:  npx tsx --tsconfig tsconfig.scripts.json scripts/verify-season-progress.mts
 */
import { readFileSync } from 'node:fs'
import { prisma } from '../src/lib/prisma.ts'
import { assertLocalDatabase } from '../src/lib/db-guard.ts'
import { publishSeasonGroups } from '../src/lib/seasons/groups.ts'
import { saveSeasonGroupResults, recomputeSeasonStandings } from '../src/lib/seasons/group-stage.ts'
import { computeSeasonProgress } from '../src/lib/home/season-progress.ts'
import { compareSeasonProgress, formatPct, gameWinPct } from '../src/lib/home/season-progress-order.ts'
import { getLadder } from '../src/lib/stats/ladder.ts'

assertLocalDatabase()

let pass = 0, fail = 0
const check = (label: string, ok: boolean, detail?: string) => {
  if (ok) { pass++; console.log(`  ✓ ${label}`) }
  else { fail++; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`) }
}
const section = (t: string) => console.log(`\n--- ${t} ---`)

/** Source with comments stripped: these files EXPLAIN what they avoid, so prose would false-match. */
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

const ACTOR = { userId: 0, username: 'verify-season-progress' }
const TARGET = { seriesSlug: '8brcam', number: 2, year: 2026 }

// ── The pure rules, before anything touches a database ──────────────────────────────────────────

section('Percentage, formatted the way a standings column reads')

check('44 of 50 games is 88%', formatPct(gameWinPct(44, 6)) === '88%', formatPct(gameWinPct(44, 6)))
check('...printed as 88%, not 88.0%', !formatPct(gameWinPct(44, 6)).includes('.0'))
check('5 of 6 is 83.3%, keeping the decimal that distinguishes it', formatPct(gameWinPct(5, 1)) === '83.3%', formatPct(gameWinPct(5, 1)))
check('a clean two thirds still rounds to one place', formatPct(gameWinPct(2, 1)) === '66.7%', formatPct(gameWinPct(2, 1)))
/*
  The distinction the panel exists to keep: no games recorded is not the same as no games won.

  `0%` is a claim about games that were played and lost. A player who has not started, and a player
  whose only result is a forfeit, have no game record at all — and the column has to say so.
*/
check('no games recorded shows an em dash, never 0%', formatPct(gameWinPct(0, 0)) === '—', formatPct(gameWinPct(0, 0)))
check('...and losing every game genuinely does show 0%', formatPct(gameWinPct(0, 10)) === '0%', formatPct(gameWinPct(0, 10)))

section('The cross-group order, as a rule on its own')

const row = (o: Partial<Parameters<typeof compareSeasonProgress>[0]>) => ({
  played: 0, wins: 0, losses: 0, draws: 0, gamesWon: 0, gamesLost: 0, points: 0,
  ladderRank: null as number | null, handle: 'x', ...o,
})

check('a player who has played outranks one who has not, whatever their ladder rank',
  compareSeasonProgress(row({ played: 1, points: 0, ladderRank: 500 }), row({ played: 0, ladderRank: 1 })) < 0)
check('points decide it first',
  compareSeasonProgress(row({ played: 3, points: 9 }), row({ played: 5, points: 8 })) < 0)
check('...then set win percentage, so 3-0 beats 3-2 at equal points',
  compareSeasonProgress(
    row({ played: 3, wins: 3, points: 6 }),
    row({ played: 5, wins: 3, losses: 2, points: 6 })) < 0)
check('...then game differential',
  compareSeasonProgress(
    row({ played: 2, wins: 1, losses: 1, gamesWon: 15, gamesLost: 5, points: 3 }),
    row({ played: 2, wins: 1, losses: 1, gamesWon: 10, gamesLost: 10, points: 3 })) < 0)
check('...then games won, when the differential is also equal',
  compareSeasonProgress(
    row({ played: 2, wins: 1, losses: 1, gamesWon: 12, gamesLost: 8, points: 3 }),
    row({ played: 2, wins: 1, losses: 1, gamesWon: 6, gamesLost: 2, points: 3 })) < 0)
check('...then ladder rank, as the deterministic tiebreak',
  compareSeasonProgress(row({ played: 1, ladderRank: 4 }), row({ played: 1, ladderRank: 9 })) < 0)
check('...and finally the CueVerse ID, so the order is total',
  compareSeasonProgress(row({ played: 1, handle: 'aaa' }), row({ played: 1, handle: 'zzz' })) < 0)
check('unplayed entrants are ordered by ladder rank, best first',
  compareSeasonProgress(row({ ladderRank: 1 }), row({ ladderRank: 2 })) < 0)
/*
  Unranked means never played a ranked match, so it sorts LAST among the unplayed.

  Treating a null rank as zero would put every entrant the ladder has never seen above the world
  number one — the opposite of what the word means.
*/
check('an unranked entrant falls below every ranked unplayed one',
  compareSeasonProgress(row({ ladderRank: null, handle: 'aaa' }), row({ ladderRank: 34, handle: 'zzz' })) > 0)
check('two unranked entrants fall back to alphabetical order',
  compareSeasonProgress(row({ ladderRank: null, handle: 'alpha' }), row({ ladderRank: null, handle: 'beta' })) < 0)

const orderSrc = code(readFileSync('src/lib/home/season-progress-order.ts', 'utf8'))
check('the order does not depend on the runtime locale', !/localeCompare|Intl\.Collator/.test(orderSrc))
check('...and folds case through the shared member-order helper', /foldForSort/.test(orderSrc))

// ── Fixtures ────────────────────────────────────────────────────────────────────────────────────

section('Disposable fixtures on an empty Season')

const season = await prisma.season.findFirst({
  where: { competitionSeries: { slug: TARGET.seriesSlug }, number: TARGET.number, competitionYear: TARGET.year },
  select: { id: true, lifecycleState: true },
})
if (!season) { console.log('\n8BRCAM Season 2 of 2026 is not in this database. Nothing to verify against.'); process.exit(1) }

const existing = await prisma.seasonEntrant.count({ where: { seasonId: season.id } })
if (existing > 0) {
  console.log(`\nREFUSING: Season ${season.id} already has ${existing} entrant(s). This suite only runs`)
  console.log('against an empty Season, so that its teardown restores the exact prior state.')
  process.exit(1)
}
const originalState = season.lifecycleState

/*
  Thirty-two entrants, drawn from real players so handles and ladder ranks are real.

  `sixohtwo` is required to be ladder number one for one of the checks below, and it is asserted
  rather than assumed — if a reseed changes the ladder, this fails with a clear reason instead of
  quietly checking nothing.
*/
const ladder = await getLadder('current')
check('the ladder has enough ranked players to build a 32-entrant season', ladder.length >= 20, `${ladder.length}`)
check('sixohtwo is the top-ranked ladder player, as this suite assumes', ladder[0]?.cueverseId === 'sixohtwo', ladder[0]?.cueverseId ?? 'none')

const ranked = ladder.map((r) => ({ playerId: r.playerId, handle: r.cueverseId ?? r.name }))
const rankedIds = new Set(ranked.map((r) => r.playerId))
/* Two entrants the ladder has never ranked, for the unranked-below-ranked check. */
const unrankedPool = await prisma.player.findMany({
  where: { active: true, managementOnly: false, cueverseId: { not: null }, id: { notIn: [...rankedIds] } },
  select: { id: true, cueverseId: true },
  orderBy: { cueverseId: 'asc' },
  take: 2,
})
check('two never-ranked players are available for the unranked case', unrankedPool.length === 2)

const starkiller = ranked.find((r) => r.handle === 'Starkiller')
check('Starkiller is on the ladder, as the worked example needs', !!starkiller, starkiller?.handle ?? 'missing')

/*
  Group A is the played group and holds the worked example. Six players, so a full slate is five
  matches and completing it earns the completion point — which is the condition the mockup's headline
  row depends on.

  Group B carries the draw, the forfeit and the no-contest. Groups C–F are never played at all.
*/
const groupAHandles = ['Starkiller', 'Travis', 'l_Mr_CC_l', 'easyrun', 'S_U_K_I_O_O', 'Iantunstall']
const groupA = groupAHandles.map((h) => ranked.find((r) => r.handle === h)).filter((r): r is { playerId: string; handle: string } => !!r)
check('group A can be built from six known ladder players', groupA.length === 6, `${groupA.length}`)

/*
  sixohtwo is deliberately held out of groups A and B.

  Those are the two groups this suite enters results into, and one of the checks below requires the
  top-ranked ladder player to have played NOTHING. Left in ladder order sixohtwo would be first in
  the remainder and would therefore land in group B, pick up the draw, and quietly invalidate the
  check — which is exactly what happened the first time.
*/
const usedA = new Set(groupA.map((r) => r.playerId))
const rest = ranked.filter((r) => !usedA.has(r.playerId) && r.handle !== 'sixohtwo')
const sixohtwo = ranked.find((r) => r.handle === 'sixohtwo')!
const roster = [
  ...groupA,                                                    // group A — the worked example
  ...rest.slice(0, 6),                                          // group B — draw, forfeit, no contest
  sixohtwo,                                                     // group C onwards — never played
  ...rest.slice(6, 6 + 17),
  ...unrankedPool.map((p) => ({ playerId: p.id, handle: p.cueverseId! })),
].slice(0, 32)
check('the roster is exactly 32 players', roster.length === 32, `${roster.length}`)

async function teardown(): Promise<void> {
  /*
    Standings and matches cascade from the groups; entrants cascade from nothing, so they go
    explicitly. The Season's own row is restored to the lifecycle state and count it started with.
  */
  await prisma.seasonMatch.deleteMany({ where: { seasonId: season!.id } })
  await prisma.seasonStanding.deleteMany({ where: { seasonId: season!.id } })
  await prisma.seasonGroupPlayer.deleteMany({ where: { group: { seasonId: season!.id } } })
  await prisma.seasonGroup.deleteMany({ where: { seasonId: season!.id } })
  await prisma.seasonEntrant.deleteMany({ where: { seasonId: season!.id } })
  await prisma.season.update({
    where: { id: season!.id },
    data: { lifecycleState: originalState, entrantsCount: 0 },
  })
}

let entrantByHandle = new Map<string, number>()

try {
  const players = await prisma.player.findMany({
    where: { id: { in: roster.map((r) => r.playerId) } },
    select: { id: true, primaryName: true, cueverseId: true },
  })
  const meta = new Map(players.map((p) => [p.id, p]))

  for (const r of roster) {
    const p = meta.get(r.playerId)
    await prisma.seasonEntrant.create({
      data: {
        seasonId: season.id, playerId: r.playerId,
        username: p?.cueverseId || p?.primaryName || r.handle,
        displayName: p?.primaryName ?? null,
        cueverseId: p?.cueverseId ?? null,
        status: 'APPROVED', addedByAdmin: true,
      },
    })
  }
  const entrants = await prisma.seasonEntrant.findMany({
    where: { seasonId: season.id }, select: { id: true, playerId: true },
  })
  const entrantByPlayer = new Map(entrants.map((e) => [e.playerId!, e.id]))
  entrantByHandle = new Map(roster.map((r) => [r.handle, entrantByPlayer.get(r.playerId)!]))

  // Six groups: 6, 6, 5, 5, 5, 5 = 32.
  const sizes = [6, 6, 5, 5, 5, 5]
  let cursor = 0
  const groupIds: number[] = []
  for (let i = 0; i < sizes.length; i++) {
    const g = await prisma.seasonGroup.create({
      data: { seasonId: season.id, code: String.fromCharCode(65 + i), ordinal: i },
      select: { id: true },
    })
    groupIds.push(g.id)
    const slice = roster.slice(cursor, cursor + sizes[i])
    cursor += sizes[i]
    for (const r of slice) {
      await prisma.seasonGroupPlayer.create({
        data: { groupId: g.id, entrantId: entrantByPlayer.get(r.playerId)! },
      })
    }
  }

  await prisma.season.update({ where: { id: season.id }, data: { lifecycleState: 'GROUP_SETUP', entrantsCount: 32 } })
  const published = await publishSeasonGroups(ACTOR, season.id)
  check('the groups publish through the real pipeline', published.ok, published.error)

  const matches = await prisma.seasonMatch.findMany({
    where: { seasonId: season.id },
    select: { id: true, groupId: true, homeEntrantId: true, awayEntrantId: true, version: true },
  })
  check('a full round robin was scheduled for every group', matches.length === 15 + 15 + 10 * 4, `${matches.length}`)

  // ── The worked example ─────────────────────────────────────────────────────────────────────────

  section('The worked example: 9-1, 9-1, 8-2, 8-2, 10-0')

  const starkillerEntrant = entrantByHandle.get('Starkiller')!
  const SCORES = [[9, 1], [9, 1], [8, 2], [8, 2], [10, 0]]
  const starkillerMatches = matches.filter(
    (m) => m.groupId === groupIds[0]
      && (m.homeEntrantId === starkillerEntrant || m.awayEntrantId === starkillerEntrant),
  )
  check('Starkiller has five group fixtures, which is a full slate in a group of six',
    starkillerMatches.length === 5, `${starkillerMatches.length}`)

  const saved = await saveSeasonGroupResults(ACTOR, season.id, groupIds[0], starkillerMatches.map((m, i) => {
    const [won, lost] = SCORES[i]
    const home = m.homeEntrantId === starkillerEntrant
    return { matchId: m.id, home: String(home ? won : lost), away: String(home ? lost : won), version: m.version }
  }))
  check('the five results save', saved.ok, saved.error)

  const view1 = await computeSeasonProgress(TARGET)
  check('the panel resolves the Season by competition relation, number and year', !!view1, 'not resolved')
  const top = view1!.rows[0]

  check('the leader is Starkiller', top.handle === 'Starkiller', top.handle)
  check('SETS reads 5-0-0', `${top.wins}-${top.losses}-${top.draws}` === '5-0-0', `${top.wins}-${top.losses}-${top.draws}`)
  check('GAMES reads 44-6', `${top.gamesWon}-${top.gamesLost}` === '44-6', `${top.gamesWon}-${top.gamesLost}`)
  check('WIN % reads 88%', formatPct(top.gameWinPct) === '88%', formatPct(top.gameWinPct))
  /*
    ── PTS: 16, and why the reference image says 6 ────────────────────────────────────────────────

    The official rule is Win = 3, Draw = 1, plus 1 for completing every scheduled set in the group,
    and it lives in `computeStandings` — the only place in the codebase that decides it. Five wins
    plus a completed five-match slate is therefore 5x3 + 1 = 16.

    The mockup's column shows 6 for the same row, which is 5x1 + 1: a Win = 1 scale this project has
    never used. (The stored rows for Season 1 of 2026 carry Win = 2, the rule in force when that
    season was closed — which is exactly why the panel READS `Standing.points` rather than
    recomputing it.) The brief is explicit that the panel must use the application's official points
    and must not hardcode the figures in the image, so the official value is what is asserted here.
  */
  const groupSize = 6
  const expectedPoints = 5 * 3 + (groupSize - 1 === 5 ? 1 : 0)
  check(`PTS is the official ${expectedPoints}: five wins at 3, plus the completion bonus`,
    top.points === expectedPoints, `${top.points}`)
  check('...which is the stored standings value, not a homepage calculation', await (async () => {
    const stored = await prisma.seasonStanding.findFirst({
      where: { seasonId: season.id, entrantId: starkillerEntrant }, select: { points: true },
    })
    return stored?.points === top.points
  })())

  // ── Draw, forfeit, no contest ─────────────────────────────────────────────────────────────────

  section('A draw, a forfeit and a no contest')

  const groupB = matches.filter((m) => m.groupId === groupIds[1])
  const drawMatch = groupB[0]
  const drawSave = await saveSeasonGroupResults(ACTOR, season.id, groupIds[1], [
    { matchId: drawMatch.id, home: '5', away: '5', version: drawMatch.version },
  ])
  check('an equal score saves as a draw', drawSave.ok, drawSave.error)

  let view = await computeSeasonProgress(TARGET)
  const drawRow = view!.rows.find((r) => r.entrantId === drawMatch.homeEntrantId)!
  check('a draw is recorded in SETS as 0-0-1', `${drawRow.wins}-${drawRow.losses}-${drawRow.draws}` === '0-0-1',
    `${drawRow.wins}-${drawRow.losses}-${drawRow.draws}`)
  check('...and its games still count', `${drawRow.gamesWon}-${drawRow.gamesLost}` === '5-5',
    `${drawRow.gamesWon}-${drawRow.gamesLost}`)
  check('...and it scores a point under the official rule', drawRow.points === 1, `${drawRow.points}`)

  /*
    A forfeit needs an explicit confirmation, which is the real path's own safeguard. Asking for it
    once WITHOUT the flag proves the guard is still there before the suite consents to it.
  */
  const ffMatch = groupB.find((m) => m.id !== drawMatch.id)!
  const unconfirmed = await saveSeasonGroupResults(ACTOR, season.id, groupIds[1], [
    { matchId: ffMatch.id, home: 'FF', away: '', version: ffMatch.version },
  ])
  check('a forfeit is not accepted without confirmation', !unconfirmed.ok && !!unconfirmed.needConfirmFF)
  const ffSave = await saveSeasonGroupResults(ACTOR, season.id, groupIds[1], [
    { matchId: ffMatch.id, home: 'FF', away: '', version: ffMatch.version },
  ], { confirmFF: true })
  check('a confirmed forfeit saves', ffSave.ok, ffSave.error)

  view = await computeSeasonProgress(TARGET)
  const forfeiter = view!.rows.find((r) => r.entrantId === ffMatch.homeEntrantId)!
  const awarded = view!.rows.find((r) => r.entrantId === ffMatch.awayEntrantId)!
  check('the forfeiting player takes the loss', forfeiter.losses === 1, `${forfeiter.losses}`)
  check('the opponent is awarded the set', awarded.wins === 1, `${awarded.wins}`)
  /*
    The point of this pair: a walkover moves the SET record and invents no games.

    `recomputeSeasonStandings` hands a forfeit to the standings as 0-0 with a winner, so there is no
    numeric score for the panel to add up — which is why the win-percentage column has to read as
    "nothing recorded" rather than as 0% or 100%.
  */
  check('a forfeit fabricates no games for the winner', `${awarded.gamesWon}-${awarded.gamesLost}` === '0-0',
    `${awarded.gamesWon}-${awarded.gamesLost}`)
  check('...nor for the forfeiter', `${forfeiter.gamesWon}-${forfeiter.gamesLost}` === '0-0',
    `${forfeiter.gamesWon}-${forfeiter.gamesLost}`)
  check('...and the winner\'s WIN % is an em dash, not 100%', formatPct(awarded.gameWinPct) === '—',
    formatPct(awarded.gameWinPct))

  const ncMatch = groupB.find((m) => m.id !== drawMatch.id && m.id !== ffMatch.id)!
  const beforeNc = (await computeSeasonProgress(TARGET))!.rows.find((r) => r.entrantId === ncMatch.homeEntrantId)!
  await prisma.seasonMatch.update({ where: { id: ncMatch.id }, data: { status: 'NO_CONTEST' } })
  await recomputeSeasonStandings(season.id)
  const afterNc = (await computeSeasonProgress(TARGET))!.rows.find((r) => r.entrantId === ncMatch.homeEntrantId)!
  check('a no contest contributes nothing to sets',
    afterNc.wins === beforeNc.wins && afterNc.losses === beforeNc.losses && afterNc.draws === beforeNc.draws)
  check('...nothing to games',
    afterNc.gamesWon === beforeNc.gamesWon && afterNc.gamesLost === beforeNc.gamesLost)
  check('...and nothing to points', afterNc.points === beforeNc.points)

  const voidBefore = (await computeSeasonProgress(TARGET))!.rows.find((r) => r.entrantId === ncMatch.awayEntrantId)!
  await prisma.seasonMatch.update({ where: { id: ncMatch.id }, data: { status: 'VOID' } })
  await recomputeSeasonStandings(season.id)
  const voidAfter = (await computeSeasonProgress(TARGET))!.rows.find((r) => r.entrantId === ncMatch.awayEntrantId)!
  check('a voided result contributes nothing either',
    voidAfter.points === voidBefore.points && voidAfter.gamesWon === voidBefore.gamesWon)

  // ── Editing a score ───────────────────────────────────────────────────────────────────────────

  section('An edited score changes the aggregate immediately')

  const first = starkillerMatches[0]
  const current = await prisma.seasonMatch.findUnique({ where: { id: first.id }, select: { version: true, homeEntrantId: true } })
  const homeIsStarkiller = current!.homeEntrantId === starkillerEntrant
  const edited = await saveSeasonGroupResults(ACTOR, season.id, groupIds[0], [{
    matchId: first.id,
    home: homeIsStarkiller ? '3' : '7',
    away: homeIsStarkiller ? '7' : '3',
    version: current!.version,
  }])
  check('the corrected score saves', edited.ok, edited.error)

  const afterEdit = (await computeSeasonProgress(TARGET))!.rows.find((r) => r.handle === 'Starkiller')!
  check('the set record follows the correction to 4-1-0',
    `${afterEdit.wins}-${afterEdit.losses}-${afterEdit.draws}` === '4-1-0',
    `${afterEdit.wins}-${afterEdit.losses}-${afterEdit.draws}`)
  /* 44 - 9 + 3 = 38 won, 6 - 1 + 7 = 12 lost. */
  check('the games follow it to 38-12', `${afterEdit.gamesWon}-${afterEdit.gamesLost}` === '38-12',
    `${afterEdit.gamesWon}-${afterEdit.gamesLost}`)
  check('the percentage follows it to 76%', formatPct(afterEdit.gameWinPct) === '76%', formatPct(afterEdit.gameWinPct))
  check('the points follow it to 13: four wins at 3, plus the completion bonus',
    afterEdit.points === 4 * 3 + 1, `${afterEdit.points}`)

  // Put the worked example back, so the ordering checks below read the intended table.
  const restore = await prisma.seasonMatch.findUnique({ where: { id: first.id }, select: { version: true } })
  await saveSeasonGroupResults(ACTOR, season.id, groupIds[0], [{
    matchId: first.id,
    home: homeIsStarkiller ? '9' : '1',
    away: homeIsStarkiller ? '1' : '9',
    version: restore!.version,
  }])

  // ── Population and order ──────────────────────────────────────────────────────────────────────

  section('All 32 entrants, once each, in the right order')

  const finalView = (await computeSeasonProgress(TARGET))!
  check('every entrant appears', finalView.rows.length === 32, `${finalView.rows.length}`)
  check('...exactly once', new Set(finalView.rows.map((r) => r.entrantId)).size === 32)
  check('the header count agrees with the rows', finalView.entrants === 32, `${finalView.entrants}`)

  const playedIdx = finalView.rows.map((r, i) => (r.played > 0 ? i : -1)).filter((i) => i >= 0)
  const unplayedIdx = finalView.rows.map((r, i) => (r.played === 0 ? i : -1)).filter((i) => i >= 0)
  check('some entrants have played and some have not', playedIdx.length > 0 && unplayedIdx.length > 0,
    `${playedIdx.length} played, ${unplayedIdx.length} unplayed`)
  check('every played entrant appears before every unplayed one',
    Math.max(...playedIdx) < Math.min(...unplayedIdx))

  const firstUnplayed = finalView.rows[Math.min(...unplayedIdx)]
  check('sixohtwo is first among the unplayed, being the highest-ranked ladder player without a set',
    firstUnplayed.handle === 'sixohtwo', firstUnplayed.handle)
  check('...and shows SETS 0-0-0',
    `${firstUnplayed.wins}-${firstUnplayed.losses}-${firstUnplayed.draws}` === '0-0-0')
  check('...GAMES 0-0', `${firstUnplayed.gamesWon}-${firstUnplayed.gamesLost}` === '0-0')
  check('...WIN % as an em dash', formatPct(firstUnplayed.gameWinPct) === '—')
  check('...and PTS 0', firstUnplayed.points === 0)

  const unplayedRanks = unplayedIdx.map((i) => finalView.rows[i].ladderRank)
  const rankedRun = unplayedRanks.filter((r): r is number => r != null)
  check('the unplayed run in ascending ladder order',
    rankedRun.every((r, i) => i === 0 || rankedRun[i - 1] <= r))
  const firstNull = unplayedRanks.indexOf(null)
  check('...with the never-ranked entrants last',
    firstNull === -1 || unplayedRanks.slice(firstNull).every((r) => r == null))

  section('Identity: the CueVerse ID and nothing else')

  const names = await prisma.player.findMany({
    where: { id: { in: finalView.rows.map((r) => r.playerId!).filter(Boolean) } },
    select: { cueverseId: true, primaryName: true },
  })
  const handles = new Set(finalView.rows.map((r) => r.handle))
  check('every row shows a CueVerse ID',
    names.every((n) => !n.cueverseId || handles.has(n.cueverseId)))
  /*
    The check that matters: a preferred name must not be showing where a handle exists.

    Starkiller's profile name is not "Starkiller", so if the panel were reading `primaryName` this
    row would read as that name instead of the handle.
  */
  const withDifferentName = names.filter((n) => n.cueverseId && n.primaryName && n.primaryName !== n.cueverseId)
  check('no row shows a preferred name in place of a handle',
    withDifferentName.length > 0 && withDifferentName.every((n) => !handles.has(n.primaryName)),
    `${withDifferentName.length} players have a distinct preferred name`)

  const panelSrc = code(readFileSync('src/components/home/season-progress.tsx', 'utf8'))
  check('the panel renders no preferred name at all', !/preferredName/.test(panelSrc))
  check('...and no avatar', !/Image|avatar/i.test(panelSrc))
  check('the standings scroll area is reachable by keyboard', /tabIndex=\{0\}/.test(panelSrc))
  check('...is labelled for a screen reader', /aria-label=\{`\$\{view\.label\} standings, scrollable`\}/.test(panelSrc))
  check('...and uses the site\'s crimson scrollbar', /scrollbar-crimson/.test(panelSrc))
  check('the header row stays put while the rows move', /sticky top-0/.test(panelSrc))
  check('there is no Group column', !/>Group</.test(panelSrc))
  check('the six columns are Pos, Player, Sets, Games, Win % and Pts',
    ['>Pos<', '>Player<', '>Sets<', '>Games<', '>Win %<', '>Pts<'].every((c) => panelSrc.includes(c)))
} finally {
  await teardown()
  const left = await prisma.seasonEntrant.count({ where: { seasonId: season.id } })
  const leftGroups = await prisma.seasonGroup.count({ where: { seasonId: season.id } })
  const leftStandings = await prisma.seasonStanding.count({ where: { seasonId: season.id } })
  const restored = await prisma.season.findUnique({ where: { id: season.id }, select: { lifecycleState: true, entrantsCount: true } })
  section('Teardown')
  check('every fixture entrant is gone', left === 0, `${left}`)
  check('every fixture group is gone', leftGroups === 0, `${leftGroups}`)
  check('every fixture standing is gone', leftStandings === 0, `${leftStandings}`)
  check('the Season is back in its original lifecycle state', restored?.lifecycleState === originalState,
    `${restored?.lifecycleState}`)
  check('...and its entrant count is back to zero', restored?.entrantsCount === 0, `${restored?.entrantsCount}`)
}

// ── The empty state, which is what the real Season 2 shows today ────────────────────────────────

section('The empty Season, which is the live state right now')

const empty = await computeSeasonProgress(TARGET)
check('an entrant-less Season still resolves rather than erroring', !!empty)
check('...and simply has no rows', empty!.rows.length === 0, `${empty!.rows.length}`)
check('...with the phase read from the lifecycle state', empty!.phase === 'Registration open', empty!.phase)
check('...and a label built from the competition relation', empty!.label === '8BRCAM Season 2', empty!.label)
check('...linking to the real Season route', empty!.href === `/seasons/${season.id}`, empty!.href)

section('A Season that does not exist')

check('an unknown season number resolves to nothing rather than throwing',
  (await computeSeasonProgress({ seriesSlug: '8brcam', number: 998, year: 2099 })) === null)
check('an unknown competition slug resolves to nothing',
  (await computeSeasonProgress({ seriesSlug: 'not-a-competition', number: 1, year: 2026 })) === null)
check('a nonexistent explicit id resolves to nothing', (await computeSeasonProgress({ seasonId: 999999 })) === null)

// ── The Yahoo tile ──────────────────────────────────────────────────────────────────────────────

section('The Yahoo Archives tile reads the archive page\'s own ladder')

const yahooSrc = code(readFileSync('src/lib/yahoo/ladder.ts', 'utf8'))
const bodySrc = code(readFileSync('src/components/system/yahoo-body.tsx', 'utf8'))
const moduleSrc = code(readFileSync('src/components/site-builder/modules/registry-home.tsx', 'utf8'))

check('/yahoo decodes its state through the shared module', /decodeYahooRankingsState/.test(bodySrc))
check('...and gets its rows from the shared module', /getYahooLadder/.test(bodySrc))
check('...so it no longer builds the filter set itself', !/aggregateFilters/.test(bodySrc))
check('the homepage tile reads the same module', /getYahooTopPlayers/.test(moduleSrc))
check('...and the tile does not build its own filters', !/aggregateFilters|getExplorer/.test(moduleSrc))
check('the shared module is the only place the archive ladder is described',
  /platform: 'YAHOO'/.test(yahooSrc) && !/platform: 'YAHOO'/.test(bodySrc))
check('the top-five helper takes the same path an unfiltered visit takes',
  /decodeYahooRankingsState\(new URLSearchParams\(\)/.test(yahooSrc))

const tileSrc = code(readFileSync('src/components/home/yahoo-archives.tsx', 'utf8'))
check('the tile has no rating or ranking arithmetic of its own',
  !/rating\s*[-+*/]|\.sort\(/.test(tileSrc))
check('the tile shows the ladder\'s own rank, not its position in the slice', /r\.rank \|\| i \+ 1/.test(tileSrc))
check('the tile links to /yahoo', /href=\{href\}/.test(tileSrc) && /'\/yahoo'/.test(moduleSrc))

/*
  The structural checks above prove the two surfaces CALL the same functions. This one proves they
  agree, by asking the running site.

  It cannot be done in-process: `getExplorer` is wrapped in `unstable_cache`, which throws outside a
  request. So the check fetches both pages when a dev server happens to be up, and reports that it
  was skipped when one is not — a skipped check is honest, and a check that silently passes because
  it could not run is not.
*/
async function fetchText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20000) })
    return res.ok ? await res.text() : null
  } catch { return null }
}

const BASE = process.env.VERIFY_BASE_URL ?? 'http://localhost:3000'
const homeHtml = await fetchText(`${BASE}/`)
if (!homeHtml) {
  console.log(`  · skipped: no server at ${BASE} (start one with \`npm run dev:replica\` to run the live comparison)`)
} else {
  const yahooHtml = await fetchText(`${BASE}/yahoo`)
  /*
    Handles and ratings, in order, from each page's markup.

    The tile is an ordered list of three spans; the archive table is the ladder. Comparing the pair
    (handle, rating) is enough to catch the failure this guards against — two rankings of the same
    ledger drifting apart — without depending on either page's column layout.
  */
  const tilePairs = [...(homeHtml.match(/\/players\/[^"]+"[^>]*>([^<]+)<\/a><\/li>/g) ?? [])]
  const tileBlock = homeHtml.slice(homeHtml.indexOf('All-time top 5'), homeHtml.indexOf('Explore Yahoo archives'))
  const tileHandles = [...tileBlock.matchAll(/<a[^>]*href="\/players\/[^"]*"[^>]*>([^<]+)<\/a>/g)].map((m) => m[1])
  const tileRatings = [...tileBlock.matchAll(/>([\d,]{3,})<\/span>/g)].map((m) => m[1].replace(/,/g, ''))
  check('the tile rendered five players', tileHandles.length === 5, `${tileHandles.length}`)
  if (yahooHtml) {
    /*
      Compared by where each handle FIRST appears in the archive page's markup, not by parsing its
      table.

      The archive ladder is a client component, so its rows do not exist as anchors in the served
      HTML — an anchor regex found nothing and reported a disagreement that was not there. First
      appearance is layout-independent: whatever markup the page ships, the ladder is rendered top
      down, so if the tile's five agree with the page they appear in the page in the same order.
    */
    const positions = tileHandles.map((h) => yahooHtml.indexOf(h))
    check('every player in the tile appears on the archive page', positions.every((i) => i >= 0),
      tileHandles.filter((_, i) => positions[i] < 0).join(', ') || 'all present')
    check('the tile top five ARE the archive page top five, in the same order',
      positions.every((v, i) => i === 0 || positions[i - 1] < v),
      `${JSON.stringify(tileHandles)} at ${JSON.stringify(positions)}`)
    for (const r of tileRatings.slice(0, 5)) {
      check(`rating ${r} appears on the archive page too`, yahooHtml.includes(r))
    }
  } else {
    console.log('  · skipped: /yahoo did not respond')
  }
  void tilePairs
}

// ── Revalidation ────────────────────────────────────────────────────────────────────────────────

section('Every result mutation invalidates the homepage')

const stageSrc = code(readFileSync('src/lib/seasons/group-stage.ts', 'utf8'))
check('the recompute invalidates the panel', /invalidateSeasonProgress\(\)/.test(stageSrc))
/*
  The structural claim, not a list of call sites: every mutation path ends in a recompute, and the
  recompute is what invalidates. So this checks the choke point holds rather than counting callers,
  which is what would rot the moment a seventh path is added.
*/
for (const fn of ['saveSeasonGroupResults', 'closeSeasonGroups', 'clearSeasonMatch', 'reopenSeasonGroups']) {
  const body = stageSrc.slice(stageSrc.indexOf(`export async function ${fn}`))
  const end = body.indexOf('\nexport ')
  check(`${fn} recomputes the standings, so it invalidates`,
    /recomputeSeasonStandings\(seasonId\)/.test(end > 0 ? body.slice(0, end) : body))
}
const groupsSrc = code(readFileSync('src/lib/seasons/groups.ts', 'utf8'))
check('publishSeasonGroups recomputes too', /recomputeSeasonStandings\(seasonId\)/.test(groupsSrc))

const serviceSrc = code(readFileSync('src/lib/seasons/service.ts', 'utf8'))
check('adding, removing and self-registering an entrant all invalidate',
  (serviceSrc.match(/invalidateSeasonProgress\(\)/g) ?? []).length === 3,
  `${(serviceSrc.match(/invalidateSeasonProgress\(\)/g) ?? []).length}`)
check('...after the transaction, never inside it',
  !/invalidateSeasonProgress\(\)[\s\S]{0,40}\}\)/.test(serviceSrc))

const progressSrc = code(readFileSync('src/lib/home/season-progress.ts', 'utf8'))
check('the invalidation clears the DATA tag as well as the path',
  /revalidateTag\(SEASON_PROGRESS_TAG/.test(progressSrc) && /revalidatePath\('\/'\)/.test(progressSrc))
check('...and never throws, so it cannot fail a committed write', /catch \{/.test(progressSrc))
check('the panel reads persisted standings rather than recomputing them',
  /seasonStanding\.findMany/.test(progressSrc) && !/computeStandings/.test(progressSrc))
check('the season is resolved by relation, not by a display title',
  /competitionSeries: \{ slug: target\.seriesSlug \}/.test(progressSrc) && !/title:/.test(progressSrc))
/*
  No await inside the loop that builds the rows.

  Checked by isolating the callback rather than by a proximity regex: the earlier version pattern-
  matched across unrelated lines and reported a problem that was not there. This asks the real
  question — the row builder must be pure, because an await in it is one query per entrant.
*/
const rowLoop = progressSrc.slice(progressSrc.indexOf('const rows: SeasonProgressRow[] ='), progressSrc.indexOf('rows.sort('))
check('the row builder is a query-free loop', rowLoop.length > 0 && !/await|prisma\./.test(rowLoop))
check('...and the reads it depends on are batched ahead of it',
  /Promise\.all\(\[/.test(progressSrc) && /id: \{ in: playerIds \}/.test(progressSrc))

// ── Layout ──────────────────────────────────────────────────────────────────────────────────────

section('The published homepage row')

const factorySrc = readFileSync('src/lib/site-builder/factory.ts', 'utf8')
check('the record row is 1/3 + 2/3', /ratio: '34-66'/.test(factorySrc))
check('the Yahoo tile is the first child, in the narrow column',
  factorySrc.indexOf("'rankings.yahooArchives'") < factorySrc.indexOf("'competitions.recordFeature'"))
check('the record feature keeps its poster, video and holder',
  /table-clear-58-7-poster/.test(factorySrc) && /58\.7-second/.test(factorySrc))
check('the narrow column is the Season Progress panel', /'seasons\.progress'/.test(factorySrc))
check('the news and achievement modules are no longer on the homepage layout',
  !/'editorial\.newsPlaques'/.test(factorySrc) && !/'rankings\.achievementPlaques'/.test(factorySrc))
/* Removed from the PAGE, not from the site: both are still registered modules with their own pages. */
const homeModulesSrc = readFileSync('src/components/site-builder/modules/registry-home.tsx', 'utf8')
check('...but both still exist as modules an owner can place',
  /'editorial\.newsPlaques'/.test(homeModulesSrc) && /'rankings\.achievementPlaques'/.test(homeModulesSrc))

const page = await prisma.sitePage.findUnique({ where: { key: '/' }, select: { id: true, publishedRevisionId: true } })
const liveRev = page?.publishedRevisionId
  ? await prisma.sitePageRevision.findUnique({ where: { id: page.publishedRevisionId }, select: { document: true } })
  : null
if (liveRev) {
  const json = JSON.stringify(liveRev.document)
  check('the PUBLISHED homepage carries the Season Progress panel', json.includes('seasons.progress'))
  check('...and the Yahoo Archives tile', json.includes('rankings.yahooArchives'))
  check('...and the flipped ratio', json.includes('"ratio":"34-66"'))
  check('...and no longer the Break card in that slot', !json.includes('editorial.breakFeature'))
  check('...while keeping the record feature', json.includes('competitions.recordFeature'))
  check('...the marquee', json.includes('competitions.marquee'))
  check('...the hero', json.includes('home.championHero'))
  check('...the rankings rail', json.includes('rankings.rail'))
  check('...and the stats bar', json.includes('rankings.statsBar'))
} else {
  check('a published homepage revision exists', false, 'none found')
}

const css = readFileSync('src/app/(frontend)/globals.css', 'utf8')
check('the crimson scrollbar is defined', /\.scrollbar-crimson\b/.test(css))
check('...with a dark track', /\.scrollbar-crimson::-webkit-scrollbar-track\s*\{[^}]*var\(--void\)/.test(css))
check('...and a crimson thumb', /\.scrollbar-crimson::-webkit-scrollbar-thumb\s*\{[^}]*hot-red/.test(css))
check('...and works in Firefox too', /\.scrollbar-crimson\s*\{[^}]*scrollbar-color/.test(css))

console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
await prisma.$disconnect()
process.exit(fail === 0 ? 0 : 1)
