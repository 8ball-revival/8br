import 'server-only'
import { cache } from 'react'
import { prisma } from '@/lib/prisma'
import type { CupContext } from './context'
import cupData from './data/generated-cups.json'
import type { Cup } from './fixtures'

// Re-export so a page needs a single import to prime itself:
//   import { cupStore, loadCupContext } from '@/lib/cups/prime'
//   cupStore.enterWith(await loadCupContext())
export { cupStore } from './context'

// Checked-in build snapshot — used ONLY as a visibly-logged fallback when the DB read
// fails or no snapshot revision exists yet. It never silently masks a database failure.
const FALLBACK = (cupData as unknown as { cups: Cup[] }).cups

/**
 * Resolve the canonical Cup revision for THIS request from the database.
 *
 * React `cache()` memoizes it per request, so it runs at most once even if several
 * pages/components ask for it. It returns a complete, self-consistent revision — one
 * request always reads one revision. On any DB failure it falls back to the checked-in
 * build snapshot and logs a VISIBLE error (revision -1) so the fallback can never
 * silently mask a database problem; a missing snapshot row logs a warning (revision 0).
 */
export const loadCupContext = cache(async (): Promise<CupContext> => {
  try {
    const row = await prisma.cupSnapshot.findUnique({ where: { id: 1 } })
    if (row?.payload) {
      return { cups: row.payload as unknown as Cup[], revision: row.revision }
    }
    console.warn(
      '[cups] No CupSnapshot revision found in the database — using the checked-in build snapshot fallback. Run `npm run cups:snapshot` to generate one.',
    )
    return { cups: FALLBACK, revision: 0 }
  } catch (err) {
    console.error(
      '[cups] FAILED to read the CupSnapshot revision from the database — falling back to the checked-in build snapshot (data may be stale). This fallback is logged, NOT silent:',
      err,
    )
    return { cups: FALLBACK, revision: -1 }
  }
})

/**
 * Prime the current request with its canonical Cup revision.
 *
 * Call this at the TOP of any page that renders Cup-derived data (Cup pages, rankings,
 * profiles, homepage) BEFORE invoking the synchronous stat pipeline:
 *
 *     import { cupStore, loadCupContext } from '@/lib/cups/prime'
 *     cupStore.enterWith(await loadCupContext())
 *
 * `enterWith` MUST run inline in the page's own async frame — verified: calling it inside
 * an awaited helper does NOT propagate back to a page dispatched as its own request root,
 * whereas the inline form propagates correctly and stays isolated across concurrent
 * requests. Do not wrap it in an awaited helper.
 */
