/**
 * Concurrency test for Cup request-isolation (item #1).
 *
 * Proves that two (here: many) concurrent "requests", each priming a DIFFERENT valid Cup
 * revision, never leak into each other and never read a half-applied revision. This
 * exercises the REAL `getCups()` reader from the service against the REAL `cupStore`
 * AsyncLocalStorage context — the exact primitives the page boundary uses via
 * `cupStore.enterWith(await loadCupContext())`.
 *
 * Run: npx tsx scripts/test-cup-isolation.mts   (or: npm run test:cup-isolation)
 * Exits non-zero on any leak/miss so it can gate CI or a pre-push check.
 */
import { cupStore, type CupContext } from '@/lib/cups/context'
import { getCups } from '@/lib/cups/service'
import type { Cup } from '@/lib/cups/fixtures'

// Build a distinct, self-consistent "revision" whose cups all carry the same tag, so any
// cross-request leak (or a half-applied revision) is immediately detectable.
function makeRevision(tag: string, revision: number, count: number): CupContext {
  const cups = Array.from({ length: count }, (_, i) => ({
    number: i + 1,
    name: `${tag}-cup-${i + 1}`,
    // Every cup in a revision is tagged; a leak would surface a foreign tag.
    champion: tag,
  })) as unknown as Cup[]
  return { cups, revision }
}

// One simulated request: prime its own revision, then read getCups() repeatedly across
// interleaved awaits (mirroring a page + its sync stat pipeline running over several ticks).
async function simulateRequest(tag: string, revision: number, count: number, jitter: number) {
  return cupStore.run(makeRevision(tag, revision, count), async () => {
    const reads: { revision: number; foreignTags: string[]; count: number }[] = []
    for (let step = 0; step < 5; step++) {
      // Yield control so other requests interleave between our reads.
      await new Promise((r) => setTimeout(r, jitter * (step + 1)))
      const cups = getCups()
      const ctxRevision = cupStore.getStore()?.revision ?? -999
      const foreignTags = [...new Set(cups.map((c) => c.champion).filter((t) => t !== tag))]
      reads.push({ revision: ctxRevision, foreignTags, count: cups.length })
    }
    return { tag, expectedRevision: revision, expectedCount: count, reads }
  })
}

async function main() {
  // Sanity: outside any request context, getCups() falls back to the build snapshot
  // (and logs a visible warning) rather than throwing or returning another request's data.
  const fallback = getCups()
  console.log(`[isolation] no-context fallback returned ${fallback.length} cups (build snapshot).`)

  // Fire many concurrent requests, each with a different valid revision + size + timing.
  const specs = [
    { tag: 'REV_A', revision: 101, count: 3, jitter: 7 },
    { tag: 'REV_B', revision: 202, count: 11, jitter: 3 },
    { tag: 'REV_C', revision: 303, count: 7, jitter: 5 },
    { tag: 'REV_D', revision: 404, count: 20, jitter: 2 },
    { tag: 'REV_E', revision: 505, count: 1, jitter: 9 },
  ]
  const results = await Promise.all(
    specs.map((s) => simulateRequest(s.tag, s.revision, s.count, s.jitter)),
  )

  let failures = 0
  for (const res of results) {
    for (const [i, read] of res.reads.entries()) {
      const revisionOk = read.revision === res.expectedRevision
      const countOk = read.count === res.expectedCount
      const noForeign = read.foreignTags.length === 0
      if (!revisionOk || !countOk || !noForeign) {
        failures++
        console.error(
          `[isolation] LEAK ${res.tag} read#${i}: revision=${read.revision} (want ${res.expectedRevision}), ` +
            `count=${read.count} (want ${res.expectedCount}), foreignTags=${JSON.stringify(read.foreignTags)}`,
        )
      }
    }
    if (res.reads.every((r) => r.revision === res.expectedRevision && r.count === res.expectedCount && r.foreignTags.length === 0)) {
      console.log(
        `[isolation] OK ${res.tag}: all ${res.reads.length} interleaved reads saw revision ${res.expectedRevision} with ${res.expectedCount} cups, no foreign data.`,
      )
    }
  }

  if (failures > 0) {
    console.error(`\n[isolation] FAILED — ${failures} leaked/inconsistent read(s) detected.`)
    process.exit(1)
  }
  console.log('\n[isolation] PASSED — no revision leaked across concurrent requests; every request read one complete, consistent revision.')
}

main().catch((err) => {
  console.error('[isolation] test crashed:', err)
  process.exit(1)
})
