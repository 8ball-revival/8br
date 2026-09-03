/**
 * Disposable fixtures for LOOKING at the Season Progress panel.
 *
 * The verification suite builds the same season, asserts against it and tears it down in one run —
 * which is right for a test and useless for comparing a rendered page against a design. This puts
 * the same fixtures in place and leaves them there.
 *
 * Same safety rule as the suite: it only ever touches 8BRCAM Season 2 of 2026, and only while that
 * Season is empty, so `--down` restores the exact prior state (zero rows, registration open).
 *
 *   npx tsx --tsconfig tsconfig.scripts.json scripts/fixture-season-progress.mts --up
 *   npx tsx --tsconfig tsconfig.scripts.json scripts/fixture-season-progress.mts --down
 *
 * ── Restart the dev server afterwards ───────────────────────────────────────────────────────────
 * The panel is held in `unstable_cache`, and `invalidateSeasonProgress` needs a request store to
 * clear it — which a script does not have, by design. So seeding from here changes the DATABASE and
 * leaves a running dev server showing whatever it cached, for up to five minutes.
 *
 * That is not a bug to work around; it is the same guarantee that stops a script silently
 * invalidating production caches. Restart the dev server after seeding, and the page picks the
 * fixtures up immediately.
 */
import { prisma } from '../src/lib/prisma.ts'
import { assertLocalDatabase } from '../src/lib/db-guard.ts'
import { publishSeasonGroups } from '../src/lib/seasons/groups.ts'
import { saveSeasonGroupResults } from '../src/lib/seasons/group-stage.ts'
import { getLadder } from '../src/lib/stats/ladder.ts'

assertLocalDatabase()

const ACTOR = { userId: 0, username: 'fixture-season-progress' }
const mode = process.argv.includes('--down') ? 'down' : 'up'

const season = await prisma.season.findFirst({
  where: { competitionSeries: { slug: '8brcam' }, number: 2, competitionYear: 2026 },
  select: { id: true, lifecycleState: true },
})
if (!season) { console.log('8BRCAM Season 2 of 2026 not found.'); process.exit(1) }

if (mode === 'down') {
  await prisma.seasonMatch.deleteMany({ where: { seasonId: season.id } })
  await prisma.seasonStanding.deleteMany({ where: { seasonId: season.id } })
  await prisma.seasonGroupPlayer.deleteMany({ where: { group: { seasonId: season.id } } })
  await prisma.seasonGroup.deleteMany({ where: { seasonId: season.id } })
  await prisma.seasonEntrant.deleteMany({ where: { seasonId: season.id } })
  await prisma.season.update({
    where: { id: season.id },
    data: { lifecycleState: 'REGISTRATION_OPEN', entrantsCount: 0 },
  })
  const left = await prisma.seasonEntrant.count({ where: { seasonId: season.id } })
  console.log(`Removed. Season ${season.id} is back to ${left} entrants, registration open.`)
  await prisma.$disconnect()
  process.exit(0)
}

const existing = await prisma.seasonEntrant.count({ where: { seasonId: season.id } })
if (existing > 0) { console.log(`Season ${season.id} already has ${existing} entrants. Run --down first.`); process.exit(1) }

const ladder = await getLadder('current')
const ranked = ladder.map((r) => ({ playerId: r.playerId, handle: r.cueverseId ?? r.name }))
const rankedIds = new Set(ranked.map((r) => r.playerId))
const unranked = await prisma.player.findMany({
  where: { active: true, managementOnly: false, cueverseId: { not: null }, id: { notIn: [...rankedIds] } },
  select: { id: true, cueverseId: true }, orderBy: { cueverseId: 'asc' }, take: 2,
})

const groupAHandles = ['Starkiller', 'Travis', 'l_Mr_CC_l', 'easyrun', 'S_U_K_I_O_O', 'Iantunstall']
const groupA = groupAHandles.map((h) => ranked.find((r) => r.handle === h)!).filter(Boolean)
const usedA = new Set(groupA.map((r) => r.playerId))
// sixohtwo held back past the two played groups, so the panel shows it leading the unplayed.
const rest = ranked.filter((r) => !usedA.has(r.playerId) && r.handle !== 'sixohtwo')
const sixohtwo = ranked.find((r) => r.handle === 'sixohtwo')!
const roster = [
  ...groupA, ...rest.slice(0, 6), sixohtwo, ...rest.slice(6, 23),
  ...unranked.map((p) => ({ playerId: p.id, handle: p.cueverseId! })),
].slice(0, 32)

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
      displayName: p?.primaryName ?? null, cueverseId: p?.cueverseId ?? null,
      status: 'APPROVED', addedByAdmin: true,
    },
  })
}
const entrants = await prisma.seasonEntrant.findMany({ where: { seasonId: season.id }, select: { id: true, playerId: true } })
const byPlayer = new Map(entrants.map((e) => [e.playerId!, e.id]))

