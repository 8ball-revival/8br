import 'server-only'
import { cache } from 'react'
import { prisma } from '@/lib/prisma'
import type { CupContext } from './context'
import type { Cup } from './fixtures'

// Re-export so a page needs a single import to prime itself:
//   import { cupStore, loadCupContext } from '@/lib/cups/prime'
//   cupStore.enterWith(await loadCupContext())
export { cupStore } from './context'

/**
 * Resolve the canonical Cup revision for THIS request from the database.
 *
 * React `cache()` memoizes it per request, so it runs at most once even if several
 * pages/components ask for it. It returns a complete, self-consistent revision — one
 * request always reads one revision.
 *
 * Live-first platform: the database is the ONLY source. An empty database (no cups,
 * no CupSnapshot row) is a completely valid state and resolves to zero cups SILENTLY —
 * no warning, no checked-in fallback data. (The historical `generated-cups.json` remains
 * in the repo for future restoration but never participates in the runtime.) A genuine
 * DB read FAILURE is different from an empty table: it is logged as an error and also
 * resolves to zero cups (revision -1) so a broken database can never masquerade as data.
 */
export const loadCupContext = cache(async (): Promise<CupContext> => {
  try {
    const row = await prisma.tournamentSnapshot.findUnique({ where: { id: 1 } })
    if (row?.payload) {
      return { cups: row.payload as unknown as Cup[], revision: row.revision }
    }
    // No snapshot yet — normal for a fresh/empty platform. Zero cups, no noise.
    return { cups: [], revision: 0 }
  } catch (err) {
    console.error('[cups] FAILED to read the CupSnapshot revision from the database:', err)
    return { cups: [], revision: -1 }
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
