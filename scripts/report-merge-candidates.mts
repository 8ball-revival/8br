/**
 * Find accounts that probably belong to the same person, for a human to review.
 *
 * Read-only. It proposes nothing and merges nothing — the archive import deliberately never fuses
 * two identities on its own, so this is the list of everything it deliberately kept apart plus the
 * patterns that suggest a duplicate.
 *
 * Tiers reflect how much the evidence is worth:
 *   1  the same handle with a bookkeeping marker attached, or a live account squatting an archive
 *      handle — near-certainly one person
 *   2  the same display name and clearly related handles
 *   3  the same display name only — weak on its own, listed because the pair also overlaps in time
 *
 * Run:  npx tsx --tsconfig scripts/tsconfig.verify.json scripts/report-merge-candidates.mts
 */
import { prisma } from '../src/lib/prisma.ts'
import { loadArchive } from './archive-source.mts'
import { isArchiveEmail } from '../src/lib/archive/identity.ts'

interface Account {
  playerId: string
  cueverseId: string
  name: string
  userId: number | null
  email: string
  isArchive: boolean
  firstYear: number
  lastYear: number
}

interface Candidate { tier: 1 | 2 | 3; a: Account; b: Account; why: string }

/** Markers the archivists appended to a handle to tell two records apart. */
const MARKER = /-(x|wc|\d{1,3}|p\d{4})$/i
const stripMarker = (id: string) => id.replace(MARKER, '')

async function main() {
  const d = loadArchive()
  const yearsByHandle = new Map<string, { first: number; last: number }>()
  for (const p of d.players.values()) {
    if (p.primaryYm) yearsByHandle.set(p.primaryYm.toLowerCase(), { first: p.firstYear, last: p.lastYear })
  }

  const players = await prisma.player.findMany({
    where: { cueverseId: { not: null } },
    select: { id: true, cueverseId: true, primaryName: true, linkedUserId: true },
  })
  const userIds = players.map((p) => Number(p.linkedUserId)).filter((n) => Number.isFinite(n))
  const users = userIds.length
    ? await prisma.$queryRaw<{ id: number; email: string }[]>`
        SELECT id, email FROM payload.users WHERE id = ANY(${userIds}::int[])`
    : []
  const emailOf = new Map(users.map((u) => [Number(u.id), u.email]))

  const accounts: Account[] = players.map((p) => {
    const uid = p.linkedUserId ? Number(p.linkedUserId) : null
    const email = (uid != null ? emailOf.get(uid) : '') ?? ''
    const yrs = yearsByHandle.get(stripMarker(p.cueverseId ?? '').toLowerCase())
    return {
      playerId: p.id,
      cueverseId: p.cueverseId ?? '',
      name: (p.primaryName ?? '').trim(),
      userId: uid,
      email,
      isArchive: isArchiveEmail(email),
      firstYear: yrs?.first ?? 0,
      lastYear: yrs?.last ?? 0,
    }
  })

  const byId = new Map(accounts.map((a) => [a.cueverseId.toLowerCase(), a]))
  const out: Candidate[] = []
  const seen = new Set<string>()
  const key = (a: Account, b: Account) => [a.playerId, b.playerId].sort().join('|')
  const add = (tier: 1 | 2 | 3, a: Account, b: Account, why: string) => {
    const k = key(a, b)
    if (a.playerId === b.playerId || seen.has(k)) return
    seen.add(k)
    out.push({ tier, a, b, why })
  }

  // --- tier 1: a marker suffix on an otherwise identical handle ---
  for (const acc of accounts) {
    if (!MARKER.test(acc.cueverseId)) continue
    const base = byId.get(stripMarker(acc.cueverseId).toLowerCase())
    if (!base) continue
    const squatter = !base.isArchive && acc.isArchive
    add(
      1,
      base,
      acc,
      squatter
        ? `"${base.cueverseId}" is held by a NON-archive account (${base.email || 'no email'}), so the archive player was imported under a suffixed id`
        : `same handle, "${acc.cueverseId.slice(base.cueverseId.length)}" marker only`,
    )
  }

  // --- tier 2/3: same display name ---
  const byName = new Map<string, Account[]>()
  for (const a of accounts) {
    if (!a.name) continue
    const n = a.name.toLowerCase()
    if (!byName.has(n)) byName.set(n, [])
    byName.get(n)!.push(a)
  }
  for (const [, group] of byName) {
    if (group.length < 2 || group.length > 6) continue // huge name groups are just common first names
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i], b = group[j]
        const ida = a.cueverseId.toLowerCase(), idb = b.cueverseId.toLowerCase()
        const related = ida.startsWith(idb) || idb.startsWith(ida) || sharedPrefix(ida, idb) >= 6
        const overlaps = a.firstYear && b.firstYear && a.firstYear <= b.lastYear && b.firstYear <= a.lastYear
        if (related) add(2, a, b, 'same display name and closely related handles')
        else if (overlaps) add(3, a, b, `same display name, both active ${Math.max(a.firstYear, b.firstYear)}-${Math.min(a.lastYear, b.lastYear)}`)
      }
    }
  }

  out.sort((x, y) => x.tier - y.tier || x.a.name.localeCompare(y.a.name))

  const counts = [1, 2, 3].map((t) => out.filter((c) => c.tier === t).length)
  console.log('=== Accounts that may need merging ===')
  console.log(`tier 1 (near-certain): ${counts[0]}`)
  console.log(`tier 2 (likely)      : ${counts[1]}`)
  console.log(`tier 3 (name only)   : ${counts[2]}`)
  console.log(`total                : ${out.length}\n`)

  for (const tier of [1, 2, 3] as const) {
    const rows = out.filter((c) => c.tier === tier)
    if (!rows.length) continue
    console.log(`--- tier ${tier} ---`)
    for (const c of rows) {
      console.log(`  ${c.a.name || '(no name)'} [${c.a.cueverseId}]  <->  ${c.b.name || '(no name)'} [${c.b.cueverseId}]`)
      console.log(`      ${c.why}`)
    }
    console.log('')
  }

  console.log('Already applied from the archive corrections (agreed, not listed above):')
  console.log(`  ${d.mergeMap.size} merge(s), ${d.splitMap.size} split(s)`)
}

/** Length of the shared leading run of two strings. */
function sharedPrefix(a: string, b: string): number {
  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i++
  return i
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1 })
  .finally(async () => { await prisma.$disconnect() })