const sizes = [6, 6, 5, 5, 5, 5]
let cursor = 0
const groupIds: number[] = []
for (let i = 0; i < sizes.length; i++) {
  const g = await prisma.seasonGroup.create({ data: { seasonId: season.id, code: String.fromCharCode(65 + i), ordinal: i }, select: { id: true } })
  groupIds.push(g.id)
  for (const r of roster.slice(cursor, cursor + sizes[i])) {
    await prisma.seasonGroupPlayer.create({ data: { groupId: g.id, entrantId: byPlayer.get(r.playerId)! } })
  }
  cursor += sizes[i]
}

await prisma.season.update({ where: { id: season.id }, data: { lifecycleState: 'GROUP_SETUP', entrantsCount: 32 } })
const pub = await publishSeasonGroups(ACTOR, season.id)
if (!pub.ok) { console.log('publish failed:', pub.error); process.exit(1) }

const matches = await prisma.seasonMatch.findMany({
  where: { seasonId: season.id },
  select: { id: true, groupId: true, homeEntrantId: true, awayEntrantId: true, version: true },
})

/* Group A: the worked example plus enough around it to fill the visible rows with real records. */
const starkiller = byPlayer.get(groupA[0].playerId)!
const SCORES = [[9, 1], [9, 1], [8, 2], [8, 2], [10, 0]]
const mine = matches.filter((m) => m.groupId === groupIds[0] && (m.homeEntrantId === starkiller || m.awayEntrantId === starkiller))
await saveSeasonGroupResults(ACTOR, season.id, groupIds[0], mine.map((m, i) => {
  const [w, l] = SCORES[i]
  const home = m.homeEntrantId === starkiller
  return { matchId: m.id, home: String(home ? w : l), away: String(home ? l : w), version: m.version }
}))

/* The rest of group A, so the table below the leader is not all 0–1–0. */
const others = matches.filter((m) => m.groupId === groupIds[0] && m.homeEntrantId !== starkiller && m.awayEntrantId !== starkiller)
const spread = [[7, 3], [6, 4], [8, 5], [5, 5], [9, 2], [4, 6], [7, 6], [10, 3], [6, 7], [8, 4]]
const fresh = await prisma.seasonMatch.findMany({ where: { id: { in: others.map((m) => m.id) } }, select: { id: true, version: true } })
const vers = new Map(fresh.map((m) => [m.id, m.version]))
await saveSeasonGroupResults(ACTOR, season.id, groupIds[0], others.map((m, i) => {
  const [a, b] = spread[i % spread.length]
  return { matchId: m.id, home: String(a), away: String(b), version: vers.get(m.id)! }
}))

/* Group B: a draw and a forfeit, so both appear in the rendered table. */
const gb = matches.filter((m) => m.groupId === groupIds[1])
const gbFresh = await prisma.seasonMatch.findMany({ where: { id: { in: gb.map((m) => m.id) } }, select: { id: true, version: true } })
const gbVers = new Map(gbFresh.map((m) => [m.id, m.version]))
await saveSeasonGroupResults(ACTOR, season.id, groupIds[1], [
  { matchId: gb[0].id, home: '5', away: '5', version: gbVers.get(gb[0].id)! },
  { matchId: gb[1].id, home: '9', away: '4', version: gbVers.get(gb[1].id)! },
])
const ffVer = await prisma.seasonMatch.findUnique({ where: { id: gb[2].id }, select: { version: true } })
await saveSeasonGroupResults(ACTOR, season.id, groupIds[1],
  [{ matchId: gb[2].id, home: 'FF', away: '', version: ffVer!.version }], { confirmFF: true })

console.log(`Seeded Season ${season.id}: 32 entrants, 6 groups, group A played out, group B carrying a draw and a forfeit.`)
console.log('Remove with:  npx tsx --tsconfig tsconfig.scripts.json scripts/fixture-season-progress.mts --down')
await prisma.$disconnect()
