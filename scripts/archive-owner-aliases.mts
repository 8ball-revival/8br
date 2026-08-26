/**
 * Record the owner-confirmed bracket handles as aliases of the people who used them.
 *
 * ── Why aliases and not merges ───────────────────────────────────────────────────────────────────
 * The nine earlier identity decisions were merges because both sides existed as accounts and one had
 * to absorb the other. These three are different: `TrueBoston` and `Cocky_Guy` appear only on the
 * archived bracket pages and have no account at all. There is nothing to merge. Creating an account
 * purely to merge it away would mint an identity that never existed and leave a tombstone behind.
 *
 * An alias is what the situation actually is — one person, known by another name in one source — and
 * it is what makes the handle resolve so the bracket position it names can be seated.
 *
 * ── The spellings ────────────────────────────────────────────────────────────────────────────────
 * The owner wrote `I_am_aimost_god`; both the archive manifest and this database spell it
 * `i_am_almost_god`. Same person, and the canonical account is the one that exists.
 *
 * Usage: tsx scripts/archive-owner-aliases.mts [--dry-run|--apply]
 */
import { prisma } from '../src/lib/prisma.ts'
import { assertLocalDatabase } from '../src/lib/db-guard.ts'
import { addAlias } from '../src/lib/players/aliases.ts'

assertLocalDatabase()

const APPLY = process.argv.includes('--apply')
const ACTOR = { userId: 2, username: 'archive-import-merge' }

/** bracket handle → the CueVerse ID of the person who used it, as the owner confirmed. */
const CONFIRMED: { handle: string; canonical: string; note: string }[] = [
  {
    handle: 'TrueBoston',
    canonical: 'sykology',
    note: 'owner-confirmed the same person; the 2010 S1A bracket seats TrueBoston where the manifest lists sykology',
  },
  {
    handle: 'Cocky_Guy',
    canonical: 'i_am_almost_god',
    note: 'owner-confirmed as Craig, who also used i_am_almost_god; the 2011 brackets seat Cocky_Guy',
  },
]

for (const c of CONFIRMED) {
  const player = await prisma.player.findFirst({
    where: { cueverseIdNormalized: c.canonical.toLowerCase() },
    select: { id: true, cueverseId: true, primaryName: true },
  })
  if (!player) { console.log(`REFUSED ${c.handle} → ${c.canonical}: that account does not exist`); continue }

  /*
   * A handle that already belongs to somebody is never quietly reassigned.
   *
   * If it resolves anywhere else, that is a different identity question and it goes back to the
   * owner rather than being decided here.
   */
  const existingPlayer = await prisma.player.findFirst({
    where: { cueverseIdNormalized: c.handle.toLowerCase() }, select: { id: true, cueverseId: true },
  })
  if (existingPlayer) {
    console.log(`REFUSED ${c.handle} → ${c.canonical}: ${c.handle} already exists as its own account (${existingPlayer.id}); this needs a merge, not an alias`)
    continue
  }
  const claimed = await prisma.playerAlias.findFirst({
    where: { alias: { equals: c.handle, mode: 'insensitive' } }, select: { playerId: true },
  })
  if (claimed && claimed.playerId !== player.id) {
    console.log(`REFUSED ${c.handle}: already an alias of a different player (${claimed.playerId})`)
    continue
  }
  if (claimed) { console.log(`ALREADY_RECORDED ${c.handle} → ${c.canonical}`); continue }

  console.log(`${c.handle} → ${c.canonical} (${player.primaryName})`)
  if (!APPLY) { console.log('  would record as an alias'); continue }

  const r = await addAlias(ACTOR, player.id, c.handle)
  console.log(r.ok ? `  RECORDED as alias "${r.alias}"` : `  FAILED: ${r.error}`)
}

console.log('')
for (const c of CONFIRMED) {
  const p = await prisma.player.findFirst({
    where: { cueverseIdNormalized: c.canonical.toLowerCase() },
    select: { cueverseId: true, primaryName: true, aliases: { select: { alias: true } } },
  })
  if (p) console.log(`${p.cueverseId} (${p.primaryName}): aliases [${p.aliases.map((a) => a.alias).join(', ')}]`)
}

await prisma.$disconnect()
