/**
 * Account for every Player row, and prove no duplicate identity was created.
 *
 * Overlapping runs of the creation pass are the risk this exists to rule out: two processes both
 * deciding a handle is missing and both creating it. The unique index on the normalised CueVerse ID
 * would stop an exact repeat, so the shapes worth hunting are the ones it cannot see — the same
 * person spelled with different punctuation, underscores, casing, a wildcard annotation, or with
 * their letters spaced out.
 */
import { prisma } from '../src/lib/prisma.ts'
import { assertLocalDatabase } from '../src/lib/db-guard.ts'

assertLocalDatabase()

const players = await prisma.player.findMany({
  select: { id: true, cueverseId: true, cueverseIdNormalized: true, primaryName: true, linkedUserId: true, createdAt: true },
  orderBy: { createdAt: 'asc' },
})

const aliases = await prisma.playerAlias.findMany({ select: { playerId: true, alias: true } })

// ── Counts ───────────────────────────────────────────────────────────────────────────────────────
const merges = await prisma.auditLog.groupBy({
  by: ['action'],
  where: { actorUsername: 'archive-import-merge' },
  _count: true,
})

const entrantsByPlayer = new Map<string, number>()
for (const g of await prisma.seasonEntrant.groupBy({ by: ['playerId'], _count: true })) {
  if (g.playerId) entrantsByPlayer.set(g.playerId, g._count)
}

/*
 * "Created during this pass" is read from the row's own timestamp rather than from a log, because
 * the logs of several overlapping runs are exactly what is in doubt.
 */
const PASS_START = new Date('2026-08-22T18:00:00Z')
const createdThisPass = players.filter((p) => p.createdAt >= PASS_START)
const preExisting = players.filter((p) => p.createdAt < PASS_START)

// ── Duplicate hunting ────────────────────────────────────────────────────────────────────────────
/** Reduce a handle to the letters and digits that carry its identity. */
const fingerprint = (h: string) =>
  h.toLowerCase()
    .replace(/\s*[[(]?\s*w\/c\s*[\])]?\s*$/i, '')
    .replace(/[·•]/g, '')
    .replace(/[^a-z0-9]/g, '')

const exact = new Map<string, string[]>()
const loose = new Map<string, string[]>()
const spaced = new Map<string, string[]>()
for (const p of players) {
  const n = p.cueverseIdNormalized ?? p.cueverseId ?? ''
  exact.set(n.toLowerCase(), [...(exact.get(n.toLowerCase()) ?? []), p.cueverseId ?? p.id])
  const f = fingerprint(n)
  if (f) loose.set(f, [...(loose.get(f) ?? []), p.cueverseId ?? p.id])
  // "x_l_x_k_e_t_a_n" and "xlxketan" collapse to the same thing once single letters are joined.
  const s = f.replace(/(?<=\b|[a-z0-9])(?=[a-z0-9])/g, '')
  if (s) spaced.set(s, [...(spaced.get(s) ?? []), p.cueverseId ?? p.id])
}

const dupExact = [...exact.entries()].filter(([, v]) => v.length > 1)
const dupLoose = [...loose.entries()].filter(([, v]) => v.length > 1)

// An alias must not also exist as somebody else's CueVerse ID — that is one person in two places.
const idSet = new Map(players.map((p) => [(p.cueverseIdNormalized ?? '').toLowerCase(), p.id]))
const aliasCollisions = aliases.filter((a) => {
  const owner = idSet.get(a.alias.toLowerCase())
  return owner !== undefined && owner !== a.playerId
})

const orphans = createdThisPass.filter((p) => (entrantsByPlayer.get(p.id) ?? 0) === 0)

console.log(JSON.stringify({
  playersTotal: players.length,
  preExisting: preExisting.length,
  createdThisPass: createdThisPass.length,
  aliasesTotal: aliases.length,
  mergeAudits: Object.fromEntries(merges.map((m) => [m.action, m._count])),
  duplicateNormalisedIds: dupExact.length,
  duplicatesIgnoringPunctuation: dupLoose.length,
  aliasCollidingWithAnotherPlayersId: aliasCollisions.length,
  createdThisPassWithNoEntrantYet: orphans.length,
}, null, 2))

if (dupExact.length) {
  console.log('\nEXACT duplicate normalised CueVerse IDs:')
  for (const [k, v] of dupExact.slice(0, 20)) console.log(`  ${k}: ${v.join(', ')}`)
}
if (dupLoose.length) {
  console.log('\nSame handle once punctuation/underscores/annotations are removed:')
  for (const [k, v] of dupLoose.slice(0, 40)) console.log(`  ${k}: ${v.join(' | ')}`)
}
if (aliasCollisions.length) {
  console.log('\nAliases that are also another Player\'s CueVerse ID:')
  for (const a of aliasCollisions.slice(0, 20)) console.log(`  ${a.alias} (alias of ${a.playerId})`)
}

await prisma.$disconnect()
