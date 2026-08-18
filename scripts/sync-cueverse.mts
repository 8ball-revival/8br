/**
 * Fetch the CueVerse leaderboard once, now.
 *
 * The scheduled path is the Vercel cron in vercel.json; this is the same service called by hand,
 * for seeding a fresh environment or checking the integration after a change.
 *
 * Run:  npx tsx --tsconfig scripts/tsconfig.verify.json --env-file=.env scripts/sync-cueverse.mts
 */
import { refreshCueVerseLeaderboard, readLatestSnapshot } from '../src/lib/cueverse/service.ts'

const result = await refreshCueVerseLeaderboard()
console.log('refresh:', JSON.stringify(result))

const snapshot = await readLatestSnapshot()
if (!snapshot) {
  console.log('no snapshot stored')
} else {
  console.log(`\nfetched ${snapshot.fetchedAt.toISOString()} (stale: ${snapshot.stale})`)
  console.log(`online: ${snapshot.playersOnline ?? '—'}  tables: ${snapshot.tablesActive ?? '—'}`)
  for (const e of snapshot.entries) {
    console.log(`  ${e.rank}. ${e.name.padEnd(16)} ${String(e.rating).padStart(5)}  ${e.wins ?? '—'}–${e.losses ?? '—'}`)
  }
}

process.exit(result.ok ? 0 : 1)
