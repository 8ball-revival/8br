import { readFileSync, writeFileSync } from 'node:fs'
import { prisma } from '../src/lib/prisma.ts'
const csv = (f: string) => {
  const t = readFileSync(`archive/cueverse-prime/data/csv/${f}`, 'utf8').replace(/^\uFEFF/, '')
  const [h, ...rows] = t.split(/\r?\n/).filter(Boolean)
  const cols = h.split(',')
  return rows.map(r => { const v = r.split(','); return Object.fromEntries(cols.map((c,i)=>[c, v[i] ?? ''])) as Record<string,string> })
}
const P = Object.fromEntries(csv('players.csv').map(r => [r.player_id, r]))
const st = csv('group_standings.csv').filter(r => r.season_id==='2005-s1' && r.division==='single')
const gm = csv('group_matches.csv').filter(r => r.season_id==='2005-s1' && r.division==='single')

const s = await prisma.season.findFirst({ where: { number: 1 }, select: { id: true } })
const groups = await prisma.seasonGroup.findMany({ where: { seasonId: s!.id }, orderBy: { ordinal: 'asc' },
  select: { id: true, code: true, players: { select: { entrant: { select: { id: true, username: true, displayName: true } } } } } })

// archive handle -> DB entrant, per group. Archive group letter == DB code (GA->A ...).
const norm = (v: string) => v.toLowerCase().replace(/[^a-z0-9]/g, '')
const manual: Record<string,string> = { rfc_stuart_c_rfc: 'Stu', lvl_i_g_h_t_y: 'Aaron' }
const byGroup: Record<string, Map<string, { id: number; username: string }>> = {}
for (const g of groups) byGroup[g.code] = new Map(g.players.map(p => [norm(p.entrant.username), { id: p.entrant.id, username: p.entrant.username }]))

function resolve(pid: string, groupCode: string) {
  const p = P[pid]; const m = byGroup[groupCode]
  const tries = [manual[p.primary_ym], p.primary_ym, p.primary_name].filter(Boolean).map(norm)
  for (const t of tries) if (m.has(t)) return m.get(t)!
  return null
}
const out: { group: string; home: string; away: string; hg: number; ag: number }[] = []
const missing: string[] = []
for (const m of gm) {
  const code = m.group_id.slice(-1)
  const a = resolve(m.player_a_id, code), b = resolve(m.player_b_id, code)
  if (!a || !b) { missing.push(`${m.group_id} ${P[m.player_a_id]?.primary_ym}/${P[m.player_b_id]?.primary_ym}`); continue }
  out.push({ group: code, home: a.username, away: b.username, hg: Number(m.score_a), ag: Number(m.score_b) })
}
console.log('archive matches:', gm.length, '| mapped:', out.length, '| unmapped:', missing.length)
if (missing.length) console.log('  unmapped:', missing.slice(0,6))
const perGroup: Record<string, number> = {}
for (const o of out) perGroup[o.group] = (perGroup[o.group] ?? 0) + 1
console.log('per group:', JSON.stringify(perGroup))
writeFileSync('C:/Claude/8BR/.local/season1-results.json', JSON.stringify(out, null, 0))
console.log('sample:', JSON.stringify(out.slice(0,3)))
await prisma.$disconnect()
