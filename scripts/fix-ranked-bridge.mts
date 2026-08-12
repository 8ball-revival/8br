/**
 * CORRECTIVE RE-BRIDGE. The migration first bridged each account to resolveIdentity(rankingName),
 * but the live ranking ROW keys on the id the player's fixture handles resolve to — different for a
 * few players. This re-points each migrated profile's `legacyPlayerId` to the ACTUAL ranking-row id
 * (matched by row name = the mapping's left column) and blanks any Preferred Name (primaryName =
 * CueVerse ID). Idempotent + read-only w.r.t. stats.
 */
import { readFileSync } from 'node:fs'
import { prisma } from '../src/lib/prisma.ts'
import { getCurrentScoreRankings } from '../src/lib/stats/current-score.ts'
import { resolveIdentity } from '../src/lib/stats/identity.ts'
import { tournamentStore, loadTournamentContext } from '../src/lib/tournaments/prime.ts'
tournamentStore.enterWith(await loadTournamentContext())

const nk = (s: string) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '')
const MAP_FILE = 'C:/Users/Cerebro/Downloads/fixed accounts.txt'

interface Entry { oldName: string; mappedId: string | null; merge: boolean }
const entries: Entry[] = []
for (const raw of readFileSync(MAP_FILE, 'utf8').split(/\r?\n/)) {
  if (!raw.trim()) continue
  const cols = raw.split(/\t+/).map((c) => c.trim()).filter(Boolean)
  if (cols.length < 2) continue
  const right = cols.slice(1).join(' ')
  if (/merge with .* #\d+/i.test(right)) entries.push({ oldName: cols[0], mappedId: null, merge: true })
  else entries.push({ oldName: cols[0], mappedId: right, merge: false })
}

// Live ranking rows → name(nk) → row id (+ the set of valid row ids).
const rows = getCurrentScoreRankings().rows as { id: string; name: string }[]
const idByName = new Map<string, string>()
const rowIds = new Set<string>()
for (const r of rows) { rowIds.add(r.id); if (!idByName.has(nk(r.name))) idByName.set(nk(r.name), r.id) }

/** The live ranking-row id for a mapping entry: exact row-name match, else resolveIdentity of the
 *  mapped id / old name when that resolves to a real current row (covers merged identities). */
function findRowId(oldName: string, mappedId: string): string | null {
  const byName = idByName.get(nk(oldName))
  if (byName && rowIds.has(byName)) return byName
  for (const h of [mappedId, oldName]) {
    const rid = resolveIdentity(h, h, { unknownAsSelf: false })?.id
    if (rid && rowIds.has(rid)) return rid
  }
  return null
}

// Pass 1: clear legacyPlayerId on all migrated profiles (avoid transient @unique collisions).
const mappedIds = entries.filter((e) => !e.merge).map((e) => e.mappedId!)
const profiles = await prisma.player.findMany({ where: { cueverseId: { in: mappedIds, mode: 'insensitive' } }, select: { id: true, cueverseId: true } })
const profByCue = new Map(profiles.map((p) => [nk(p.cueverseId || ''), p]))
await prisma.player.updateMany({ where: { id: { in: profiles.map((p) => p.id) } }, data: { legacyPlayerId: null } })

// Pass 2: set correct legacyPlayerId (ranking row id by matching name) + blank Preferred Name.
let fixed = 0, missingRow = 0, missingProfile = 0
for (const e of entries) {
  if (e.merge) continue
  const prof = profByCue.get(nk(e.mappedId!))
  if (!prof) { missingProfile++; console.log(`  ! no profile for mapped id "${e.mappedId}"`); continue }
  const rowId = findRowId(e.oldName, e.mappedId!)
  if (!rowId) { missingRow++; console.log(`  ! no ranking row for "${e.oldName}" (mapped ${e.mappedId})`); continue }
  await prisma.player.update({ where: { id: prof.id }, data: { legacyPlayerId: rowId, primaryName: e.mappedId! } })
  console.log(`  ✓ ${e.oldName.padEnd(16)} -> row ${rowId.padEnd(9)} bridged to ${e.mappedId}`)
  fixed++
}
console.log(`\nfixed=${fixed} missingRow=${missingRow} missingProfile=${missingProfile}`)
await prisma.$disconnect()
