import { AsyncLocalStorage } from 'node:async_hooks'
import type { Cup } from './fixtures'

/**
 * Request-scoped Cup revision context. Each request resolves ONE complete Cup
 * revision and stores it here (via `cupStore.enterWith(...)` at the page boundary);
 * the synchronous `getCups()` reads it. AsyncLocalStorage guarantees isolation —
 * concurrent requests each have their own async context, so one request can never
 * read another's revision, and a revision cannot change mid-calculation.
 */
export interface CupContext {
  cups: Cup[]
  revision: number
}

export const cupStore = new AsyncLocalStorage<CupContext>()
