/**
 * Apply the owner-confirmed identity merges from the archive import.
 *
 * ── Why these six and no others ──────────────────────────────────────────────────────────────────
 * The import created 18 identities for archive handles that matched no existing Player. Six of them
 * turned out to be the same people as existing accounts — a fact only the owner could supply, which
 * is exactly why the importer created separate identities rather than guessing. The other twelve are
 * genuinely new and are not touched.
 *
 * Direction is not inferred from the string: every secondary here was created by this import and
 * holds zero entrants, while every primary pre-dates it and carries real competition history. The
 * script re-checks that shape before each merge and refuses if it does not hold.
 *
 * ── Nothing is rewritten by hand ─────────────────────────────────────────────────────────────────
 * `mergeAccounts` is the canonical service. It runs its own `checkMergeAllowed`, preserves the
 * secondary's CueVerse ID as a searchable alias, moves the historical records, and records the merge
 * so it can be undone. No Player or account row is edited or deleted here.
 *
 * Usage: tsx scripts/archive-apply-merges.mts [--dry-run|--apply]
 */
import { readFileSync, writeFileSync } from 'node:fs'

import { prisma } from '../src/lib/prisma.ts'
import { assertLocalDatabase } from '../src/lib/db-guard.ts'
import { mergeAccounts, checkMergeAllowed, resolveCanonicalPlayerId } from '../src/lib/players/merge.ts'

assertLocalDatabase()

const APPLY = process.argv.includes('--apply')
const ACTOR = { userId: 2, username: 'archive-import-merge' }

/** secondary (created by this import) → primary (the person's real account). */
const PAIRS: [string, string][] = [
  ['i.am_the_zodiac', 'jabronni16'],
  ['ll_ketan_ll', 'l_ketan_l'],
  ['luisj_barreto', 'real_creampuff'],
  ['mj_the_king', 'pool.instinct'],
  ['x_therage', 't_an_may'],
  ['xxl_machine_lxx', 'xxl_themachine_lxx'],
]

const find = (handle: string) => prisma.player.findFirst({
  where: { cueverseIdNormalized: handle.toLowerCase() },
  select: { id: true, cueverseId: true, primaryName: true, linkedUserId: true },
})

const countsFor = async (playerId: string) => ({
  entrants: await prisma.seasonEntrant.count({ where: { playerId } }),
  aliases: await prisma.playerAlias.count({ where: { playerId } }),
  ledger: await prisma.ratingLedger.count({ where: { playerId } }),
})

const results: { secondary: string; primary: string; status: string; detail: string; primaryPlayerId?: string; primaryUserId?: number | null }[] = []

for (const [secHandle, priHandle] of PAIRS) {
  const sec = await find(secHandle)
  const pri = await find(priHandle)

  /*
   * A missing secondary is the successful end state, not a failure.
   *
   * Once merged, the secondary no longer exists as its own Player — its handle survives as an alias
   * on the primary. Re-running must therefore recognise that and report a no-op, because calling it
   * REFUSED would make a correct, already-finished merge look like a problem every time.
   */
  if (!sec && pri) {
    const alias = await prisma.playerAlias.count({
      where: { playerId: pri.id, alias: { equals: secHandle, mode: 'insensitive' } },
    })
    results.push({
      secondary: secHandle, primary: priHandle, status: 'ALREADY_MERGED',
      detail: alias > 0
        ? `handle resolves to ${priHandle} through its preserved alias`
        : `${secHandle} no longer exists as a Player; no alias found on ${priHandle} — worth checking`,
      primaryPlayerId: pri.id, primaryUserId: pri.linkedUserId ? Number(pri.linkedUserId) : null,
    })
    continue
  }

  if (!sec || !pri) {
    results.push({ secondary: secHandle, primary: priHandle, status: 'REFUSED', detail: `missing side: ${!sec ? secHandle : priHandle}` })
    continue
  }

  const secCounts = await countsFor(sec.id)
  const priCounts = await countsFor(pri.id)

  /*
   * The direction check, made from evidence rather than from the order of the pair.
   *
   * The account this import created holds no competition history; the person's real account does.
   * If that is ever the other way round, the merge is refused rather than silently reversed — moving
   * a real record onto a placeholder is the one outcome that would be hard to notice and hard to undo.
   */
  if (secCounts.entrants > 0) {
    results.push({
      secondary: secHandle, primary: priHandle, status: 'REFUSED',
      detail: `${secHandle} holds ${secCounts.entrants} entrant row(s); it is not the placeholder side`,
    })
    continue
  }

  const allowed = await checkMergeAllowed(pri.id, sec.id)
  if (!allowed.ok) {
    results.push({ secondary: secHandle, primary: priHandle, status: 'REFUSED', detail: allowed.error })
    continue
  }

  console.log(`${secHandle} → ${priHandle}`)
  console.log(`   secondary ${sec.id} entrants=${secCounts.entrants} aliases=${secCounts.aliases} ledger=${secCounts.ledger}`)
  console.log(`   primary   ${pri.id} (${pri.primaryName}) entrants=${priCounts.entrants} aliases=${priCounts.aliases} ledger=${priCounts.ledger}`)

  if (!APPLY) {
    results.push({ secondary: secHandle, primary: priHandle, status: 'WOULD MERGE', detail: 'checks passed' })
    continue
  }

  const r = await mergeAccounts(ACTOR, pri.id, sec.id, `archive import: owner-confirmed same person as ${priHandle}`)
  if (!r.ok) {
    results.push({ secondary: secHandle, primary: priHandle, status: 'FAILED', detail: r.error ?? 'unknown' })
    continue
  }

  const canonical = await resolveCanonicalPlayerId(sec.id)
  const alias = await prisma.playerAlias.count({ where: { playerId: pri.id, alias: { equals: secHandle, mode: 'insensitive' } } })
  results.push({
    secondary: secHandle, primary: priHandle, status: 'MERGED',
    detail: `canonical=${canonical} aliasPreserved=${alias > 0 ? 'yes' : 'check'}`,
    primaryPlayerId: pri.id, primaryUserId: pri.linkedUserId ? Number(pri.linkedUserId) : null,
  })
}

console.log('\n' + results.map((r) => `${r.status.padEnd(11)} ${r.secondary} → ${r.primary}  ${r.detail}`).join('\n'))

const changed = results.filter((r) => r.status === 'MERGED')
if (APPLY && changed.length > 0) {
  // The handle map must point at the canonical Player, or a rerun would resolve to a merged-away id.
  const MAP = 'reports/archive-handle-map.json'
  const map = JSON.parse(readFileSync(MAP, 'utf8')) as Record<string, {
    playerId: string | null; userId: number | null; status: string; reason: string; mergedInto?: string
  }>
  for (const r of changed) {
    const key = r.secondary.toLowerCase()
    if (!map[key]) continue
    map[key].playerId = r.primaryPlayerId ?? map[key].playerId
    map[key].userId = r.primaryUserId ?? map[key].userId
    map[key].status = 'merged'
    map[key].mergedInto = r.primary
    map[key].reason = `owner-confirmed the same person as ${r.primary}; merged through the canonical service, original handle preserved as an alias`
  }
  writeFileSync(MAP, JSON.stringify(map, null, 2))
  console.log('\nhandle map updated to canonical Player/account ids')
}

await prisma.$disconnect()
