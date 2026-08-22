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

assertLocalDatabase()

const seasonId = Number(process.argv[2])
if (!Number.isFinite(seasonId)) throw new Error('pass a season id')

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
check('recomputed wins agree with the archived standings', winsDiffer === 0, `${winsDiffer} differ`)

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
  check('an unrecorded topology is left unseated', bracket.every((m) => !m.homeEntrantId && !m.awayEntrantId) || bracket.length === 0)
}
check('no playoff result was invented', bracket.every((m) => !m.winnerEntrantId))

// ── Rankings boundary ───────────────────────────────────────────────────────────────────────────
check('an incomplete Season contributes nothing to Rankings',
  (await prisma.ratingLedger.count({ where: { seasonId } })) === 0)
check('no champion is claimed before a Final was played', !season.championName)
check('no ranking contribution is stamped', !season.ladderAppliedAt)

console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
await prisma.$disconnect()
if (fail > 0) process.exitCode = 1
