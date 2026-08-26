/**
 * Validate the created-identity map against the database, and publish the merge-review reports.
 *
 * The map is written incrementally during creation, so it is a claim rather than a fact until each
 * entry is resolved back to a real Player. Anything that fails to resolve is a duplicate-account
 * hazard and is surfaced rather than reported as created.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { prisma } from '../src/lib/prisma.ts'
import { assertLocalDatabase } from '../src/lib/db-guard.ts'
assertLocalDatabase()

const map = JSON.parse(readFileSync('reports/archive-handle-map.json', 'utf8')) as Record<string, {
  rawHandle: string; cueverseId: string; playerId: string | null; userId: number | null
  status: string; seasons: string[]; candidates: { cueverseId: string | null; displayName: string | null; why: string }[]
  reason: string
}>

const CREDENTIAL = /password|passwd|hash|token|cookie|session|secret|bearer|authorization/i
const rawMap = readFileSync('reports/archive-handle-map.json', 'utf8')
console.log('map contains credential-like keys:', CREDENTIAL.test(rawMap))

const rows = Object.values(map).filter((m) => m.status === 'created')
const resolved: typeof rows = []
const broken: string[] = []
for (const m of rows) {
  const p = m.playerId ? await prisma.player.findUnique({ where: { id: m.playerId }, select: { id: true, cueverseId: true, cueverseIdNormalized: true, primaryName: true, linkedUserId: true } }) : null
  if (!p) { broken.push(m.cueverseId); continue }
  resolved.push({ ...m, userId: p.linkedUserId ? Number(p.linkedUserId) : m.userId })
}
console.log(`created entries: ${rows.length} | resolve to a real Player: ${resolved.length} | broken: ${broken.length}`, broken.join(','))

const norms = await prisma.player.findMany({ where: { id: { in: resolved.map((r) => r.playerId!) } }, select: { cueverseIdNormalized: true } })
const uniq = new Set(norms.map((n) => n.cueverseIdNormalized))
console.log(`normalized CueVerse IDs unique: ${uniq.size === norms.length} (${uniq.size}/${norms.length})`)

const sorted = [...resolved].sort((a, b) => a.cueverseId.toLowerCase().localeCompare(b.cueverseId.toLowerCase()))
mkdirSync('reports', { recursive: true })

const esc = (v: string) => `"${String(v).replace(/"/g, '""')}"`
const csv = [
  'cueverse_id,normalized,player_id,account_id,preferred_name,seasons,possible_merge_targets,reason_not_merged',
  ...sorted.map((r) => [
    esc(r.cueverseId), esc(r.cueverseId.toLowerCase()), esc(r.playerId ?? ''), esc(String(r.userId ?? '')),
    esc(''), esc(r.seasons.join('; ')),
    esc(r.candidates.map((c) => c.cueverseId ?? c.displayName ?? '?').join('; ')),
    esc(r.reason),
  ].join(',')),
].join('\n')
writeFileSync('reports/archive-created-players.csv', csv + '\n')

const md = [
  '# Archive import — created player identities',
  '',
  `${sorted.length} identities were created because no existing Player matched their archive handle by`,
  'CueVerse ID, alias or attached historical handle. None were merged automatically: attaching a',
  'historical record to the wrong person is far harder to undo than merging two afterwards.',
  '',
  'Preferred Name is empty throughout — the archive supplies handles, not names, and inventing one',
  'would be fabricating a fact.',
  '',
  '| CueVerse ID | Player ID | Account ID | Seasons | Possible merge target | Why not merged |',
  '| --- | --- | --- | --- | --- | --- |',
  ...sorted.map((r) => `| ${r.cueverseId} | ${r.playerId} | ${r.userId ?? '—'} | ${r.seasons.join(', ')} | ${r.candidates.map((c) => c.cueverseId ?? '—').join(', ') || '—'} | ${r.reason} |`),
  '',
].join('\n')
writeFileSync('reports/archive-created-players.md', md)

console.log('\nCueVerse ID | Player ID | Account ID | Possible merge target')
for (const r of sorted) console.log(`${r.cueverseId} | ${r.playerId} | ${r.userId ?? '—'} | ${r.candidates.map((c) => c.cueverseId ?? '—').join(', ') || '—'}`)
await prisma.$disconnect()
