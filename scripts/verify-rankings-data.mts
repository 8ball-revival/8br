/**
 * The Rankings data layer, against a real database.
 *
 * The other suite covers rules applied to rows it was handed; this one covers where those rows come
 * from — the aggregate, the per-player detail, head-to-head, and the two claims that matter most:
 * that ONE canonical Player owns every historical appearance, and that nothing is invented where the
 * record is silent.
 *
 * Every fixture is namespaced `zzrk` and removed afterwards, so the archived seasons in this
 * database are never touched.
 *
 * Run:  npx tsx --tsconfig scripts/tsconfig.verify.json --env-file=.env scripts/verify-rankings-data.mts
 */
import { prisma } from '../src/lib/prisma.ts'
import { assertLocalDatabase } from '../src/lib/db-guard.ts'
import {
  computeExplorer, computeFacets, computeFreshness, UNASSIGNED_DIVISION,
} from '../src/lib/stats/ladder-explorer.ts'
import { computePlayerDetail, computeHeadToHead } from '../src/lib/stats/rankings-detail.ts'
import { completenessOf } from '../src/lib/stats/rankings-facts.ts'

assertLocalDatabase('verify-rankings-data')

let pass = 0, fail = 0
const check = (n: string, c: boolean, d = '') => {
  if (c) { pass++ } else { fail++; console.log('  FAIL ' + n + (d ? ` — ${d}` : '')) }
}
const section = (s: string) => console.log(`\n${s}`)

const PREFIX = 'zzrk'

async function cleanup() {
  await prisma.ratingLedger.deleteMany({ where: { matchKey: { startsWith: `${PREFIX}:` } } }).catch(() => {})
  await prisma.season.deleteMany({ where: { slug: { startsWith: `${PREFIX}-season-` } } }).catch(() => {})
  await prisma.competitionSeries.deleteMany({ where: { slug: { startsWith: `${PREFIX}-series` } } }).catch(() => {})
  await prisma.playerAlias.deleteMany({ where: { player: { cueverseId: { startsWith: `${PREFIX}_` } } } }).catch(() => {})
  await prisma.player.deleteMany({ where: { primaryName: { startsWith: 'ZZRK ' } } }).catch(() => {})
}
await cleanup()

/** A ledger row, with only the fields a test cares about spelled out. */
let seq = 800_000
function ledgerRow(o: {
  seasonId: number; playerId: string; playerName: string; opponentName: string
  result: 'WIN' | 'LOSS' | 'DRAW'; stage?: string; roundLabel?: string
  key: string; preRating?: number; postRating?: number; isForfeit?: boolean; at?: Date
}) {
  return {
    seasonId: o.seasonId, matchKey: `${PREFIX}:${o.key}`, stage: o.stage ?? 'GROUP',
    roundLabel: o.roundLabel ?? 'Group A', playerId: o.playerId, playerName: o.playerName,
    opponentName: o.opponentName, result: o.result, isForfeit: o.isForfeit ?? false,
    actual: o.result === 'WIN' ? 1 : o.result === 'LOSS' ? 0 : 0.5,
    preRating: o.preRating ?? 1500, expected: 0.5,
    ratingChange: (o.postRating ?? 1500) - (o.preRating ?? 1500),
    postRating: o.postRating ?? 1500, sequence: seq++,
    completedAt: o.at ?? new Date('2005-06-01T00:00:00Z'),
  }
}

