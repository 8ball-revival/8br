// RETIRED — see scripts/_retired.mjs. Importing this file refuses to run.
import './_retired.mjs'

/**
 * Seed canonical Player PROFILES from the shared identity resolver. One Player per
 * canonical identity (legacyPlayerId = the resolver id, e.g. "P0969" / "neo"), with
 * all of that person's handles as PlayerAliases. Profiles start UNLINKED. Stats still
 * derive from Seasons/Cups via the resolver keyed by legacyPlayerId — nothing here
 * duplicates historical statistics. Idempotent.
 *
 *   npx tsx scripts/seed-players.mts
 */
import aliasData from '../src/lib/stats/player-aliases.json'
import { resolveIdentity } from '../src/lib/stats/identity.ts'
import { prisma } from '../src/lib/prisma.ts'

const existing = await prisma.player.count()
if (existing > 0) {
  console.log(`Player table already has ${existing} profiles — leaving as-is (idempotent).`)
  process.exit(0)
}

const h2id = aliasData.handleToId as Record<string, string>
const byId = new Map<string, { name: string; handles: Set<string> }>()
for (const handle of Object.keys(h2id)) {
  const r = resolveIdentity(handle, handle, { unknownAsSelf: true })
  if (!r || !r.ok) continue
  const e = byId.get(r.id) ?? { name: r.name, handles: new Set<string>() }
  e.name = r.name
  e.handles.add(handle)
  byId.set(r.id, e)
}

// pick a representative public handle (prefer a clean one over clan-tag styles)
const pickCueverse = (handles: string[]): string => {
  const clean = handles.filter((h) => !/xlx|_x_|^ll|ll$|xx_|_xx|®|&#/.test(h))
  return (clean.length ? clean : handles).sort((a, b) => a.length - b.length)[0]
}

const ids = [...byId.keys()]
await prisma.player.createMany({
  data: ids.map((id) => {
    const e = byId.get(id)!
    return { legacyPlayerId: id, primaryName: e.name, cueverseId: pickCueverse([...e.handles]), linkStatus: 'UNLINKED' as const, active: true }
  }),
  skipDuplicates: true,
})

const rows = await prisma.player.findMany({ select: { id: true, legacyPlayerId: true } })
const idOf = new Map(rows.map((r) => [r.legacyPlayerId!, r.id]))
const aliasRows: { playerId: string; alias: string; aliasType: 'HANDLE' }[] = []
for (const [legacyId, e] of byId) {
  const pid = idOf.get(legacyId)
  if (!pid) continue
  for (const a of e.handles) aliasRows.push({ playerId: pid, alias: a, aliasType: 'HANDLE' })
}
await prisma.playerAlias.createMany({ data: aliasRows, skipDuplicates: true })

console.log(`Seeded ${ids.length} canonical Player profiles + ${aliasRows.length} aliases.`)
const kevin = await prisma.player.findUnique({ where: { legacyPlayerId: 'P0969' }, include: { aliases: true } })
console.log('Kevin (P0969):', kevin ? `"${kevin.primaryName}" cueverseId=${kevin.cueverseId} linkStatus=${kevin.linkStatus} aliases=[${kevin.aliases.map((a) => a.alias).join(', ')}]` : 'NOT FOUND')
process.exit(0)
