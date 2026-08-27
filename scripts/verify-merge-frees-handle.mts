/**
 * A merged CueVerse ID must become available again.
 *
 * A merge retires one of two profiles belonging to the same person. The retired profile used to keep
 * its handle, and `Player.cueverseIdNormalized` is UNIQUE, so that handle became unusable forever —
 * including by the profile it was merged INTO, which is the commonest thing anyone wants to do with
 * it. Somebody registers twice, spelled two ways, and the spelling they actually want is stranded on
 * the row being retired.
 *
 * Covered here:
 *   - merging releases the secondary's handle
 *   - the handle survives as an alias on the canonical profile, so nothing becomes unfindable
 *   - the canonical profile can then take the handle
 *   - undo gives it back when it is still free
 *   - undo does NOT fail when it has been taken — it restores without it and says so
 *   - an alias the canonical profile already had is never removed by an undo
 *
 * Run: npx tsx --tsconfig scripts/tsconfig.verify.json --env-file=.env scripts/verify-merge-frees-handle.mts
 */
import { prisma } from '../src/lib/prisma.ts'
import { assertLocalDatabase } from '../src/lib/db-guard.ts'
import { mergeAccounts, undoMerge } from '../src/lib/players/merge.ts'

assertLocalDatabase()

const TAG = 'zzmfh'
const ACTOR = { userId: 2, username: 'verify-merge-handle', isAdmin: true, isOwner: true }

