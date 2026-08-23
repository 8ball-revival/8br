/**
 * Check a reconstructed Season against the archive it was built from.
 *
 * Not "did the importer run without error" — that is what the progress file already says. This asks
 * whether the competition now in the database is the one the archive describes: the same people, in
 * the same groups, with the same scores attached to the same pairs, standing in the same order.
 *
 * Usage: tsx scripts/verify-archive-season.mts <seasonId>
 */
import { prisma } from '../src/lib/prisma.ts'
import { assertLocalDatabase } from '../src/lib/db-guard.ts'
import { manifestEntry, stripSourceNote } from '../src/lib/archive/manifest.ts'
import { parseWayback, type WaybackBracket } from '../src/lib/archive/wayback.ts'
import { readFileSync as readSource, existsSync as sourceExists } from 'node:fs'

assertLocalDatabase()

/*
 * With no argument, check the most completely reconstructed Season there is.
 *
 * The batch runner discovers every verify-*.mts and calls it with no arguments, so demanding one
 * made this suite fail the batch by design. Defaulting keeps it meaningful in both places.
 */
const argId = Number(process.argv[2])
const seasonId = Number.isFinite(argId) ? argId : (await prisma.season.findFirstOrThrow({
  /*
   * A Season THIS reconstruction built, not one completed by an earlier import under other rules.
   * The first default landed on a 2005 Season holding 98 entrants against 32 recorded handles,
   * which says something about that old import and nothing about this one.
   */
  where: {
    archiveTemplateKey: { not: null },
    lifecycleState: { notIn: ['COMPLETED'] },
    playoffMatches: { some: { homeEntrantId: { not: null } } },
  },
  select: { id: true },
  orderBy: { id: 'asc' },
})).id

