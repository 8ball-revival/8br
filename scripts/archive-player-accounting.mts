/**
 * Account for every Player row, line by line, against what the archive actually asks for.
 *
 * Several creation runs overlapped, and two of them were killed before they could print a total, so
 * the run logs cannot be trusted to add up. This counts the rows themselves.
 */
import { prisma } from '../src/lib/prisma.ts'
import { assertLocalDatabase } from '../src/lib/db-guard.ts'
import { loadManifest, stripSourceNote, type ManifestEntry } from '../src/lib/archive/manifest.ts'

assertLocalDatabase()

const entries = loadManifest().entries as ManifestEntry[]
const sourceHandles = new Set<string>()
for (const e of entries) {
  for (const p of [...e.participants, ...(e.playoff?.participants ?? [])]) {
    const h = stripSourceNote(p.normalizedHandle).toLowerCase()
    if (h) sourceHandles.add(h)
  }
}

const players = await prisma.player.findMany({
  select: { id: true, cueverseId: true, cueverseIdNormalized: true, createdAt: true },
})
const aliases = await prisma.playerAlias.findMany({ select: { playerId: true, alias: true } })
const merges = await prisma.playerMerge.findMany({ select: { mergedPlayerId: true, canonicalPlayerId: true } })
const mergedAway = new Set(merges.map((m) => m.mergedPlayerId))

const live = players.filter((p) => !mergedAway.has(p.id) && (p.cueverseIdNormalized ?? '').trim())
const tombstones = players.filter((p) => mergedAway.has(p.id))

const liveIds = new Set(live.map((p) => (p.cueverseIdNormalized ?? '').toLowerCase()))
const aliasSet = new Set(aliases.map((a) => a.alias.toLowerCase()))

// Which archive handles are satisfied, and how
let byId = 0, byAlias = 0, unresolved: string[] = []
for (const h of sourceHandles) {
  if (liveIds.has(h)) byId++
  else if (aliasSet.has(h)) byAlias++
  else unresolved.push(h)
}

const entrantCounts = new Map<string, number>()
for (const g of await prisma.seasonEntrant.groupBy({ by: ['playerId'], _count: true })) {
  if (g.playerId) entrantCounts.set(g.playerId, g._count)
}

// A live Player whose handle the archive never prints, and who holds no entrant anywhere.
const noSourceNoEntrant = live.filter((p) =>
  !sourceHandles.has((p.cueverseIdNormalized ?? '').toLowerCase()) &&
  !aliasSet.has((p.cueverseIdNormalized ?? '').toLowerCase()) &&
  (entrantCounts.get(p.id) ?? 0) === 0)

const buckets = new Map<string, number>()
for (const p of players) {
  const k = p.createdAt.toISOString().slice(0, 13) + ':00Z'
  buckets.set(k, (buckets.get(k) ?? 0) + 1)
}

console.log(JSON.stringify({
  playersTotalRows: players.length,
  liveIdentities: live.length,
  mergeTombstones: tombstones.length,
  archiveHandlesRequired: sourceHandles.size,
  satisfiedByCueverseId: byId,
  satisfiedByAlias: byAlias,
  archiveHandlesStillUnresolved: unresolved.length,
  aliasRowsTotal: aliases.length,
  mergesRecorded: merges.length,
  liveWithNoArchiveSourceAndNoEntrant: noSourceNoEntrant.length,
}, null, 2))

console.log('\nPlayer rows by creation hour (UTC):')
for (const [k, v] of [...buckets.entries()].sort()) console.log(`  ${k}  ${v}`)

if (unresolved.length) {
  console.log(`\nstill unresolved (${unresolved.length}):`)
  for (const h of unresolved.slice(0, 20)) console.log(`  ${h}`)
}
if (noSourceNoEntrant.length) {
  console.log(`\nlive identities with no archive source and no entrant (${noSourceNoEntrant.length}):`)
  for (const p of noSourceNoEntrant.slice(0, 30)) console.log(`  ${p.cueverseId}  ${p.id}  created ${p.createdAt.toISOString()}`)
}

await prisma.$disconnect()