try {
  // ── Build one small, fully-controlled world. ───────────────────────────────────────────────────
  const series = await prisma.competitionSeries.create({
    data: { name: 'ZZRK Series', shortName: 'zzrk', slug: `${PREFIX}-series`, active: true },
    select: { id: true },
  })

  const mkSeason = async (n: number, year: number, division: string | null) =>
    prisma.season.create({
      data: {
        competitionSeriesId: series.id, number: n, competitionYear: year,
        slug: `${PREFIX}-season-${n}`, lifecycleState: 'COMPLETED', lounge: 'Social',
        accessMode: 'OPEN', division, groupStageGames: 10, earlyRaceTo: 7,
        semifinalRaceTo: 9, finalRaceTo: 9,
      },
      select: { id: true },
    })

  const sA = await mkSeason(9101, 2005, 'A')
  const sB = await mkSeason(9102, 2006, 'B')
  const sNone = await mkSeason(9103, 2009, null)

  const mkPlayer = async (name: string, cue: string) =>
    prisma.player.create({
      data: { primaryName: `ZZRK ${name}`, cueverseId: `${PREFIX}_${cue}`, cueverseIdNormalized: `${PREFIX}_${cue}` },
      select: { id: true },
    })

  const alice = await mkPlayer('Alice', 'alice')
  const bob = await mkPlayer('Bob', 'bob')
  const carol = await mkPlayer('Carol', 'carol')

  // Carol has a documented past life. Nothing here is guessed; the alias is a stored record.
  await prisma.playerAlias.create({
    data: { playerId: carol.id, alias: `${PREFIX}_carol_2007_yahoo`, aliasType: 'HANDLE' },
  })

  await prisma.ratingLedger.createMany({
    data: [
      // Division A, 2005. Alice beats Bob twice; frames recorded for neither (no source match rows
      // exist for these synthetic keys), which is exactly the archived-season case.
      ledgerRow({ seasonId: sA.id, playerId: alice.id, playerName: 'zzrk_alice', opponentName: 'zzrk_bob', result: 'WIN', key: 'a1', preRating: 1500, postRating: 1516 }),
      ledgerRow({ seasonId: sA.id, playerId: bob.id, playerName: 'zzrk_bob', opponentName: 'zzrk_alice', result: 'LOSS', key: 'a1', preRating: 1500, postRating: 1484 }),
      ledgerRow({ seasonId: sA.id, playerId: alice.id, playerName: 'zzrk_alice', opponentName: 'zzrk_bob', result: 'WIN', key: 'a2', preRating: 1516, postRating: 1530 }),
      ledgerRow({ seasonId: sA.id, playerId: bob.id, playerName: 'zzrk_bob', opponentName: 'zzrk_alice', result: 'LOSS', key: 'a2', preRating: 1484, postRating: 1470 }),

      // Division B, 2006. Carol beats Bob in a final; Bob now has a rating history, so this win
      // has a trustworthy pre-match rating behind it.
      ledgerRow({ seasonId: sB.id, playerId: carol.id, playerName: 'zzrk_carol', opponentName: 'zzrk_bob', result: 'WIN', key: 'b1', stage: 'PLAYOFF', roundLabel: 'Final', preRating: 1500, postRating: 1520, at: new Date('2006-06-01T00:00:00Z') }),
      ledgerRow({ seasonId: sB.id, playerId: bob.id, playerName: 'zzrk_bob', opponentName: 'zzrk_carol', result: 'LOSS', key: 'b1', stage: 'PLAYOFF', roundLabel: 'Final', preRating: 1470, postRating: 1450, at: new Date('2006-06-01T00:00:00Z') }),

      // Unassigned division, 2009. A forfeit: a match played, no frames, no rating movement.
      ledgerRow({ seasonId: sNone.id, playerId: alice.id, playerName: 'zzrk_alice', opponentName: 'zzrk_carol', result: 'WIN', key: 'n1', isForfeit: true, preRating: 1530, postRating: 1530, at: new Date('2009-06-01T00:00:00Z') }),
      ledgerRow({ seasonId: sNone.id, playerId: carol.id, playerName: 'zzrk_carol', opponentName: 'zzrk_alice', result: 'LOSS', key: 'n1', isForfeit: true, preRating: 1520, postRating: 1520, at: new Date('2009-06-01T00:00:00Z') }),
    ],
  })

  const mine = (rows: Awaited<ReturnType<typeof computeExplorer>>) =>
    rows.filter((r) => (r.cueverseId ?? '').startsWith(`${PREFIX}_`))
  const find = (rows: Awaited<ReturnType<typeof computeExplorer>>, id: string) =>
    rows.find((r) => r.playerId === id)

  // ── Canonical identity ─────────────────────────────────────────────────────────────────────────
  section('One canonical Player owns every historical appearance')
  {
    const before = mine(await computeExplorer('all-time', 'overall'))
    check('all three fixture players appear', before.length === 3, String(before.length))

    const a = find(before, alice.id)
    check('the row carries the preferred name', a?.preferredName === 'ZZRK Alice', a?.preferredName)
    check('...and the current CueVerse ID', a?.cueverseId === `${PREFIX}_alice`, a?.cueverseId ?? '')
    check('...and Alice’s record spans both her seasons', a?.played === 3, String(a?.played))

    // The change under test: rename the CANONICAL account, not the historical rows.
    const ledgerNamesBefore = await prisma.ratingLedger.findMany({
      where: { playerId: alice.id }, select: { playerName: true },
    })
    await prisma.player.update({
      where: { id: alice.id },
      data: { cueverseId: `${PREFIX}_alice_renamed`, cueverseIdNormalized: `${PREFIX}_alice_renamed` },
    })

    const after = mine(await computeExplorer('all-time', 'overall'))
    const a2 = find(after, alice.id)
    check('the new CueVerse ID shows across every historical record at once',
      a2?.cueverseId === `${PREFIX}_alice_renamed`, a2?.cueverseId ?? '')
    check('...and it is the SAME Player id, not a new account', a2?.playerId === alice.id)
    check('...and no duplicate row appeared', after.length === 3, String(after.length))
    check('...and the record is unchanged', a2?.played === a?.played && a2?.wins === a?.wins)

    const ledgerNamesAfter = await prisma.ratingLedger.findMany({
      where: { playerId: alice.id }, select: { playerName: true },
    })
    check('the historical competition rows were NOT rewritten',
      JSON.stringify(ledgerNamesBefore) === JSON.stringify(ledgerNamesAfter))

    const playerCount = await prisma.player.count({ where: { primaryName: { startsWith: 'ZZRK ' } } })
    check('renaming created no second Player record', playerCount === 3, String(playerCount))

    // Detail is fetched separately and must agree.
    const detail = await computePlayerDetail(alice.id, 'all-time')
    check('the expanded detail belongs to the same canonical player', detail.playerId === alice.id)

    // Put it back so later assertions read the original identity.
    await prisma.player.update({
      where: { id: alice.id },
      data: { cueverseId: `${PREFIX}_alice`, cueverseIdNormalized: `${PREFIX}_alice` },
    })
  }

  section('Historical aliases travel with the canonical player')
  {
    const rows = mine(await computeExplorer('all-time', 'overall'))
    const c = find(rows, carol.id)
    check('the alias is carried on the row',
      c?.aliases.includes(`${PREFIX}_carol_2007_yahoo`) === true, JSON.stringify(c?.aliases))
    check('a player with no aliases carries an empty list, not null',
      Array.isArray(find(rows, bob.id)?.aliases) && find(rows, bob.id)?.aliases.length === 0)

    const detail = await computePlayerDetail(carol.id, 'all-time')
    check('the expanded row can say "previously known as"',
      detail.aliases.includes(`${PREFIX}_carol_2007_yahoo`))
  }

  // ── Records and views ──────────────────────────────────────────────────────────────────────────
  section('Record views read from stored relations')
  {
    const overall = mine(await computeExplorer('all-time', 'overall'))
    const group = mine(await computeExplorer('all-time', 'group'))
    const playoff = mine(await computeExplorer('all-time', 'playoff'))
    const tournament = mine(await computeExplorer('all-time', 'tournament'))

    check('Overall counts every match', find(overall, bob.id)?.played === 3, String(find(overall, bob.id)?.played))
    check('Group Play counts only group matches', find(group, bob.id)?.played === 2, String(find(group, bob.id)?.played))
    check('Playoffs counts only playoff matches', find(playoff, bob.id)?.played === 1, String(find(playoff, bob.id)?.played))
    check('Tournaments excludes Season matches entirely', tournament.length === 0, String(tournament.length))

    check('the rating is the same figure in every view — it is not per-stage',
      find(overall, bob.id)?.rating === find(group, bob.id)?.rating
      && find(overall, bob.id)?.rating === find(playoff, bob.id)?.rating,
      `${find(overall, bob.id)?.rating} / ${find(group, bob.id)?.rating} / ${find(playoff, bob.id)?.rating}`)

    check('a final appearance is counted from the stored round label',
      find(overall, carol.id)?.finalsAppearances === 1, String(find(overall, carol.id)?.finalsAppearances))
    check('...and someone who never reached one has none',
      find(overall, alice.id)?.finalsAppearances === 0)
  }

  section('Forfeits count as matches, contribute no games, and move no rating')
  {
    const rows = mine(await computeExplorer('all-time', 'overall'))
    const a = find(rows, alice.id)!
    check('the forfeit is counted as a match played', a.played === 3, String(a.played))
    check('...and reported as a forfeit', a.forfeits === 1, String(a.forfeits))
    check('...and contributes no games', a.gamesWon === 0 && a.gamesLost === 0)
    check('a forfeit is not counted as recorded game data', a.matchesWithGameData === 0)

    check('completeness reports match-results-only rather than incomplete',
      completenessOf(a) === 'match-only', completenessOf(a))
  }

  // ── Division and date range ────────────────────────────────────────────────────────────────────
  section('Division filtering, with nothing inferred')
  {
    const all = mine(await computeExplorer('all-time', 'overall'))
    const divA = mine(await computeExplorer('all-time', 'overall', { division: 'A' }))
    const divB = mine(await computeExplorer('all-time', 'overall', { division: 'B' }))
    const none = mine(await computeExplorer('all-time', 'overall', { division: UNASSIGNED_DIVISION }))

    check('Division A returns only its own matches',
      find(divA, alice.id)?.played === 2, String(find(divA, alice.id)?.played))
    check('...and excludes a player who never played in it', find(divA, carol.id) === undefined)
    check('Division B returns only its own matches',
      find(divB, carol.id)?.played === 1 && find(divB, alice.id) === undefined)
    check('Unassigned returns the Season with no division recorded',
      find(none, alice.id)?.played === 1, String(find(none, alice.id)?.played))
    check('the three slices add up to the whole',
      (find(divA, alice.id)?.played ?? 0) + (find(divB, alice.id)?.played ?? 0) + (find(none, alice.id)?.played ?? 0)
      === find(all, alice.id)?.played)

    const facets = await computeFacets()
    check('facets offer only divisions that are actually recorded',
      facets.divisions.includes('A') && facets.divisions.includes('B'))
    check('...and report that unassigned Seasons exist', facets.hasUnassignedDivision)
    check('facets invent no eras', facets.eras.length === 0)
    check('...and offer a real year range instead', facets.yearRange != null && facets.yearRange.min <= 2005)
  }

  section('Year-range filtering')
  {
    const early = mine(await computeExplorer('all-time', 'overall', { fromYear: 2005, toYear: 2006 }))
    const late = mine(await computeExplorer('all-time', 'overall', { fromYear: 2009 }))
    check('a closed range excludes later years',
      find(early, alice.id)?.played === 2, String(find(early, alice.id)?.played))
    check('an open-ended range includes only from that year on',
      find(late, alice.id)?.played === 1, String(find(late, alice.id)?.played))
    check('a range covering nothing returns nothing rather than everything',
      mine(await computeExplorer('all-time', 'overall', { fromYear: 2100 })).length === 0)
  }

  // ── Derived detail ─────────────────────────────────────────────────────────────────────────────
  section('Strongest recorded win uses the opponent’s PRE-match rating, or is absent')
  {
    const carolDetail = await computePlayerDetail(carol.id, 'all-time')
    check('Carol’s strongest win exists — Bob had earlier ranked matches',
      carolDetail.strongestWin != null)
    check('...and it reports Bob’s rating going INTO the match, not his rating now',
      carolDetail.strongestWin?.opponentRatingBefore === 1470,
      String(carolDetail.strongestWin?.opponentRatingBefore))

    const bobNow = await prisma.ratingLedger.findFirst({
      where: { playerId: bob.id }, orderBy: { sequence: 'desc' }, select: { postRating: true },
    })
    check('...which is genuinely a different number from his current rating',
      carolDetail.strongestWin?.opponentRatingBefore !== bobNow?.postRating,
      `${carolDetail.strongestWin?.opponentRatingBefore} vs ${bobNow?.postRating}`)

    // Alice's only wins are over Bob in his very first two matches, plus a forfeit. Her first win
    // is against an opponent with no prior history at all.
    const aliceDetail = await computePlayerDetail(alice.id, 'all-time')
    check('Alice’s strongest win skips the opponent whose rating was the starting default',
      aliceDetail.strongestWin?.opponentRatingBefore !== 1500,
      String(aliceDetail.strongestWin?.opponentRatingBefore))
    check('...and skips the forfeit, where nobody played',
      aliceDetail.strongestWin == null || aliceDetail.strongestWin.opponent !== 'zzrk_carol',
      aliceDetail.strongestWin?.opponent ?? 'none')

    // Bob has never won. There is no statistic to show and none is invented.
    const bobDetail = await computePlayerDetail(bob.id, 'all-time')
    check('a player who has never won has no strongest win', bobDetail.strongestWin === null)
    check('...and is not given a reason that implies missing data', bobDetail.strongestWinUnavailable === null)
  }

  section('Rating history is observations only')
  {
    const detail = await computePlayerDetail(bob.id, 'all-time')
    check('one point per ranked match', detail.ratingHistory.length === 3, String(detail.ratingHistory.length))
    check('points are in ledger order',
      detail.ratingHistory.every((p, i, arr) => i === 0 || arr[i - 1].sequence < p.sequence))
    check('the values are the recorded post-match ratings',
      detail.ratingHistory.map((p) => p.rating).join(',') === '1484,1470,1450',
      detail.ratingHistory.map((p) => p.rating).join(','))

    // A three-year gap between Bob's 2006 and… nothing. No synthetic points fill it.
    const alicePoints = (await computePlayerDetail(alice.id, 'all-time')).ratingHistory
    const years = [...new Set(alicePoints.map((p) => p.at.slice(0, 4)))]
    check('a multi-year gap in play leaves a gap, not interpolated points',
      years.join(',') === '2005,2009', years.join(','))

    check('peak rating is the highest point actually observed',
      (await computePlayerDetail(alice.id, 'all-time')).peakRating === 1530,
      String((await computePlayerDetail(alice.id, 'all-time')).peakRating))
  }

  section('Career summary and best-of statistics')
  {
    const detail = await computePlayerDetail(alice.id, 'all-time')
    check('overall record is the whole history', detail.overallRecord.wins === 3)
    // Two contested group wins plus the forfeit, which the fixture also files under GROUP.
    check('group and playoff records are separate',
      detail.groupRecord.wins === 3 && detail.playoffRecord.wins === 0,
      `${detail.groupRecord.wins} / ${detail.playoffRecord.wins}`)
    check('the longest winning run is walked over the ordered history',
      detail.longestWinStreak === 3, String(detail.longestWinStreak))

    const carolDetail = await computePlayerDetail(carol.id, 'all-time')
    check('a playoff run records the deepest round reached',
      carolDetail.bestPlayoffRun?.deepestRound === 'Final', carolDetail.bestPlayoffRun?.deepestRound ?? 'none')
    check('per-competition rows link back to their Season',
      carolDetail.competitions.every((c) => c.href?.startsWith('/seasons/')))
    check('a competition with no recorded frames says so rather than showing 0–0',
      carolDetail.competitions.every((c) => c.matchesWithGameData === 0))
  }

  section('Head-to-head reads the ledger, not names')
  {
    const pairs = await computeHeadToHead([alice.id, bob.id])
    check('exactly one pair is returned', pairs.length === 1, String(pairs.length))
    const p = pairs[0]
    const aliceIsA = p.a === alice.id
    check('the two group meetings are counted',
      (aliceIsA ? p.aWins : p.bWins) === 2, JSON.stringify(p))
    check('...and the other side has none', (aliceIsA ? p.bWins : p.aWins) === 0)
    check('no frames are claimed where none were recorded', p.matchesWithGameData === 0)

    const three = await computeHeadToHead([alice.id, bob.id, carol.id])
    check('three players yield every pair that actually met', three.length === 3, String(three.length))
    check('a pair is emitted once, not twice with the columns swapped',
      new Set(three.map((x) => [x.a, x.b].sort().join('|'))).size === three.length)
    check('fewer than two players yields nothing', (await computeHeadToHead([alice.id])).length === 0)

    const strangers = await computeHeadToHead([alice.id, 'no-such-player'])
    check('a player who never met the other yields no pair', strangers.length === 0)
  }

  section('Last updated is derived from the record, not the clock')
  {
    const f = await computeFreshness()
    check('a timestamp is reported', f.lastResultAt != null)
    check('...and it is not now', f.lastResultAt != null && Date.now() - Date.parse(f.lastResultAt) > 60_000)
    check('the ranked-match count is real', f.rankedMatches > 0)
    check('the source competition is identified', f.source != null)

    // Add a result NEWER than anything already in this database — the archived seasons carry an
    // import timestamp, so a fixed date in the past would lose to them and prove nothing.
    const existingMax = await prisma.ratingLedger.findFirst({
      orderBy: { completedAt: 'desc' }, select: { completedAt: true },
    })
    const newest = new Date((existingMax?.completedAt.getTime() ?? Date.now()) + 86_400_000)
    await prisma.ratingLedger.create({
      data: ledgerRow({ seasonId: sNone.id, playerId: bob.id, playerName: 'zzrk_bob', opponentName: 'zzrk_alice', result: 'WIN', key: 'newest', at: newest }),
    })
    const f2 = await computeFreshness()
    check('a newer result moves the timestamp to that result',
      f2.lastResultAt === newest.toISOString(), String(f2.lastResultAt))
    check('...and names the competition it came from',
      f2.source?.kind === 'season' && f2.source.id === sNone.id, JSON.stringify(f2.source))
    await prisma.ratingLedger.deleteMany({ where: { matchKey: `${PREFIX}:newest` } })
  }

  section('The Current scope is a rolling window, not everything')
  {
    // Every fixture match is from 2005–2009, well outside a 365-day window.
    const current = mine(await computeExplorer('current', 'overall'))
    check('old results are outside the Current window', current.length === 0, String(current.length))
    check('...but are still present All Time',
      mine(await computeExplorer('all-time', 'overall')).length === 3)
  }

  section('The Rankings table agrees with the official ladder service')
  {
    // The homepage Top 10 and the player profiles read `getLadder`, not this aggregate. If the two
    // ever disagree the site shows one player two different ratings on two pages, and there is no
    // way for a reader to tell which is the real one. This is the check that stops that.
    const { getLadder } = await import('../src/lib/stats/ladder.ts')
    for (const scope of ['current', 'all-time'] as const) {
      /*
       * Both sides are asked for the SAME platform, and it is the one that has results.
       *
       * The ladder is per platform now, and the default -- CueVerse -- is legitimately empty until a
       * CueVerse Season completes. Comparing an empty ladder against a table proves nothing, so the
       * check would have passed vacuously or failed for the wrong reason. Yahoo carries the archive,
       * so that is where the figures can actually be made to disagree.
       */
      const explorer = await computeExplorer(scope, 'overall', { platform: 'YAHOO' })
      const byId = new Map(explorer.map((r) => [r.playerId, r]))

      /*
       * Compared over players who have actually PLAYED.
       *
       * getLadder lists every member, including someone provisioned an hour ago who has never
       * played a match; the Rankings table is built from the rating ledger, so it lists people with
       * results. Both are right about their own question, and requiring identical populations would
       * mean either ranking players with no matches or hiding new members from the ladder.
       *
       * What must never differ is the FIGURES for anybody who appears in both — that is what stops
       * the site showing one player two ratings on two pages.
       */
      const ladder = await getLadder(scope, new Date(), 'YAHOO')
      const official = ladder.filter((o) => byId.has(o.playerId))
      const unplayed = ladder.length - official.length
      if (unplayed > 0) console.log(`  (${unplayed} member(s) with no recorded matches are on the ladder but not the table)`)
      check(`${scope}: there are ranked players in both`, official.length > 0, String(official.length))
      const disagreed = official.filter((o) => {
        const m = byId.get(o.playerId)
        return !m || m.rating !== o.rating || m.rank !== o.rank || m.peakRating !== o.highestRating
      })
      check(`${scope}: rating, rank and peak agree with the official ladder`,
        disagreed.length === 0,
        disagreed.slice(0, 3).map((o) => `${o.playerId}: ladder ${o.rating}/#${o.rank} vs table ${byId.get(o.playerId)?.rating}/#${byId.get(o.playerId)?.rank}`).join('; '))
    }
  }

  section('Official rank is assigned once, by a documented rule')
  {
    const rows = await computeExplorer('all-time', 'overall')
    // Ranks come from getLadder when the table is unfiltered, and getLadder ranks every member —
    // so a table that excludes never-played members legitimately carries a sparse set of official
    // ranks. What must hold is that they ASCEND without repeating, and that rating descends with
    // them.
    check('ranks ascend without repeating',
      rows.every((r, i) => i === 0 || r.rank > rows[i - 1].rank),
      rows.slice(0, 5).map((r) => r.rank).join(','))
    check('the first row holds rank 1', rows[0]?.rank === 1, String(rows[0]?.rank))
    check('ranks descend by rating',
      rows.every((r, i) => i === 0 || rows[i - 1].rating >= r.rating))

    // Determinism across calls: the same data must produce the same order every time.
    const again = await computeExplorer('all-time', 'overall')
    check('the same data produces the same order on a second call',
      rows.map((r) => r.playerId).join(',') === again.map((r) => r.playerId).join(','))
  }
} catch (e) {
  fail++
  console.error(e)
} finally {
  await cleanup()
  const leftovers = await prisma.ratingLedger.count({ where: { matchKey: { startsWith: `${PREFIX}:` } } })
  const leftPlayers = await prisma.player.count({ where: { primaryName: { startsWith: 'ZZRK ' } } })
  check('fixtures removed — no ledger rows left', leftovers === 0, String(leftovers))
  check('fixtures removed — no players left', leftPlayers === 0, String(leftPlayers))
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
await prisma.$disconnect()
process.exit(fail === 0 ? 0 : 1)