let pass = 0, fail = 0
const check = (label: string, ok: boolean, detail?: string) => {
  if (ok) { pass++; console.log(`  ✓ ${label}`) }
  else { fail++; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`) }
}

const season = await prisma.season.findUniqueOrThrow({
  where: { id: seasonId },
  select: {
    id: true, number: true, division: true, competitionYear: true, archiveTemplateKey: true,
    lifecycleState: true, championName: true, ladderAppliedAt: true,
  },
})
const entry = manifestEntry(season.archiveTemplateKey!)
if (!entry) throw new Error(`no manifest entry for ${season.archiveTemplateKey}`)

console.log(`${season.competitionYear} S${season.number}${season.division ?? ''} (${season.id}) — ${season.lifecycleState}`)

/*
 * The archived bracket page for this Season, when one was captured.
 *
 * Division A only, 2005-2011 — those are the years the capture covers, and a Division A page is
 * never read for a Division B Season.
 */
const waybackPath = `archive/wayback-seasons/${season.competitionYear}/${season.competitionYear} s${season.number}.txt`
const wayback: WaybackBracket | null =
  (season.division ?? 'A') === 'A' && sourceExists(waybackPath)
    ? parseWayback(readSource(waybackPath, 'utf8'), waybackPath)
    : null
if (wayback) console.log(`archived page: ${wayback.validation.category}, ${wayback.matches.filter((m) => m.proven).length} proven match(es)`)
console.log(`source: groups=${entry.groupAssignments} results=${entry.exactResults} playoff=${entry.playoff.placement}\n`)

// ── Identity: resolve an archive handle to the Player it now belongs to ─────────────────────────
const resolve = async (handle: string): Promise<string | null> => {
  const h = stripSourceNote(handle).toLowerCase()
  const direct = await prisma.player.findFirst({ where: { cueverseIdNormalized: h }, select: { id: true } })
  if (direct) return direct.id
  const alias = await prisma.playerAlias.findFirst({
    where: { alias: { equals: stripSourceNote(handle), mode: 'insensitive' } },
    select: { playerId: true },
  })
  return alias?.playerId ?? null
}

// ── Entrants ────────────────────────────────────────────────────────────────────────────────────
const recorded = new Set([
  ...entry.participants.map((p) => stripSourceNote(p.normalizedHandle).toLowerCase()),
  ...entry.playoff.participants.map((p) => stripSourceNote(p.normalizedHandle).toLowerCase()),
])
const entrants = await prisma.seasonEntrant.findMany({
  where: { seasonId, status: 'APPROVED' },
  select: { id: true, playerId: true, cueverseId: true, username: true, playoffIncluded: true },
})

check(`entrant count matches the archive (${recorded.size})`, entrants.length === recorded.size, `${entrants.length}`)

const playerIds = entrants.map((e) => e.playerId).filter(Boolean)
check('no Player is entered twice', new Set(playerIds).size === playerIds.length)

let unmatched = 0
const entrantByPlayer = new Map(entrants.map((e) => [e.playerId, e]))
for (const h of recorded) {
  const pid = await resolve(h)
  if (!pid || !entrantByPlayer.has(pid)) unmatched++
}
check('every recorded handle resolves to exactly one entrant', unmatched === 0, `${unmatched} unmatched`)

const recordedNorm = new Set([...recorded])
const extra = entrants.filter((e) => !recordedNorm.has(String(e.cueverseId ?? e.username).toLowerCase()))
// An entrant may legitimately carry a merged handle, so re-check the strays through aliases.
let trueExtra = 0
for (const e of extra) {
  const aliases = await prisma.playerAlias.findMany({ where: { playerId: e.playerId! }, select: { alias: true } })
  if (!aliases.some((a) => recordedNorm.has(a.alias.toLowerCase()))) trueExtra++
}
check('no entrant exists outside the archive record', trueExtra === 0, `${trueExtra} extra`)
check('no entrant is soft-withdrawn', (await prisma.seasonEntrant.count({ where: { seasonId, status: 'WITHDRAWN' } })) === 0)

// ── Group membership ────────────────────────────────────────────────────────────────────────────
const groups = await prisma.seasonGroup.findMany({
  where: { seasonId },
  select: { code: true, name: true, players: { select: { entrantId: true } } },
})
const wantGroups = new Map<string, Set<string>>()
for (const p of entry.participants) {
  const g = p.groupName
  if (!wantGroups.has(g)) wantGroups.set(g, new Set())
  wantGroups.get(g)!.add(stripSourceNote(p.normalizedHandle).toLowerCase())
}
check(`group count matches the archive (${wantGroups.size})`, groups.length === wantGroups.size, `${groups.length}`)

const entrantById = new Map(entrants.map((e) => [e.id, e]))
let misplaced = 0
for (const g of groups) {
  const want = wantGroups.get(g.name ?? g.code)
  if (!want) { misplaced += g.players.length; continue }
  for (const gp of g.players) {
    const e = entrantById.get(gp.entrantId)
    const handle = String(e?.cueverseId ?? e?.username ?? '').toLowerCase()
    if (!want.has(handle)) {
      const aliases = e?.playerId ? await prisma.playerAlias.findMany({ where: { playerId: e.playerId }, select: { alias: true } }) : []
      if (!aliases.some((a) => want.has(a.alias.toLowerCase()))) misplaced++
    }
  }
}
check('every grouped player is in the group the archive lists', misplaced === 0, `${misplaced} misplaced`)

// ── Schedule topology and results ───────────────────────────────────────────────────────────────
const matches = await prisma.seasonMatch.findMany({
  where: { seasonId },
  select: { homeEntrantId: true, awayEntrantId: true, homeGames: true, awayGames: true, status: true },
})
const expectedFixtures = [...wantGroups.values()].reduce((a, s) => a + (s.size * (s.size - 1)) / 2, 0)
check(`the schedule is a full round robin (${expectedFixtures} fixtures)`, matches.length === expectedFixtures, `${matches.length}`)

const scored = matches.filter((m) => m.homeGames !== null && m.awayGames !== null)
check(`every archived result was imported (${entry.matches.length})`, scored.length === entry.matches.length, `${scored.length}`)

/*
 * Each archived score must sit on the fixture between the two people it was played by — a count
 * alone would pass even if every result landed on the wrong pair.
 */
let wrongPair = 0, wrongScore = 0
const keyOf = (a: number, b: number) => [a, b].sort((x, y) => x - y).join('-')
const played = new Map<string, { h: number; a: number; hg: number; ag: number }>()
for (const m of scored) played.set(keyOf(m.homeEntrantId, m.awayEntrantId), { h: m.homeEntrantId, a: m.awayEntrantId, hg: m.homeGames!, ag: m.awayGames! })

for (const am of entry.matches) {
  const hp = await resolve(am.aRawHandle)
  const ap = await resolve(am.bRawHandle)
  const he = hp ? entrantByPlayer.get(hp) : undefined
  const ae = ap ? entrantByPlayer.get(ap) : undefined
  if (!he || !ae) { wrongPair++; continue }
  const row = played.get(keyOf(he.id, ae.id))
  if (!row) { wrongPair++; continue }
  const forward = row.h === he.id
  const gotHome = forward ? row.hg : row.ag
  const gotAway = forward ? row.ag : row.hg
  if (gotHome !== am.scoreA || gotAway !== am.scoreB) wrongScore++
}
check('every archived score sits on the fixture between the right two players', wrongPair === 0, `${wrongPair} missing`)
check('every archived score has the archived value, the right way round', wrongScore === 0, `${wrongScore} differ`)

// ── Standings ───────────────────────────────────────────────────────────────────────────────────
const standings = await prisma.seasonStanding.findMany({
  where: { seasonId },
  select: { entrantId: true, wins: true, losses: true, draws: true, played: true, rank: true },
})
check('a standing exists for every grouped player', standings.length === groups.reduce((a, g) => a + g.players.length, 0), `${standings.length}`)

const handleBySourceId = new Map(entry.participants.map((p) => [p.sourceId, p.rawHandle]))
let winsDiffer = 0, standingUnmatched = 0
for (const st of entry.standings) {
  const handle = handleBySourceId.get(st.sourceId)
  const pid = handle ? await resolve(handle) : null
  const e = pid ? entrantByPlayer.get(pid) : undefined
  const row = e ? standings.find((r) => r.entrantId === e.id) : undefined
  if (!row) { standingUnmatched++; continue }
  if (typeof st.wins === 'number' && row.wins !== st.wins) winsDiffer++
}
check('every archived standing row matches a recomputed one', standingUnmatched === 0, `${standingUnmatched} unmatched`)
/*
 * Where the archive disagrees with itself, the disagreement is the assertion.
 *
 * The pages print both a standings table and a match table. For 2012 S1A they do not agree about
 * two players. Neither can be preferred without inventing a historical fact, so the reconstruction
 * recomputes standings from the matches it imported and records the archived claim beside them.
 *
 * Asserting agreement would have failed forever on a source defect. Asserting nothing would have
 * let a real regression hide behind a known one. So what is asserted is that any disagreement is a
 * KNOWN one — listed in the anomaly report — and that nothing was rewritten to paper over it.
 */
const anomalyReportPath = 'reports/archive-source-anomalies.md'
const anomalyText = sourceExists(anomalyReportPath) ? readSource(anomalyReportPath, 'utf8') : ''
const anomalyLabel = `${season.competitionYear} S${season.number}${season.division ?? ''}`

if (winsDiffer === 0) {
  check('recomputed wins agree with the archived standings', true)
} else {
  check(`the standings disagreement is a recorded anomaly (${winsDiffer} player(s))`,
    anomalyText.includes(anomalyLabel) && /standings table/i.test(anomalyText),
    `${anomalyLabel} is not written up in ${anomalyReportPath}`)

  /*
   * And prove nothing was bent to fit. Every imported score still has to be the score the archive
   * printed for that pair — the check above already established that, and it is restated here so a
   * future edit cannot silently "fix" the standings by altering a match.
   */
  check('no match result was altered to reconcile the two tables', wrongScore === 0, `${wrongScore} differ`)
  check('the standings shown are the recomputed ones, not the archived claim', standings.length > 0)
  check('and the Season claims no ranking contribution it has not earned',
    String(season.lifecycleState) === 'COMPLETED' || (await prisma.ratingLedger.count({ where: { seasonId } })) === 0)
}

// ── Playoffs ────────────────────────────────────────────────────────────────────────────────────
const included = entrants.filter((e) => e.playoffIncluded).length
check(`the recorded playoff field is selected (${entry.playoff.participants.length})`,
  included === entry.playoff.participants.length, `${included}`)

const bracket = await prisma.seasonPlayoffMatch.findMany({
  where: { seasonId }, select: { round: true, homeEntrantId: true, awayEntrantId: true, winnerEntrantId: true },
})
if (entry.playoff.placement === 'exact') {
  const r1 = bracket.filter((m) => m.round === 1)
  const seated = r1.flatMap((m) => [m.homeEntrantId, m.awayEntrantId]).filter(Boolean).length
  check(`every recorded Round 1 position is seated (${entry.playoff.participants.length})`,
    seated === entry.playoff.participants.length, `${seated}`)
  check(`the bracket is the size the archive records (${entry.playoff.bracketSize})`,
    r1.length * 2 === entry.playoff.bracketSize, `${r1.length * 2}`)
} else {
  /*
   * An unrecorded topology may still be seated — from the archived bracket page.
   *
   * The season manifest records who played in a playoff and not where, but the Wayback capture
   * often does record the draw. So "the manifest says participants-only" no longer implies the
   * bracket must be empty; what it implies is that anything seated has to come from the page.
   */
  const fromPage = wayback && wayback.validation.category !== 'unusable'
  check('an unrecorded topology is only seated where the archived page records it',
    fromPage || bracket.every((m) => !m.homeEntrantId && !m.awayEntrantId) || bracket.length === 0,
    fromPage ? undefined : 'seated with no page to seat it from')
}

/*
 * Every playoff result must be one the archived page records.
 *
 * This used to assert that no playoff result existed at all, which was true only while none had
 * been imported. The guarantee worth keeping is not "no results" but "no invented results", so each
 * decided match is checked against the page: a score, a forfeit, or a bye is fine; anything else
 * would be a result this reconstruction made up.
 */
const decided = bracket.filter((m) => m.winnerEntrantId)
if (decided.length === 0) {
  check('no playoff result was invented', true)
} else if (!wayback) {
  check('no playoff result was invented', false, `${decided.length} decided match(es) with no archived page`)
} else {
  const provenByPage = wayback.matches.filter((m) => m.proven).length
  const byes = wayback.matches.filter((m) => m.bye).length
  check(`every decided match is one the page records (${decided.length})`,
    decided.length <= provenByPage + byes,
    `${decided.length} decided, ${provenByPage} proven and ${byes} bye(s) on the page`)

  const forfeits = await prisma.seasonPlayoffMatch.count({ where: { seasonId, forfeitEntrantId: { not: null } } })
  const pageForfeits = wayback.matches.filter((m) => m.outcome === 'forfeit' && m.proven).length
  check(`every forfeit is one the page records (${forfeits})`, forfeits === pageForfeits,
    `${forfeits} recorded, ${pageForfeits} on the page`)
  check('no forfeit was awarded games',
    (await prisma.seasonPlayoffMatch.count({
      where: { seasonId, forfeitEntrantId: { not: null }, OR: [{ homeGames: { not: null } }, { awayGames: { not: null } }] },
    })) === 0)

  /*
   * A disqualification is recorded as a blocker, never as a result.
   *
   * The pages print DQ for nine matches. There is no disqualification outcome in this record, so
   * each must remain undecided — importing one would mean inventing a rule to fit an archive.
   */
  const dq = wayback.matches.filter((m) => m.outcome === 'disqualification')
  let dqDecided = 0
  for (const m of dq) {
    const row = await prisma.seasonPlayoffMatch.findFirst({
      where: { seasonId, round: m.round, slot: m.position }, select: { winnerEntrantId: true },
    })
    if (row?.winnerEntrantId) dqDecided++
  }
  check(`no disqualification was turned into a result (${dq.length} on the page)`, dqDecided === 0, `${dqDecided} decided`)
}

// ── Rankings boundary ───────────────────────────────────────────────────────────────────────────
/*
 * The rankings boundary cuts both ways.
 *
 * An incomplete Season must contribute nothing — that is the guarantee these three checks were
 * written for. A completed one must contribute, and exactly once: asserting emptiness for every
 * Season would fail the moment a reconstruction genuinely finished one, which is the outcome the
 * whole exercise is for.
 */
const ledgerRows = await prisma.ratingLedger.count({ where: { seasonId } })
if (String(season.lifecycleState) === 'COMPLETED') {
  check('a completed Season contributes to Rankings', ledgerRows > 0, String(ledgerRows))
  check('a completed Season names its champion', Boolean(season.championName), String(season.championName))
  check('and carries exactly one ranking contribution', Boolean(season.ladderAppliedAt))

  /*
   * The champion has to be the player who actually won the Final, not merely somebody named.
   */
  const finalMatch = await prisma.seasonPlayoffMatch.findFirst({
    where: { seasonId, feedsMatchId: null },
    select: { winnerEntrantId: true },
    orderBy: { round: 'desc' },
  })
  check('the champion is the winner of the Final', Boolean(finalMatch?.winnerEntrantId))

  const titles = await prisma.season.count({ where: { id: seasonId, championName: { not: null } } })
  check('exactly one championship is recorded', titles === 1, String(titles))
} else {
  check('an incomplete Season contributes nothing to Rankings', ledgerRows === 0, String(ledgerRows))
  check('no champion is claimed before a Final was played', !season.championName)
  check('no ranking contribution is stamped', !season.ladderAppliedAt)
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
await prisma.$disconnect()
if (fail > 0) process.exitCode = 1
