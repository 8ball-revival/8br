import { AsyncLocalStorage } from 'node:async_hooks'
import type { TournamentView } from './fixtures'

/**
 * Request-scoped TournamentView revision context. Each request resolves ONE complete TournamentView
 * revision and stores it here (via `tournamentStore.enterWith(...)` at the page boundary);
 * the synchronous `getTournaments()` reads it. AsyncLocalStorage guarantees isolation —
 * concurrent requests each have their own async context, so one request can never
 * read another's revision, and a revision cannot change mid-calculation.
 */
export interface TournamentContext {
  cups: TournamentView[]
  revision: number
}

export const tournamentStore = new AsyncLocalStorage<TournamentContext>()

/**
 * The cup revision for the CURRENT request (0 when unprimed / build snapshot). Stat
 * modules that memoise cup-derived results at module scope key their caches on this so a
 * snapshot change (a tournament completed/edited/deleted) is reflected instead of served stale.
 */
export function currentTournamentRevision(): number {
  return tournamentStore.getStore()?.revision ?? 0
}
