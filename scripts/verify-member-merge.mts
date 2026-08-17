/**
 * Verification for reversible account merging and safe deletion.
 *
 * Creates its own throwaway Players (prefix `zzmerge_`) and removes every one of them at the end,
 * so it never touches real accounts. Deletion decisions are asserted through the ASSESSMENT
 * function rather than by actually deleting a real member.
 *
 * Run:  npx tsx --tsconfig scripts/tsconfig.verify.json scripts/verify-member-merge.mts
 */
import { prisma } from '../src/lib/prisma.ts'
import {
  checkMergeAllowed,
  mergeAccounts,
  undoMerge,
  resolveCanonicalPlayerId,
  resolveCanonicalPlayerIds,
  expandCanonicalPlayerIds,
  mergedSecondaryPlayerIds,
  listMergedAccounts,
  primaryOfMergedPlayer,
  searchMergeCandidates,
} from '../src/lib/players/merge.ts'
import { assessAccountDeletion } from '../src/lib/players/deletion-safety.ts'

let pass = 0, fail = 0
const check = (n: string, ok: boolean, d = '') => {
  if (ok) { pass++; console.log('  ✓ ' + n) } else { fail++; console.log('  ✗ ' + n + (d ? ` — ${d}` : '')) }
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const actor: any = { userId: 1, username: 'zzmerge-verify', roles: ['owner'] }

const made: string[] = []
async function mkPlayer(tag: string) {
  const p = await prisma.player.create({
    data: { primaryName: `zzmerge_${tag}`, cueverseId: `zzmerge_${tag}`, active: true },
    select: { id: true, active: true },
  })
  made.push(p.id)
  return p
}

async function main() {
  console.log('--- Setup ---')
  const primary = await mkPlayer('primary')
  const secondary = await mkPlayer('secondary')
  const third = await mkPlayer('third')
  check('created three throwaway players', made.length === 3)

  console.log('\n--- Guard rules ---')
  check('self-merge rejected', !(await checkMergeAllowed(primary.id, primary.id)).ok)
  check('missing secondary rejected', !(await checkMergeAllowed(primary.id, 'does-not-exist')).ok)
  check('valid pair allowed', (await checkMergeAllowed(primary.id, secondary.id)).ok)

  console.log('\n--- Merge ---')
  const merged = await mergeAccounts(actor, primary.id, secondary.id)
  check('merge succeeds', merged.ok === true, merged.error)
  const mergeId = merged.mergeId!

  const secAfter = await prisma.player.findUnique({ where: { id: secondary.id }, select: { active: true } })
  check('secondary Player set inactive', secAfter?.active === false)
  check('primary untouched (identity preserved)',
    (await prisma.player.findUnique({ where: { id: primary.id }, select: { active: true, cueverseId: true } }))?.active === true)

  const rec = await prisma.playerMerge.findUnique({ where: { id: mergeId } })
  check('merge record stored with APPROVED status', rec?.status === 'APPROVED')
  check('merge record snapshots pre-merge state', Boolean(rec?.note && JSON.parse(rec.note).secondaryWasActive === true))
  check('secondary row still exists (nothing destroyed)',
    (await prisma.player.count({ where: { id: secondary.id } })) === 1)

  console.log('\n--- Canonical resolution ---')
  check('secondary resolves to primary', (await resolveCanonicalPlayerId(secondary.id)) === primary.id)
  check('primary resolves to itself', (await resolveCanonicalPlayerId(primary.id)) === primary.id)
  check('unmerged player resolves to itself', (await resolveCanonicalPlayerId(third.id)) === third.id)
  const bulk = await resolveCanonicalPlayerIds([secondary.id, third.id])
  check('bulk resolve maps secondary → primary', bulk.get(secondary.id) === primary.id)
  check('bulk resolve leaves unmerged alone', bulk.get(third.id) === third.id)
  const expanded = await expandCanonicalPlayerIds(primary.id)
  check('aggregation expands to both ids', expanded.includes(primary.id) && expanded.includes(secondary.id), expanded.join(','))

  console.log('\n--- Hiding / redirect / listing ---')
  check('secondary appears in the hidden list', (await mergedSecondaryPlayerIds()).includes(secondary.id))
  check('primary is NOT hidden', !(await mergedSecondaryPlayerIds()).includes(primary.id))
  const prim = await primaryOfMergedPlayer(secondary.id)
  check('secondary profile redirects to primary', prim?.playerId === primary.id)
  check('primary profile has no redirect', (await primaryOfMergedPlayer(primary.id)) === null)
  const listed = await listMergedAccounts(primary.id)
  check('merged-accounts section lists the secondary', listed.length === 1 && listed[0].playerId === secondary.id)
  const candidates = await searchMergeCandidates(primary.id, 'zzmerge_')
  check('search excludes the primary itself', !candidates.some((c) => c.playerId === primary.id))
  check('search excludes already-merged accounts', !candidates.some((c) => c.playerId === secondary.id))
  check('search still offers unmerged accounts', candidates.some((c) => c.playerId === third.id))

  console.log('\n--- Chain / cycle / duplicate prevention ---')
  check('duplicate merge rejected', !(await checkMergeAllowed(primary.id, secondary.id)).ok)
  check('merging an already-merged account elsewhere rejected', !(await checkMergeAllowed(third.id, secondary.id)).ok)
  check('chain rejected: primary-with-secondaries as a secondary', !(await checkMergeAllowed(third.id, primary.id)).ok)
  check('chain rejected: merged secondary as a primary', !(await checkMergeAllowed(secondary.id, third.id)).ok)

  console.log('\n--- Multiple secondaries under one primary ---')
  const second2 = await mkPlayer('secondary2')
  const m2 = await mergeAccounts(actor, primary.id, second2.id)
  check('a second account merges into the same primary', m2.ok === true, m2.error)
  check('both secondaries roll up', (await expandCanonicalPlayerIds(primary.id)).length === 3)
  check('merged-accounts section shows both', (await listMergedAccounts(primary.id)).length === 2)
  const u2 = await undoMerge(actor, m2.mergeId!)
  check('second merge undone', u2.ok === true, u2.error)

  console.log('\n--- Undo ---')
  const undone = await undoMerge(actor, mergeId)
  check('undo succeeds', undone.ok === true, undone.error)
  check('secondary reactivated exactly',
    (await prisma.player.findUnique({ where: { id: secondary.id }, select: { active: true } }))?.active === true)
  check('merge record removed', (await prisma.playerMerge.count({ where: { id: mergeId } })) === 0)
  check('secondary resolves to itself again', (await resolveCanonicalPlayerId(secondary.id)) === secondary.id)
  check('secondary no longer hidden', !(await mergedSecondaryPlayerIds()).includes(secondary.id))
  check('history independent again', (await expandCanonicalPlayerIds(primary.id)).length === 1)
  check('re-merge allowed after undo', (await checkMergeAllowed(primary.id, secondary.id)).ok)

  console.log('\n--- Undo restores a pre-existing inactive state ---')
  await prisma.player.update({ where: { id: third.id }, data: { active: false } })
  const m3 = await mergeAccounts(actor, primary.id, third.id)
  check('merging an already-inactive account works', m3.ok === true, m3.error)
  await undoMerge(actor, m3.mergeId!)
  check('undo restores inactive (does not blindly reactivate)',
    (await prisma.player.findUnique({ where: { id: third.id }, select: { active: true } }))?.active === false)
  await prisma.player.update({ where: { id: third.id }, data: { active: true } })

  console.log('\n--- Deletion safety (FKs + soft references) ---')
  const clean = await assessAccountDeletion(999999, third.id, 'zz-nonexistent-user')
  check('an account with nothing attached is permanently deletable', clean.canPermanentlyDelete === true, JSON.stringify(clean.dependencies))
  check('outcome reads "permanent"', clean.outcome === 'permanent')

  // Soft reference with NO foreign key — the case Postgres would not catch.
  await prisma.ratingLedger.create({
    data: {
      matchKey: 'zzmerge-test-match', stage: 'GROUP',
      playerId: third.id, playerName: 'zzmerge_third', opponentName: 'zzmerge_opponent',
      result: 'WIN', actual: 1, expected: 0.5,
      preRating: 1500, ratingChange: 0, postRating: 1500,
      sequence: 999999, completedAt: new Date(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
  }).catch(() => null)
  const withLedger = await assessAccountDeletion(999999, third.id, 'zz-nonexistent-user')
  if (withLedger.totalDependencies > 0) {
    check('a rating-ledger row blocks permanent deletion', withLedger.canPermanentlyDelete === false)
    check('outcome switches to "archive"', withLedger.outcome === 'archive')
    check('the blocking dependency is named', withLedger.dependencies.some((d) => /ledger/i.test(d.label)))
  } else {
    check('rating-ledger soft reference detected', false, 'ledger row could not be created for the test')
  }
  await prisma.ratingLedger.deleteMany({ where: { playerId: third.id, sequence: 999999 } })

  // An alias is a real FK dependent.
  await prisma.playerAlias.create({ data: { playerId: third.id, alias: 'zzmerge_alias' } }).catch(() => null)
  const withAlias = await assessAccountDeletion(999999, third.id, 'zz-nonexistent-user')
  check('a foreign-key dependent also forces archival', withAlias.canPermanentlyDelete === false)
  await prisma.playerAlias.deleteMany({ where: { playerId: third.id } })

  console.log('\n--- Canonical aggregation in the public profile ---')
  const { getPlayerProfile } = await import('../src/lib/stats/ladder.ts')
  const p4 = await mkPlayer('agg_primary')
  const s4 = await mkPlayer('agg_secondary')
  await prisma.ratingLedger.create({
    data: {
      matchKey: 'zzmerge-agg-1', stage: 'GROUP', playerId: s4.id, playerName: 'zzmerge_agg_secondary',
      opponentName: 'x', result: 'WIN', actual: 1, expected: 0.5,
      preRating: 1500, ratingChange: 10, postRating: 1510, sequence: 999998, completedAt: new Date(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
  }).catch(() => null)

  const beforeCount = (await getPlayerProfile(p4.id))?.matches?.length ?? 0
  const m4 = await mergeAccounts(actor, p4.id, s4.id)
  check('aggregation fixture merged', m4.ok === true, m4.error)
  const afterCount = (await getPlayerProfile(p4.id))?.matches?.length ?? 0
  check("primary profile absorbs the secondary's results", afterCount > beforeCount, beforeCount + ' -> ' + afterCount)
  check('secondary profile redirects to the primary', (await primaryOfMergedPlayer(s4.id))?.playerId === p4.id)
  await undoMerge(actor, m4.mergeId!)
  check('undo returns the results to the secondary', ((await getPlayerProfile(p4.id))?.matches?.length ?? 0) === beforeCount)

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
}

main()
  .catch((e) => { console.error(e); fail++ })
  .finally(async () => {
    // Remove every artefact this run created, in dependency order.
    await prisma.playerMerge.deleteMany({ where: { OR: [{ canonicalPlayerId: { in: made } }, { mergedPlayerId: { in: made } }] } }).catch(() => {})
    await prisma.ratingLedger.deleteMany({ where: { playerId: { in: made } } }).catch(() => {})
    await prisma.playerAlias.deleteMany({ where: { playerId: { in: made } } }).catch(() => {})
    await prisma.player.deleteMany({ where: { id: { in: made } } }).catch(() => {})
    await prisma.$disconnect()
    process.exit(fail === 0 ? 0 : 1)
  })
