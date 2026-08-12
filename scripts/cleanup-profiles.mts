import { getAllArchiveSeasons } from '../src/lib/seasons/archive.ts'
import { getCups } from '../src/lib/tournaments/fixtures.ts'
import { resolveIdentity } from '../src/lib/stats/identity.ts'
import { prisma } from '../src/lib/prisma.ts'

const nk = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
// Authoritative id -> {name, handle} from published Seasons/Cups (first seen wins).
const auth = new Map<string, { name: string; handle: string | null }>()
const add = (slot?: { name?: string | null; handle?: string | null } | null) => {
  if (!slot || !slot.name || slot.name === 'Bye') return
  const r = resolveIdentity(slot.handle, slot.name, { unknownAsSelf: true })
  if (r && !auth.has(r.id)) auth.set(r.id, { name: r.name, handle: slot.handle ?? null })
}
for (const s of getAllArchiveSeasons()) { if (s.pending) continue; for (const d of s.divisions) {
  add(d.champion); add(d.runnerUp)
  for (const g of d.groups ?? []) for (const row of g.rows) add(row)
  for (const rd of [...(d.playoff?.rounds ?? []), ...(d.doubleElim ? [...d.doubleElim.winners, ...d.doubleElim.losers] : [])]) for (const m of rd.matches) { add(m.a); add(m.b) }
} }
for (const c of getCups()) {
  add(c.champion); add(c.runnerUp)
  for (const rd of [...(c.bracket??[]), ...(c.winnersBracket??[]), ...(c.losersBracket??[]), ...(c.grandFinal??[])]) for (const m of rd.matches) { add(m.a); add(m.b) }
  for (const t of c.teamTies ?? []) for (const m of t.matches) { add(m.home); add(m.away) }
}

// PRUNE unbacked (legacy-only identities, not claimed, not manual).
const all = await prisma.player.findMany({ select: { id: true, legacyPlayerId: true, linkedUserId: true } })
const toDelete = all.filter((p) => p.legacyPlayerId && !auth.has(p.legacyPlayerId) && !p.linkedUserId).map((p) => p.id)
const delAliases = await prisma.playerAlias.deleteMany({ where: { playerId: { in: toDelete } } })
const del = await prisma.player.deleteMany({ where: { id: { in: toDelete } } })
console.log(`Pruned ${del.count} unbacked profiles (${delAliases.count} aliases).`)

// BACKFILL authoritative participants that have no profile.
const have = new Set((await prisma.player.findMany({ where: { legacyPlayerId: { not: null } }, select: { legacyPlayerId: true } })).map((p) => p.legacyPlayerId!))
const missing = [...auth.entries()].filter(([id]) => !have.has(id))
for (const [id, info] of missing) {
  const p = await prisma.player.create({ data: { legacyPlayerId: id, primaryName: info.name, cueverseId: info.handle, linkStatus: 'UNLINKED', active: true, provenance: 'NATIVE_EGO' } })
  if (info.handle) await prisma.playerAlias.create({ data: { playerId: p.id, alias: nk(info.handle), aliasType: 'HANDLE' } })
}
console.log(`Backfilled ${missing.length} authoritative participants missing a profile.`)

// PRIMARY CueVerse IDs: required map, else single-alias, else flag (null = needs review).
const PRIMARY: Record<string, string> = { P0969: 'sixohtwo', neo: 'Starkiller', P1791: 'MJ_The_King' }
const profiles = await prisma.player.findMany({ include: { aliases: true } })
let flagged = 0, set = 0
for (const p of profiles) {
  let primary: string | null = null
  if (p.legacyPlayerId && PRIMARY[p.legacyPlayerId]) primary = PRIMARY[p.legacyPlayerId]
  else if (p.cueverseId && p.aliases.length <= 1) primary = p.cueverseId // single handle → unambiguous
  else if (p.aliases.length === 1) primary = p.aliases[0].alias
  else primary = null // multiple aliases, no confirmed primary → flag
  if (primary === null) flagged++
  else set++
  if (primary !== p.cueverseId) await prisma.player.update({ where: { id: p.id }, data: { cueverseId: primary } })
}
console.log(`Primary IDs set: ${set}; flagged for review (null): ${flagged}`)
console.log(`FINAL profile count: ${await prisma.player.count()}`)
const kevin = await prisma.player.findUnique({ where: { legacyPlayerId: 'P0969' } })
const neo = await prisma.player.findUnique({ where: { legacyPlayerId: 'neo' } })
const mj = await prisma.player.findUnique({ where: { legacyPlayerId: 'P1791' } })
console.log('Kevin primary:', kevin?.cueverseId, '| Neo:', neo?.primaryName, neo?.cueverseId, '| MJ:', mj?.cueverseId)
process.exit(0)
