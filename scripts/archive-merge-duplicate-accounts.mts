/**
 * Merge the accounts the archive imports minted twice for one person.
 *
 * ── What went wrong ─────────────────────────────────────────────────────────────────────────────
 * `archive-create-players` and `archive-bracket-players` create an account for any recorded handle
 * that does not already resolve. Both check the alias table first -- but only in the spelling the
 * source printed, and aliases are stored with their separators removed. So a handle that WAS already
 * recorded as somebody's alias could still look unclaimed, and a second account was minted holding
 * that handle as its own CueVerse ID.
 *
 * The result is two accounts for one person: the original, entered and playing, carrying the handle
 * as an alias; and a duplicate that owns the handle outright and has never played. It is invisible
 * on the site, because nothing links to an account with no records -- and corrosive underneath,
 * because `resolveCanonical` prefers a CueVerse ID over an alias, so every future mention of that
 * handle resolves to the empty duplicate rather than to the person. That is what left recorded
 * participants looking unseated across most of Division A.
 *
 * ── What this does ──────────────────────────────────────────────────────────────────────────────
 * Pairs are found structurally, not by guesswork: account A's CueVerse ID and account B's alias are
 * the same string once separators are removed. That is the archive asserting they are one person --
 * the alias exists because somebody, or some earlier import, already recorded it as theirs.
 *
 * The account that PLAYED survives. The empty one is merged into it through the canonical service,
 * which carries the aliases across and leaves the merge reversible. A pair where BOTH have played is
 * refused outright and reported: that is two people, or a question, and not something a script may
 * decide.
 *
 * Usage: tsx scripts/archive-merge-duplicate-accounts.mts --dry-run | --apply
 */
import { mkdirSync, writeFileSync } from 'node:fs'

import { prisma } from '../src/lib/prisma.ts'
import { assertLocalDatabase } from '../src/lib/db-guard.ts'
import { checkMergeAllowed, mergeAccounts } from '../src/lib/players/merge.ts'
import { resetCanonicalCache } from '../src/lib/archive/canonical-identity.ts'

assertLocalDatabase()

const APPLY = process.argv.includes('--apply')
if (!APPLY && !process.argv.includes('--dry-run')) throw new Error('pass --dry-run or --apply')

const ACTOR = { userId: 2, username: 'archive-dedupe' }

/** How much competitive record an account carries. An empty one can be merged away safely. */
async function participation(playerId: string): Promise<number> {
  const [entrants, ledger, champions] = await Promise.all([
    prisma.seasonEntrant.count({ where: { playerId } }),
    prisma.ratingLedger.count({ where: { playerId } }),
    prisma.season.count({ where: { championPlayerId: playerId } }),
  ])
  return entrants + ledger + champions
}

const pairs = await prisma.$queryRawUnsafe<Array<{ ownerId: string; ownerHandle: string; aliasHolderId: string; alias: string }>>(`
  with stripped as (
    select id, "cueverseId" handle, regexp_replace(lower("cueverseIdNormalized"), '[^a-z0-9]', '', 'g') k
    from "Player" where "cueverseIdNormalized" is not null
  ), al as (
    select "playerId", alias, regexp_replace(lower(alias), '[^a-z0-9]', '', 'g') k from "PlayerAlias"
  )
  select s.id "ownerId", s.handle "ownerHandle", a."playerId" "aliasHolderId", a.alias
  from stripped s join al a on a.k = s.k and a."playerId" <> s.id`)

interface Outcome { handle: string; primary: string; secondary: string; action: string; detail?: string }
const outcomes: Outcome[] = []
const seen = new Set<string>()

console.log(`${pairs.length} duplicate handle pair(s)${APPLY ? '' : ' — DRY RUN'}`)

