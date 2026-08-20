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
import { deleteFixtureAuditRows } from '../src/lib/verification/fixture-actors.ts'
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

/** A Payload user id no real account uses, so the login/soft-reference checks touch nobody. */
const FAKE_USER = 987654
const SOFT_USERNAME = 'zzmerge-soft-ref'

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
  // A merge that moves no entrants leaves the derived ledger alone, so a row written straight into
  // the table — as this fixture does — is still there afterwards. Merges that DO move competition
  // records rebuild it instead, which is covered end-to-end in verify-merge-moves-records.mts.
  check('a merge that moved nothing leaves the ledger untouched',
    (await prisma.ratingLedger.count({ where: { playerId: s4.id } })) === 1)
  check('secondary profile redirects to the primary', (await primaryOfMergedPlayer(s4.id))?.playerId === p4.id)
  await undoMerge(actor, m4.mergeId!)
  check('undo returns the results to the secondary', ((await getPlayerProfile(p4.id))?.matches?.length ?? 0) === beforeCount)

  console.log('\n--- Login disabled on merge, restored on undo ---')
  // The regression that matters: disabling the login goes through the moderation soft-delete, which
  // also UNLINKS the profile — so undo cannot read the account id back off the Player and has to
  // take it from the merge snapshot. Without that, a merged account could never log in again.
  const lp = await mkPlayer('login_primary')
  const ls = await prisma.player.create({
    data: {
      primaryName: 'zzmerge_login_secondary', cueverseId: 'zzmerge_login_secondary', active: true,
      linkedUserId: String(FAKE_USER), linkStatus: 'VERIFIED', linkedAt: new Date(),
    },
    select: { id: true },
  })
  made.push(ls.id)
  const lm = await mergeAccounts(actor, lp.id, ls.id)
  check('merge with a linked account succeeds', lm.ok === true, lm.error)
  const loginMergedState = await prisma.player.findUnique({ where: { id: ls.id }, select: { active: true, linkedUserId: true } })
  const modMerged = await prisma.memberModeration.findUnique({ where: { userId: FAKE_USER }, select: { status: true } })
  check('merge disables the secondary login', modMerged?.status === 'DELETED', modMerged?.status ?? 'none')
  check('merge deactivates the secondary Player', loginMergedState?.active === false)
  check('the merge snapshot remembers the unlinked account id', await snapshotHasUserId(lm.mergeId!))

  const undone2 = await undoMerge(actor, lm.mergeId!)
  check('undo succeeds', undone2.ok === true, undone2.error)
  const restored = await prisma.player.findUnique({ where: { id: ls.id }, select: { active: true, linkedUserId: true, linkStatus: true } })
  const modRestored = await prisma.memberModeration.findUnique({ where: { userId: FAKE_USER }, select: { status: true } })
  check('undo restores the login', modRestored?.status === 'ACTIVE', modRestored?.status ?? 'none')
  check('undo re-links the profile to its account', restored?.linkedUserId === String(FAKE_USER), restored?.linkedUserId ?? 'null')
  check('undo restores the link status', restored?.linkStatus === 'VERIFIED', restored?.linkStatus ?? 'null')
  check('undo reactivates the Player', restored?.active === true)

  console.log('\n--- Undo when the account was claimed by another profile ---')
  const lm2 = await mergeAccounts(actor, lp.id, ls.id)
  check('re-merge succeeds', lm2.ok === true, lm2.error)
  // Someone else takes the freed account while the merge is in place.
  const squatter = await prisma.player.create({
    data: { primaryName: 'zzmerge_squatter', cueverseId: 'zzmerge_squatter', active: true, linkedUserId: String(FAKE_USER), linkStatus: 'VERIFIED' },
    select: { id: true },
  })
  made.push(squatter.id)
  const undone3 = await undoMerge(actor, lm2.mergeId!)
  check('undo still succeeds', undone3.ok === true, undone3.error)
  check('undo warns that the login could not be restored', Boolean(undone3.warning), undone3.warning ?? 'no warning')
  check('undo still reactivates the Player',
    (await prisma.player.findUnique({ where: { id: ls.id }, select: { active: true } }))?.active === true)
  await prisma.player.delete({ where: { id: squatter.id } }).catch(() => {})

  console.log('\n--- Undo of a merge recorded before the snapshot carried the account id ---')
  const gp = await mkPlayer('legacy_primary')
  const gs = await prisma.player.create({
    data: {
      primaryName: 'zzmerge_legacy_secondary', cueverseId: 'zzmerge_legacy_secondary', active: true,
      linkedUserId: String(FAKE_USER), linkStatus: 'VERIFIED', linkedAt: new Date(),
    },
    select: { id: true },
  })
  made.push(gs.id)
  const gm = await mergeAccounts(actor, gp.id, gs.id)
  check('legacy fixture merged', gm.ok === true, gm.error)
  // Rewrite the note to the OLD shape, which had no account id — the audit trail is then the only
  // place it survives.
  await prisma.playerMerge.update({
    where: { id: gm.mergeId! },
    data: { note: JSON.stringify({ secondaryWasActive: true, secondaryWasBlocked: false, mergedAt: new Date().toISOString() }) },
  })
  check('the snapshot no longer carries the account id', !(await snapshotHasUserId(gm.mergeId!)))
  const gu = await undoMerge(actor, gm.mergeId!)
  check('undo succeeds without a snapshot id', gu.ok === true, gu.error)
  const gRestored = await prisma.player.findUnique({ where: { id: gs.id }, select: { linkedUserId: true } })
  const gMod = await prisma.memberModeration.findUnique({ where: { userId: FAKE_USER }, select: { status: true } })
  check('the account id is recovered from the audit trail', gRestored?.linkedUserId === String(FAKE_USER), gRestored?.linkedUserId ?? 'null')
  check('the login is restored for a legacy merge', gMod?.status === 'ACTIVE', gMod?.status ?? 'none')

  console.log('\n--- Rankings roll up, they do not double-count ---')
  const { getLadder } = await import('../src/lib/stats/ladder.ts')
  const rp = await mkPlayer('rank_primary')
  const rs = await mkPlayer('rank_secondary')
  const seq = 999900
  for (const [i, pid] of [rp.id, rs.id].entries()) {
    await prisma.ratingLedger.create({
      data: {
        matchKey: `zzmerge-rank-${i}`, stage: 'GROUP', playerId: pid,
        playerName: i === 0 ? 'zzmerge_rank_primary' : 'zzmerge_rank_secondary',
        opponentName: 'y', result: 'WIN', actual: 1, expected: 0.5,
        preRating: 1500, ratingChange: 8, postRating: 1508, sequence: seq + i, completedAt: new Date(),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
    }).catch(() => null)
  }
  const before = await getLadder('all-time')
  check('both accounts are ranked separately before the merge',
    before.some((r) => r.playerId === rp.id) && before.some((r) => r.playerId === rs.id))
  const rm = await mergeAccounts(actor, rp.id, rs.id)
  check('ranking fixture merged', rm.ok === true, rm.error)
  const after = await getLadder('all-time')
  const primaryRow = after.find((r) => r.playerId === rp.id)
  check('the secondary no longer holds its own ranking row', !after.some((r) => r.playerId === rs.id))
  check("the primary's row absorbs the secondary's results", (primaryRow?.wins ?? 0) >= 2, `wins=${primaryRow?.wins}`)
  await undoMerge(actor, rm.mergeId!)
  check('undo restores both ranking rows',
    (await getLadder('all-time')).some((r) => r.playerId === rs.id))

  console.log('\n--- Season titles roll up to the primary ---')
  const tp = await mkPlayer('title_primary')
  const ts = await mkPlayer('title_secondary')
  const series = await prisma.competitionSeries.findFirst({ where: { active: true }, select: { id: true } })
  let titleSeasonId: number | null = null
  if (series) {
    const last = await prisma.season.findFirst({ orderBy: { number: 'desc' }, select: { number: true } })
    const n = (last?.number ?? 0) + 1
    const s = await prisma.season.create({
      data: {
        number: n, competitionYear: 2026, competitionSeriesId: series.id, slug: `zzmerge-title-${n}`,
        lifecycleState: 'COMPLETED', completedAt: new Date(), championPlayerId: ts.id, championName: 'zzmerge_title_secondary',
      },
      select: { id: true },
    })
    titleSeasonId = s.id
    await prisma.ratingLedger.create({
      data: {
        matchKey: 'zzmerge-title-1', stage: 'GROUP', playerId: tp.id, playerName: 'zzmerge_title_primary',
        opponentName: 'z', result: 'WIN', actual: 1, expected: 0.5,
        preRating: 1500, ratingChange: 5, postRating: 1505, sequence: 999890, completedAt: new Date(),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
    }).catch(() => null)
    const tm = await mergeAccounts(actor, tp.id, ts.id)
    check('title fixture merged', tm.ok === true, tm.error)
    const row = (await getLadder('all-time')).find((r) => r.playerId === tp.id)
    check("the primary inherits the secondary's Season Championship",
      (row?.seasonTitles?.length ?? 0) >= 1, `titles=${row?.seasonTitles?.length ?? 0}`)
    await undoMerge(actor, tm.mergeId!)
  } else {
    check('a Competition exists to attach a test Season to', false, 'no active Competition')
  }
  if (titleSeasonId) await prisma.season.delete({ where: { id: titleSeasonId } }).catch(() => {})

  console.log('\n--- Merged secondaries are hidden from selectors ---')
  const hp = await mkPlayer('hide_primary')
  const hs = await mkPlayer('hide_secondary')
  const hm = await mergeAccounts(actor, hp.id, hs.id)
  check('hide fixture merged', hm.ok === true, hm.error)
  const activeIds = (await prisma.player.findMany({ where: { active: true, id: { in: [hp.id, hs.id] } }, select: { id: true } })).map((r) => r.id)
  check('an "active players" query excludes the merged secondary',
    activeIds.includes(hp.id) && !activeIds.includes(hs.id), activeIds.join(','))
  check('the secondary is listed as hidden', (await mergedSecondaryPlayerIds()).includes(hs.id))
  await undoMerge(actor, hm.mergeId!)
  check('undo returns the secondary to active queries',
    (await prisma.player.count({ where: { active: true, id: hs.id } })) === 1)

  console.log('\n--- Permissions: staff accounts cannot be absorbed ---')
  // Must be a staff account that still HAS a linked profile — an archived one is unlinked, and the
  // guard reads roles off the profile's account.
  const staffRows = await prisma.$queryRaw<{ id: number }[]>`
    SELECT DISTINCT u.id FROM payload.users u
    JOIN payload.users_roles r ON r.parent_id = u.id
    WHERE r.value IN ('owner','admin') ORDER BY u.id ASC`
  let staffProfileId: string | null = null
  for (const row of staffRows) {
    const p = await prisma.player.findFirst({ where: { linkedUserId: String(row.id) }, select: { id: true } })
    if (p) { staffProfileId = p.id; break }
  }
  if (staffProfileId) {
    const res = await checkMergeAllowed(hp.id, staffProfileId)
    check('an OWNER/ADMIN account is refused as a secondary', !res.ok, 'it was allowed')
    const reverse = await checkMergeAllowed(staffProfileId, hp.id)
    check('a staff account may still act as the PRIMARY', reverse.ok, reverse.ok ? '' : (reverse as { error: string }).error)
  } else {
    check('a staff account with a linked profile exists to test against', false, 'none found')
  }

  console.log('\n--- Soft references block a hard delete (no FK to catch them) ---')
  const softChecks: Array<[string, () => Promise<void>, () => Promise<void>]> = [
    [
      'an audit-log entry',
      async () => { await prisma.auditLog.create({ data: { actorUserId: FAKE_USER, actorUsername: SOFT_USERNAME, action: 'zzmerge.test', entity: 'User' } }) },
      async () => { await prisma.auditLog.deleteMany({ where: { actorUsername: SOFT_USERNAME } }) },
    ],
    [
      'a staff designation',
      async () => { await prisma.staffDesignation.create({ data: { userId: FAKE_USER } }) },
      async () => { await prisma.staffDesignation.deleteMany({ where: { userId: FAKE_USER } }) },
    ],
  ]
  for (const [label, create, cleanup] of softChecks) {
    await create().catch(() => null)
    const a = await assessAccountDeletion(FAKE_USER, null, SOFT_USERNAME)
    check(`${label} forces archival instead of deletion`, a.canPermanentlyDelete === false && a.outcome === 'archive',
      JSON.stringify(a.dependencies))
    await cleanup().catch(() => null)
  }

  // A registration references a member by username only — the case Postgres cannot protect.
  const tourn = await prisma.tournament.create({
    data: { slug: `zzmerge-t-${Date.now()}`, name: 'zzmerge test', competitionYear: 2026 },
    select: { id: true },
  }).catch(() => null)
  if (tourn) {
    await prisma.registration.create({ data: { tournamentId: tourn.id, username: SOFT_USERNAME } }).catch(() => null)
    const a = await assessAccountDeletion(FAKE_USER, null, SOFT_USERNAME)
    check('a competition registration forces archival', a.canPermanentlyDelete === false, JSON.stringify(a.dependencies))
    check('the blocking registration is named', a.dependencies.some((d) => /registration/i.test(d.label)))
    await prisma.tournament.delete({ where: { id: tourn.id } }).catch(() => {})
  } else {
    check('a tournament could be created to test registrations', false, 'create failed')
  }
  const clean2 = await assessAccountDeletion(FAKE_USER, null, SOFT_USERNAME)
  check('with every soft reference gone the account is deletable', clean2.canPermanentlyDelete === true,
    JSON.stringify(clean2.dependencies))

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
}

/** True when the merge record kept the account id that the soft-delete unlinked. */
async function snapshotHasUserId(mergeId: string): Promise<boolean> {
  const row = await prisma.playerMerge.findUnique({ where: { id: mergeId }, select: { note: true } })
  if (!row?.note) return false
  try {
    return typeof (JSON.parse(row.note) as { secondaryUserId?: number }).secondaryUserId === 'number'
  } catch {
    return false
  }
}

main()
  .catch((e) => { console.error(e); fail++ })
  .finally(async () => {
    // Remove every artefact this run created, in dependency order.
    await prisma.playerMerge.deleteMany({ where: { OR: [{ canonicalPlayerId: { in: made } }, { mergedPlayerId: { in: made } }] } }).catch(() => {})
    await prisma.ratingLedger.deleteMany({ where: { playerId: { in: made } } }).catch(() => {})
    await prisma.playerAlias.deleteMany({ where: { playerId: { in: made } } }).catch(() => {})
    await prisma.player.deleteMany({ where: { id: { in: made } } }).catch(() => {})
    // Fixtures that key off the synthetic account rather than a Player row.
    await prisma.memberModeration.deleteMany({ where: { userId: FAKE_USER } }).catch(() => {})
    await prisma.staffDesignation.deleteMany({ where: { userId: FAKE_USER } }).catch(() => {})
    await prisma.auditLog.deleteMany({ where: { actorUsername: SOFT_USERNAME } }).catch(() => {})
    await prisma.auditLog.deleteMany({ where: { actorUserId: FAKE_USER } }).catch(() => {})
    await prisma.season.deleteMany({ where: { slug: { startsWith: 'zzmerge-title-' } } }).catch(() => {})
    await prisma.tournament.deleteMany({ where: { slug: { startsWith: 'zzmerge-t-' } } }).catch(() => {})
    // Deleting a Tournament directly leaves the derived snapshot cache listing one that no longer
    // exists. The app's own delete action rebuilds it; a test that bypasses that action must too, or it
    // leaves a phantom tournament behind for whatever runs next.
    {
      const { regenerateTournamentSnapshot } = await import('../src/lib/tournaments/migrate.ts')
      await regenerateTournamentSnapshot().catch(() => {})
    }
    // The suite's own audit trail goes with its records: a log describing fixtures that no
    // longer exist is not a record of anything, and somebody has to adjudicate it later.
    await deleteFixtureAuditRows(prisma, ['zzmerge-verify']).catch(() => {})
    await prisma.$disconnect()
    process.exit(fail === 0 ? 0 : 1)
  })
