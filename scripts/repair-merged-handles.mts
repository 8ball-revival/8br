// RETIRED — see scripts/_retired.mjs. Importing this file refuses to run.
import './_retired.mjs'

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

/**
 * A handle lives in two stores. `Player.cueverseIdNormalized` is one; the Payload login
 * `users.username` is the other, and `changeCueverseId` writes both — rolling the whole rename back
 * if the second fails. Freeing only the Player half therefore does not free the handle: the claim
 * passes its uniqueness check and then dies on "Could not update the login identity".
 */
async function parkLoginUsername(userId: number, handle: string): Promise<boolean> {
  const rows = await prisma.$queryRaw<{ username: string | null }[]>`
    SELECT username FROM payload.users WHERE id = ${userId}`
  const current = rows[0]?.username ?? null
  if (!current || current.trim().toLowerCase() !== handle.trim().toLowerCase()) return false
  await prisma.$executeRaw`
    UPDATE payload.users SET username = ${`merged-${userId}`} WHERE id = ${userId}`
  return true
}

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
  /*
   * A merge already repaired on the Player side can still be holding the login name — the first
   * version of this script only freed one of the two stores. So when the column is already null,
   * fall back to the handle the snapshot recorded and finish the other half.
   */
  let snapshot: Record<string, unknown> = {}
  try { snapshot = m.note ? JSON.parse(m.note) : {} } catch { snapshot = {} }
  const recorded = typeof snapshot.secondaryCueverseId === 'string' ? snapshot.secondaryCueverseId : null
  const handle = (secondary?.cueverseId ?? recorded ?? '').trim()
  if (!handle) continue
  const stillOnPlayer = !!secondary?.cueverseId
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

    if (stillOnPlayer && secondary) {
      await tx.player.update({
        where: { id: secondary.id },
        data: { cueverseId: null, cueverseIdNormalized: null },
      })
    }

    // Teach the existing snapshot what was released, so undo can put it back.
    const snap = { ...snapshot }
    snap.secondaryCueverseId = handle
    if (aliasAdded) snap.aliasAddedToCanonical = true
    await tx.playerMerge.update({ where: { id: m.id }, data: { note: JSON.stringify(snap) } })
  })

  // Free the login half as well, and remember the old name so undo can restore it.
  let snapNote = ''
  try {
    const snap = JSON.parse((await prisma.playerMerge.findUniqueOrThrow({ where: { id: m.id }, select: { note: true } })).note ?? '{}')
    const uid = typeof snap.secondaryUserId === 'number' ? snap.secondaryUserId : null
    if (uid && (await parkLoginUsername(uid, handle))) {
      snap.secondaryUsername = handle
      await prisma.playerMerge.update({ where: { id: m.id }, data: { note: JSON.stringify(snap) } })
      snapNote = ' + login name freed'
    }
  } catch { /* an unreadable snapshot is not a reason to leave the handle stranded */ }

  if (!stillOnPlayer && !snapNote) continue // both halves were already free
  released++
  const note = (showable ? '' : ' (not aliased — it is an email address, and aliases are public)') + snapNote
  console.log(`  ✓ "${handle}" released from ${secondary.primaryName} → free (merged into ${canonical?.cueverseId ?? canonical?.primaryName})${note}`)
}

console.log(`\nreleased ${released} handle(s)`)
await prisma.$disconnect()