for (const p of pairs) {
  const key = [p.ownerId, p.aliasHolderId].sort().join('|')
  if (seen.has(key)) continue
  seen.add(key)

  // Both sides may already be gone, or already merged, on a rerun.
  const [owner, holder] = await Promise.all([
    prisma.player.findUnique({ where: { id: p.ownerId }, select: { id: true, cueverseId: true } }),
    prisma.player.findUnique({ where: { id: p.aliasHolderId }, select: { id: true, cueverseId: true } }),
  ])
  if (!owner || !holder) {
    outcomes.push({ handle: p.ownerHandle, primary: p.aliasHolderId, secondary: p.ownerId, action: 'already-merged' })
    continue
  }

  const [ownerPlay, holderPlay] = await Promise.all([participation(owner.id), participation(holder.id)])

  /*
   * Both sides having a record does not by itself mean two people.
   *
   * It is far more often one person whose history the imports split: entered under the old spelling
   * one Season, the new one the next. What separates the two cases is evidence, not volume --
   * a person cannot have played THEMSELVES, and cannot have held two playing entries in one Season.
   * Those are the questions asked below; everything else is an ordinary duplicate to resolve.
   */
  const playedEachOther = Number((await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(`
    select count(*) n from season_match m
    join season_entrant h on h.id = m."homeEntrantId"
    join season_entrant a on a.id = m."awayEntrantId"
    where (h."playerId" = $1 and a."playerId" = $2) or (h."playerId" = $2 and a."playerId" = $1)`,
    owner.id, holder.id))[0]?.n ?? 0)

  if (playedEachOther > 0) {
    outcomes.push({ handle: p.ownerHandle, primary: holder.cueverseId ?? holder.id, secondary: owner.cueverseId ?? owner.id,
      action: 'refused', detail: `they played each other ${playedEachOther} time(s) — two people, not one` })
    console.log(`  "${p.ownerHandle}": REFUSED — they played each other`)
    continue
  }

  /*
   * A Season holding a playing entry for BOTH is contradictory. A Season where one entry is empty --
   * no standing, no group, no match, no seat -- is the import's leftover, and removing it destroys
   * no record.
   */
  const sharedSeasons = await prisma.$queryRawUnsafe<Array<{ seasonId: number }>>(`
    select distinct a."seasonId" from season_entrant a
    join season_entrant b on b."seasonId" = a."seasonId" and b."playerId" = $2
    where a."playerId" = $1`, owner.id, holder.id)

  let contradiction: string | null = null
  const emptyRows: number[] = []
  for (const { seasonId } of sharedSeasons) {
    const rows = await prisma.seasonEntrant.findMany({
      where: { seasonId, playerId: { in: [owner.id, holder.id] } },
      select: { id: true, playoffIncluded: true },
    })
    const scored = await Promise.all(rows.map(async (r) => ({
      id: r.id,
      n: (await prisma.seasonStanding.count({ where: { entrantId: r.id } }))
       + (await prisma.seasonGroupPlayer.count({ where: { entrantId: r.id } }))
       + (await prisma.seasonMatch.count({ where: { OR: [{ homeEntrantId: r.id }, { awayEntrantId: r.id }] } }))
       + (await prisma.seasonPlayoffMatch.count({ where: { OR: [{ homeEntrantId: r.id }, { awayEntrantId: r.id }] } }))
       + (r.playoffIncluded ? 1 : 0),
    })))
    const empties = scored.filter((r) => r.n === 0)
    if (empties.length === 0) { contradiction = `Season ${seasonId} holds a playing entry for both`; break }
    emptyRows.push(...empties.map((e) => e.id))
  }
  if (contradiction) {
    outcomes.push({ handle: p.ownerHandle, primary: holder.cueverseId ?? holder.id, secondary: owner.cueverseId ?? owner.id,
      action: 'refused', detail: contradiction })
    console.log(`  "${p.ownerHandle}": REFUSED — ${contradiction}`)
    continue
  }
  if (APPLY && emptyRows.length) {
    await prisma.seasonEntrant.deleteMany({ where: { id: { in: emptyRows } } })
  }

  if (ownerPlay === 0 && holderPlay === 0) {
    outcomes.push({ handle: p.ownerHandle, primary: holder.cueverseId ?? holder.id, secondary: owner.cueverseId ?? owner.id,
      action: 'skipped', detail: 'neither account carries any record' })
    continue
  }

  // The account carrying more of the record survives.
  const primary = ownerPlay >= holderPlay ? owner : holder
  const secondary = ownerPlay >= holderPlay ? holder : owner

  const check = await checkMergeAllowed(primary.id, secondary.id)
  if (!check.ok) {
    outcomes.push({ handle: p.ownerHandle, primary: primary.cueverseId ?? primary.id, secondary: secondary.cueverseId ?? secondary.id,
      action: 'refused', detail: check.error })
    console.log(`  "${p.ownerHandle}": REFUSED — ${check.error}`)
    continue
  }

  if (!APPLY) {
    outcomes.push({ handle: p.ownerHandle, primary: primary.cueverseId ?? primary.id, secondary: secondary.cueverseId ?? secondary.id, action: 'would-merge' })
    continue
  }

  const res = await mergeAccounts(ACTOR, primary.id, secondary.id,
    'archive dedupe: one person minted twice — the same handle as one account\'s CueVerse ID and another\'s alias')
  outcomes.push({ handle: p.ownerHandle, primary: primary.cueverseId ?? primary.id, secondary: secondary.cueverseId ?? secondary.id,
    action: res.ok ? 'merged' : 'failed', detail: res.error ?? res.mergeId })
  if (!res.ok) console.log(`  "${p.ownerHandle}": FAILED — ${res.error}`)
}

// The resolver caches the account list; it is stale the moment an account goes away.
resetCanonicalCache()

mkdirSync('reports', { recursive: true })
const summary = outcomes.reduce<Record<string, number>>((a, o) => ({ ...a, [o.action]: (a[o.action] ?? 0) + 1 }), {})
writeFileSync('reports/archive-duplicate-accounts.json', JSON.stringify({ mode: APPLY ? 'apply' : 'dry-run', summary, outcomes }, null, 2))
console.log(`\n${JSON.stringify(summary, null, 2)}`)
console.log('report: reports/archive-duplicate-accounts.json')

await prisma.$disconnect()
