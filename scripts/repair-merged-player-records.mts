// RETIRED — see scripts/_retired.mjs. Importing this file refuses to run.
import './_retired.mjs'

/**
 * Finish an approved player merge by moving the competition records across.
 *
 * ── What went wrong ──────────────────────────────────────────────────────────────────────────────
 * `mergePlayers` records the link and deactivates the secondary profile. It does NOT repoint the
 * competition data, and no read path unions the two — so after a merge the person still has their
 * results split across two identities. The Rankings then shows them twice, and `getLadder` and the
 * table disagree about which record is which, which is exactly the inconsistency two verify suites
 * have been reporting.
 *
 * This finishes the job for merges that have already been approved: every row still pointing at a
 * merged-away profile is moved to the canonical one, and the derived rating ledger is rebuilt.
 *
 * ── Why the ledger is rebuilt rather than repointed ──────────────────────────────────────────────
 * `rating_ledger` is DERIVED — a full replay of every completed competition in order. Rewriting its
 * playerId in place would move the rows but leave each one's pre/post rating computed against the
 * old split history, so the numbers would be internally inconsistent. A rebuild recomputes them from
 * the source results, which is the only way the ratings end up meaning what they say.
 *
 * Default is a DRY RUN. Writing requires --apply.
 *
 *   npx tsx --tsconfig scripts/tsconfig.verify.json --env-file=.env scripts/repair-merged-player-records.mts
 *   npx tsx --tsconfig scripts/tsconfig.verify.json --env-file=.env scripts/repair-merged-player-records.mts --apply
 */
import { prisma } from '../src/lib/prisma.ts'
import { assertLocalDatabase } from '../src/lib/db-guard.ts'
import { recordAudit } from '../src/lib/competition/audit.ts'

assertLocalDatabase('repair-merged-player-records')

const APPLY = process.argv.includes('--apply')
const actor = { userId: 2, username: 'admin' }

