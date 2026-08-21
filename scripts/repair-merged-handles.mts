/**
 * Release CueVerse IDs still held by profiles that were merged away before handles were freed.
 *
 * Merges recorded before that change left the retired profile holding its handle. Because
 * `Player.cueverseIdNormalized` is UNIQUE, those handles are unusable — including by the profile
 * they were merged into, which is usually exactly who wants them.
 *
 * For each APPROVED merge whose retired profile still has a handle: copy it to the canonical profile
 * as an alias (so nothing becomes unfindable), clear the column, and record the release in the
 * merge's snapshot so undo can still give it back.
 *
 * Idempotent, and does nothing to a merge whose handle was already released.
 *
 * Run: npx tsx --tsconfig scripts/tsconfig.verify.json --env-file=.env scripts/repair-merged-handles.mts
 */
import { prisma } from '../src/lib/prisma.ts'
import { assertLocalDatabase } from '../src/lib/db-guard.ts'

assertLocalDatabase()

const merges = await prisma.playerMerge.findMany({
  where: { status: 'APPROVED' },
  select: { id: true, canonicalPlayerId: true, mergedPlayerId: true, note: true },
  orderBy: { createdAt: 'asc' },
})

console.log(`approved merges: ${merges.length}`)
let released = 0

for (const m of merges) {
  const secondary = await prisma.player.findUnique({
    where: { id: m.mergedPlayerId },
    select: { id: true, primaryName: true, cueverseId: true },
  })
  if (!secondary?.cueverseId) continue

  const handle = secondary.cueverseId.trim()
  const canonical = await prisma.player.findUnique({
    where: { id: m.canonicalPlayerId },
    select: { primaryName: true, cueverseId: true },
  })

  /*
   * An email address is not a public handle.
   *
   * Some archive-era profiles were registered under one, and aliases are public — searched, exported
   * in the Rankings CSV, shown on profiles. The handle is still released; it is simply not
   * advertised, and the address stops being visible anywhere rather than moving from one public
   * field to another.
   */
  const showable = !handle.includes('@')

  await prisma.$transaction(async (tx) => {
    let aliasAdded = false
    if (showable) {
      const existing = await tx.playerAlias.findFirst({
        where: { playerId: m.canonicalPlayerId, alias: { equals: handle, mode: 'insensitive' }, aliasType: 'HANDLE' },
        select: { id: true },
      })
      if (!existing) {
        await tx.playerAlias.create({
          data: { playerId: m.canonicalPlayerId, alias: handle, aliasType: 'HANDLE' },
        })
        aliasAdded = true
      }
    }

    await tx.player.update({
      where: { id: secondary.id },
      data: { cueverseId: null, cueverseIdNormalized: null },
    })

    // Teach the existing snapshot what was released, so undo can put it back.
    let snap: Record<string, unknown> = {}
    try { snap = m.note ? JSON.parse(m.note) : {} } catch { snap = {} }
    snap.secondaryCueverseId = handle
    if (aliasAdded) snap.aliasAddedToCanonical = true
    await tx.playerMerge.update({ where: { id: m.id }, data: { note: JSON.stringify(snap) } })
  })

  released++
  const note = showable ? '' : ' (not aliased — it is an email address, and aliases are public)'
  console.log(`  ✓ "${handle}" released from ${secondary.primaryName} → free (merged into ${canonical?.cueverseId ?? canonical?.primaryName})${note}`)
}

console.log(`\nreleased ${released} handle(s)`)
await prisma.$disconnect()