let pass = 0
let fail = 0
const check = (label: string, ok: boolean, detail?: string) => {
  if (ok) { pass++; console.log(`  ✓ ${label}`) }
  else { fail++; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`) }
}
const section = (t: string) => console.log(`\n--- ${t} ---`)

async function cleanup() {
  const ps = await prisma.player.findMany({ where: { primaryName: { startsWith: TAG } }, select: { id: true } })
  const ids = ps.map((p) => p.id)
  if (ids.length) {
    await prisma.playerMerge.deleteMany({ where: { OR: [{ canonicalPlayerId: { in: ids } }, { mergedPlayerId: { in: ids } }] } })
    await prisma.playerAlias.deleteMany({ where: { playerId: { in: ids } } })
    await prisma.player.deleteMany({ where: { id: { in: ids } } })
  }
}

const mk = (name: string, handle: string) =>
  prisma.player.create({
    data: { primaryName: `${TAG} ${name}`, cueverseId: handle, cueverseIdNormalized: handle.toLowerCase(), active: true },
    select: { id: true },
  })

const idOf = (id: string) =>
  prisma.player.findUniqueOrThrow({ where: { id }, select: { cueverseId: true, cueverseIdNormalized: true, active: true } })

const aliases = (id: string) =>
  prisma.playerAlias.findMany({ where: { playerId: id }, select: { alias: true, aliasDisplay: true } })

await cleanup()

section('Merging releases the secondary handle')
const keep = await mk('Keep', `${TAG}_keep`)
const drop = await mk('Drop', `${TAG}_drop`)

const merged = await mergeAccounts(ACTOR, keep.id, drop.id, 'verify')
check('the merge succeeds', merged.ok, merged.error)
const mergeId = merged.mergeId ?? null
check('it returns a merge id', mergeId != null)

const afterDrop = await idOf(drop.id)
check('the retired profile is deactivated', afterDrop.active === false)
check('...and no longer holds the handle', afterDrop.cueverseId == null && afterDrop.cueverseIdNormalized == null,
  String(afterDrop.cueverseId))
/*
 * The released handle arrives as a key AND a spelling. It used to be written raw into the match
 * column, so a merge produced a key nothing else could match -- tag_drop where every other path
 * stores tagdrop.
 */
const keepAliases = await aliases(keep.id)
const releasedKey = `${TAG}_drop`.replace(/[^a-z0-9]/g, '')
check('the handle is now an alias on the surviving profile',
  keepAliases.some((a) => a.alias === releasedKey), keepAliases.map((a) => a.alias).join(', '))
check('...stored as a normalised key so every lookup matches it',
  keepAliases.every((a) => a.alias === a.alias.toLowerCase().replace(/[^a-z0-9]/g, '')))
check('...and keeping the spelling it was released under',
  keepAliases.some((a) => a.aliasDisplay?.toLowerCase() === `${TAG}_drop`),
  keepAliases.map((a) => a.aliasDisplay ?? '-').join(', '))

section('The freed handle can actually be claimed')
let claimed = false
try {
  await prisma.player.update({
    where: { id: keep.id },
    data: { cueverseId: `${TAG}_drop`, cueverseIdNormalized: `${TAG}_drop` },
  })
  claimed = true
} catch (e) {
  check('the surviving profile can take the handle', false, e instanceof Error ? e.message : String(e))
}
if (claimed) check('the surviving profile can take the handle', (await idOf(keep.id)).cueverseId === `${TAG}_drop`)

section('Undo cannot take back a handle somebody else now holds')
const undone = await undoMerge(ACTOR, mergeId!, 'verify')
check('the undo still succeeds', undone.ok, undone.error)
check('...and warns that the handle was gone', /has since been taken/.test(undone.warning ?? ''), undone.warning)
const backDrop = await idOf(drop.id)
check('the profile is reactivated', backDrop.active === true)
check('...without the handle, rather than not at all', backDrop.cueverseId == null)
check('the surviving profile keeps what it claimed', (await idOf(keep.id)).cueverseId === `${TAG}_drop`)

section('Undo restores the handle when it is still free')
await prisma.player.update({
  where: { id: keep.id },
  data: { cueverseId: `${TAG}_keep`, cueverseIdNormalized: `${TAG}_keep` },
})
await prisma.player.update({
  where: { id: drop.id },
  data: { cueverseId: `${TAG}_drop`, cueverseIdNormalized: `${TAG}_drop`, active: true },
})
await prisma.playerAlias.deleteMany({ where: { playerId: keep.id } })

const again = await mergeAccounts(ACTOR, keep.id, drop.id, 'verify')
check('a second merge succeeds', again.ok, again.error)
check('the handle is released again', (await idOf(drop.id)).cueverseId == null)

const undone2 = await undoMerge(ACTOR, again.mergeId!, 'verify')
check('the undo succeeds', undone2.ok, undone2.error)
check('...with no warning, because nothing was in the way', !undone2.warning, undone2.warning)
check('the handle is back on the restored profile', (await idOf(drop.id)).cueverseId === `${TAG}_drop`)
check('...and the alias the merge added is gone again',
  !(await aliases(keep.id)).some((a) => a.alias === `${TAG}_drop`.replace(/[^a-z0-9]/g, '')))

section("An alias the survivor already had is left alone")
await prisma.playerAlias.create({
  data: { playerId: keep.id, alias: `${TAG}_drop`, aliasType: 'HANDLE' },
})
const third = await mergeAccounts(ACTOR, keep.id, drop.id, 'verify')
check('the merge succeeds with the alias already present', third.ok, third.error)
await undoMerge(ACTOR, third.mergeId!, 'verify')
check('the pre-existing alias survives the undo',
  (await aliases(keep.id)).some((a) => a.alias.toLowerCase() === `${TAG}_drop`))

section('An email-shaped handle is released but never made public')
{
  /*
   * Some archive-era profiles were registered under an email address. Releasing that handle is
   * right; copying it into an alias is not — aliases are public, and the Rankings CSV asserts that
   * nothing it exports contains an "@". Moving an address from one public column to another would
   * be a privacy regression wearing a bug fix's clothes.
   */
  const survivor = await mk('Survivor', `${TAG}_survivor`)
  const addr = `${TAG}.person@example.invalid`
  const emailed = await prisma.player.create({
    data: {
      primaryName: `${TAG} Emailed`, cueverseId: addr,
      cueverseIdNormalized: addr, active: true,
    },
    select: { id: true },
  })
  const r = await mergeAccounts(ACTOR, survivor.id, emailed.id, 'verify')
  check('the merge succeeds', r.ok, r.error)
  check('the address is released from the retired profile', (await idOf(emailed.id)).cueverseId == null)
  check('...and is NOT copied into a public alias',
    !(await aliases(survivor.id)).some((a) => a.includes('@')),
    (await aliases(survivor.id)).join(', '))
  check('no alias anywhere contains an address',
    (await prisma.playerAlias.count({ where: { alias: { contains: '@' } } })) === 0)

  const u = await undoMerge(ACTOR, r.mergeId!, 'verify')
  check('undo still restores it to the profile that owns it',
    u.ok && (await idOf(emailed.id)).cueverseId === addr, u.error)
}

await cleanup()
console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
await prisma.$disconnect()
if (fail > 0) process.exitCode = 1
