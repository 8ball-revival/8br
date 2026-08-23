/**
 * Merge the three handles the owner confirmed are one person.
 *
 * `bigblue2k`, `HaVoK_73` and `sixohtwo` are the same player. The archived brackets seat sixohtwo in
 * Seasons whose manifest lists bigblue2k, which is what the same swap appearing in 2008 S5A, 2010 S3A
 * and 2010 S4A was telling us: not three substitutions, one person under more than one handle.
 *
 * ── Why this is not the placeholder merge ────────────────────────────────────────────────────────
 * The seven earlier merges each had a placeholder side holding no competition history, and the script
 * that applied them refuses when the secondary holds entrants — a guard against merging a real record
 * into a stub by mistake. Here both sides hold real reconstructed history, so that guard would refuse
 * a merge that is nonetheless correct. It is replaced by the check that actually matters for a
 * two-sided merge: the two must not both be entered in the same Season, or the merge would put one
 * person in a Season twice. They share none.
 *
 * `sixohtwo` is the primary: it pre-dates this reconstruction, carries a rating-ledger row and the
 * person's real Preferred Name, and already holds an alias of its own.
 *
 * Usage: tsx scripts/archive-merge-havok.mts [--dry-run|--apply]
 */
import { prisma } from '../src/lib/prisma.ts'
import { assertLocalDatabase } from '../src/lib/db-guard.ts'
import { mergeAccounts, checkMergeAllowed, resolveCanonicalPlayerId } from '../src/lib/players/merge.ts'

assertLocalDatabase()

const APPLY = process.argv.includes('--apply')
const ACTOR = { userId: 2, username: 'archive-import-merge' }

const PRIMARY = 'sixohtwo'
const SECONDARIES = ['bigblue2k', 'havok_73']

const find = (handle: string) => prisma.player.findFirst({
  where: { cueverseIdNormalized: handle.toLowerCase() },
  select: { id: true, cueverseId: true, primaryName: true, linkedUserId: true },
})

const primary = await find(PRIMARY)
if (!primary) throw new Error(`${PRIMARY} does not exist`)

const seasonsOf = async (playerId: string) =>
  new Set((await prisma.seasonEntrant.findMany({ where: { playerId }, select: { seasonId: true } })).map((e) => e.seasonId))

for (const handle of SECONDARIES) {
  const secondary = await find(handle)
  if (!secondary) {
    // Already merged: the handle survives as an alias on the primary rather than as its own Player.
    const alias = await prisma.playerAlias.count({
      where: { playerId: primary.id, alias: { equals: handle, mode: 'insensitive' } },
    })
    console.log(`ALREADY_MERGED ${handle} → ${PRIMARY}${alias > 0 ? ' (alias preserved)' : ''}`)
    continue
  }

  const [sa, sb] = [await seasonsOf(secondary.id), await seasonsOf(primary.id)]
  const shared = [...sa].filter((s) => sb.has(s))
  if (shared.length > 0) {
    console.log(`REFUSED ${handle} → ${PRIMARY}: both are entered in Season(s) ${shared.join(', ')}`)
    continue
  }

  const allowed = await checkMergeAllowed(primary.id, secondary.id)
  if (!allowed.ok) { console.log(`REFUSED ${handle} → ${PRIMARY}: ${allowed.error}`); continue }

  console.log(`${handle} (${sa.size} Season(s)) → ${PRIMARY} (${sb.size} Season(s)) — no Season in common`)
  if (!APPLY) { console.log('  would merge'); continue }

  const r = await mergeAccounts(ACTOR, primary.id, secondary.id,
    `owner-confirmed the same person as ${PRIMARY}; the archived brackets seat ${PRIMARY} where the manifest lists ${handle}`)
  if (!r.ok) { console.log(`  FAILED: ${r.error}`); continue }

  const canonical = await resolveCanonicalPlayerId(secondary.id)
  const alias = await prisma.playerAlias.count({
    where: { playerId: primary.id, alias: { equals: handle, mode: 'insensitive' } },
  })
  console.log(`  MERGED canonical=${canonical} aliasPreserved=${alias > 0 ? 'yes' : 'check'}`)
}

const after = await find(PRIMARY)
const entrants = after ? await prisma.seasonEntrant.count({ where: { playerId: after.id } }) : 0
const aliases = after ? await prisma.playerAlias.findMany({ where: { playerId: after.id }, select: { alias: true } }) : []
console.log(`\n${PRIMARY}: ${entrants} entrant row(s); aliases [${aliases.map((a) => a.alias).join(', ')}]`)

await prisma.$disconnect()
