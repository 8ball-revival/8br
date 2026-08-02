/**
 * Shared Cup data service — the SINGLE read path for Cup data across the site
 * (public pages, homepage, and the historical stat/ranking pipeline).
 *
 * Source of truth = the database. This service reads the DETERMINISTIC generated
 * snapshot (src/lib/cups/data/generated-cups.json, produced by `npm run cups:snapshot`
 * from the DB) — a derived compatibility artifact that is byte-for-byte equivalent to
 * the old handwritten fixtures. No consumer imports the JSON directly; they all import
 * from here, so the API (`getCups`, `getCup`, `cupBracket`, `emptyBracket`, types) is
 * preserved. The handwritten `fixtures.ts` remains only as a rollback/reference.
 */
import cupData from './data/generated-cups.json'
import { cupStore } from './context'
import type { Cup } from './fixtures'

// Re-export the shared types + pure bracket helpers so consumers need only this module.
export type { CupCompetitor, BracketSlot, BracketMatch, BracketRound, TiePlayer, TieMatch, TeamTie, Cup } from './fixtures'
export { cupBracket, emptyBracket } from './fixtures'

// Checked-in build snapshot — fallback / rollback / verification only.
const FALLBACK = (cupData as unknown as { cups: Cup[] }).cups

let warnedUnprimed = false

/**
 * Read the Cup data for the CURRENT request.
 *
 * The canonical revision is resolved once per request at the page boundary
 * (`cupStore.enterWith(await loadCupContext())`, see ./prime) and held in an
 * AsyncLocalStorage store — NOT a shared module variable. That guarantees request
 * isolation: two concurrent requests each see their own complete revision, and a
 * revision cannot change mid-calculation. If a request never primed (e.g. a code path
 * that runs outside a primed page), we fall back to the checked-in build snapshot and
 * log a VISIBLE warning — never a silent stale read.
 */
export function getCups(): Cup[] {
  const ctx = cupStore.getStore()
  if (ctx) return ctx.cups
  if (!warnedUnprimed) {
    warnedUnprimed = true
    console.warn('[cups] getCups() was called outside a primed request context; using the checked-in build snapshot. Prime the request (cupStore.enterWith(await loadCupContext())) to read the live DB revision.')
  }
  return FALLBACK
}

export function getCup(number: number): Cup | undefined {
  return getCups().find((c) => c.number === number)
}
