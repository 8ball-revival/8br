/**
 * Shared Cup data service — the SINGLE read path for Cup data across the site
 * (public pages, homepage, and the ranking pipeline).
 *
 * Source of truth = the database, resolved per request into an AsyncLocalStorage store
 * at the page boundary (`cupStore.enterWith(await loadCupContext())`, see ./prime). This
 * module never reads checked-in data: an empty platform simply has zero cups. (The
 * historical `generated-cups.json` remains in the repo for future restoration but no
 * runtime code imports it.) The API (`getCups`, `getCup`, `cupBracket`, `emptyBracket`,
 * types) is preserved so consumers are unchanged.
 */
import { cupStore } from './context'
import type { Cup } from './fixtures'

// Re-export the shared types + pure bracket helpers so consumers need only this module.
export type { CupCompetitor, BracketSlot, BracketMatch, BracketRound, TiePlayer, TieMatch, TeamTie, Cup } from './fixtures'
export { cupBracket, emptyBracket } from './fixtures'

/**
 * Read the Cup data for the CURRENT request.
 *
 * The canonical revision is resolved once per request at the page boundary and held in
 * an AsyncLocalStorage store — NOT a shared module variable. That guarantees request
 * isolation: two concurrent requests each see their own complete revision, and a
 * revision cannot change mid-calculation. Outside a primed context (or on a fresh/empty
 * platform) there are simply no cups — zero cups is a valid state, not an error.
 */
export function getCups(): Cup[] {
  const ctx = cupStore.getStore()
  return ctx ? ctx.cups : []
}

export function getCup(number: number): Cup | undefined {
  return getCups().find((c) => c.number === number)
}