async function main() {
  const merges = await prisma.playerMerge.findMany({
    where: { status: 'APPROVED' },
    select: { id: true, canonicalPlayerId: true, mergedPlayerId: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  })
  console.log(`${merges.length} approved merge(s) on record.\n`)
  if (merges.length === 0) return

  let totalEntrants = 0
  let totalLedger = 0
  const work: { merge: typeof merges[number]; entrants: number[]; ledger: number }[] = []

  for (const m of merges) {
    const [canonical, merged] = await Promise.all([
      prisma.player.findUnique({
        where: { id: m.canonicalPlayerId },
        select: { id: true, primaryName: true, cueverseId: true, active: true },
      }),
      prisma.player.findUnique({
        where: { id: m.mergedPlayerId },
        select: { id: true, primaryName: true, cueverseId: true, active: true },
      }),
    ])
    if (!canonical || !merged) {
      console.log(`  merge ${m.id}: one side no longer exists — skipped.`)
      continue
    }

    const entrants = await prisma.seasonEntrant.findMany({
      where: { playerId: merged.id },
      select: { id: true, seasonId: true },
    })
    const ledger = await prisma.ratingLedger.count({ where: { playerId: merged.id } })

    console.log(`  merge ${m.id}  (${m.createdAt.toISOString().slice(0, 16)})`)
    console.log(`     keep    ${canonical.id}  ${JSON.stringify(canonical.cueverseId)} / ${JSON.stringify(canonical.primaryName)}  active=${canonical.active}`)
    console.log(`     merged  ${merged.id}  ${JSON.stringify(merged.cueverseId)} / ${JSON.stringify(merged.primaryName)}  active=${merged.active}`)
    console.log(`     still on the merged record: ${entrants.length} entrant(s), ${ledger} ledger row(s)`)

    if (entrants.length === 0 && ledger === 0) {
      console.log('     nothing to move.\n')
      continue
    }

    /*
     * A Season may hold each player only once.
     *
     * If both profiles entered the same Season, moving one on top of the other would either violate
     * that or silently drop a record — so it stops and says which Season, rather than guessing which
     * of two entries is the real one.
     */
    const canonSeasons = new Set(
      (await prisma.seasonEntrant.findMany({
        where: { playerId: canonical.id }, select: { seasonId: true },
      })).map((e) => e.seasonId),
    )
    const clash = entrants.filter((e) => canonSeasons.has(e.seasonId)).map((e) => e.seasonId)
    if (clash.length > 0) {
      console.log(`     REFUSING: both profiles are entrants in Season(s) ${clash.join(', ')}.`)
      console.log('     Resolve that by hand — which of the two entries is the real one is not something this can decide.\n')
      continue
    }

    work.push({ merge: m, entrants: entrants.map((e) => e.id), ledger })
    totalEntrants += entrants.length
    totalLedger += ledger
    console.log('')
  }

  if (work.length === 0) {
    console.log('Nothing to repair.')
    return
  }

  console.log(`Would move ${totalEntrants} entrant row(s) and rebuild the ledger (${totalLedger} rows currently on merged profiles).`)
  if (!APPLY) {
    console.log('\nDRY RUN. Re-run with --apply.')
    return
  }

  const before = {
    seasons: await prisma.season.count(),
    entrants: await prisma.seasonEntrant.count(),
    matches: await prisma.seasonMatch.count(),
    standings: await prisma.seasonStanding.count(),
    playoffs: await prisma.seasonPlayoffMatch.count(),
    players: await prisma.player.count(),
  }

  await prisma.$transaction(async (tx) => {
    for (const w of work) {
      const canonicalId = w.merge.canonicalPlayerId
      const mergedId = w.merge.mergedPlayerId

      // The entrant carries its own display identity, captured when it was added. Bring it in line
      // with the canonical profile so the Season reads under one name.
      const canon = await tx.player.findUniqueOrThrow({
        where: { id: canonicalId }, select: { cueverseId: true, primaryName: true },
      })
      for (const entrantId of w.entrants) {
        await tx.seasonEntrant.update({
          where: { id: entrantId },
          data: {
            playerId: canonicalId,
            username: canon.cueverseId ?? canon.primaryName,
            displayName: canon.primaryName,
          },
        })
      }

      // Derived rows for the retired identity. The rebuild below regenerates them under the
      // canonical one; leaving these would double-count the person.
      await tx.ratingLedger.deleteMany({ where: { playerId: mergedId } })

      await recordAudit(actor, {
        action: 'player.merge.repoint',
        entity: 'Player',
        entityId: canonicalId,
        oldValue: { mergedPlayerId: mergedId },
        newValue: { entrantsMoved: w.entrants.length, ledgerRowsCleared: w.ledger },
      }, tx)
    }

    const { rebuildRatingLedger } = await import('../src/lib/stats/ledger.ts')
    await rebuildRatingLedger(tx)
  }, { timeout: 120_000 })

  const after = {
    seasons: await prisma.season.count(),
    entrants: await prisma.seasonEntrant.count(),
    matches: await prisma.seasonMatch.count(),
    standings: await prisma.seasonStanding.count(),
    playoffs: await prisma.seasonPlayoffMatch.count(),
    players: await prisma.player.count(),
  }

  console.log('\nCounts before → after:')
  for (const k of Object.keys(before) as (keyof typeof before)[]) {
    const same = before[k] === after[k]
    console.log(`  ${k.padEnd(10)} ${String(before[k]).padStart(6)} → ${String(after[k]).padStart(6)}${same ? '' : '   CHANGED'}`)
  }

  console.log('\nAfter the repair:')
  for (const w of work) {
    const stillEnt = await prisma.seasonEntrant.count({ where: { playerId: w.merge.mergedPlayerId } })
    const stillLed = await prisma.ratingLedger.count({ where: { playerId: w.merge.mergedPlayerId } })
    const canonLed = await prisma.ratingLedger.count({ where: { playerId: w.merge.canonicalPlayerId } })
    console.log(`  merged ${w.merge.mergedPlayerId}: ${stillEnt} entrants, ${stillLed} ledger rows (both should be 0)`)
    console.log(`  canonical ${w.merge.canonicalPlayerId}: ${canonLed} ledger rows`)
  }
}

let code = 0
try {
  await main()
} catch (e) {
  code = 1
  console.log('\nFAILED: ' + (e instanceof Error ? e.message : String(e)))
} finally {
  await prisma.$disconnect()
}
process.exit(code)
