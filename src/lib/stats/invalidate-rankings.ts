import 'server-only'
import { revalidatePath, revalidateTag } from 'next/cache'

import { LADDER_EXPLORER_TAG } from './ladder-explorer'
import { REGISTRY_STATS_TAG } from './registry-stats'

/**
 * Refresh the Rankings after ranked results change.
 *
 * ── The bug this exists to stop ──────────────────────────────────────────────────────────────────
 * The Rankings aggregate is held in `unstable_cache` under `LADDER_EXPLORER_TAG` with a five-minute
 * window, and until now nothing ever invalidated that tag. Several call sites revalidated the PATH
 * `/rankings`, which re-renders the page — but the page then reads the same cached rows back, so the
 * table kept showing whatever population existed when the entry was written. Arriving from a Season
 * would show thirty players where there were a hundred and thirty, and it looked random because the
 * only thing that actually cleared it was the five minutes running out.
 *
 * Revalidating the path without the tag is the trap: it looks like an invalidation and refreshes
 * nothing that matters. Both are done here, together, so neither can be forgotten on its own.
 *
 * The 'max' profile expires everything held under the tag, which is what an invalidation means
 * here — the aggregate is either current or it is wrong, and there is no useful middle setting.
 *
 * ── Why it never throws ──────────────────────────────────────────────────────────────────────────
 * These services are also called from scripts, fixtures and data repairs. `revalidateTag` needs
 * Next's request store and throws without it, and a cache hint failing must never fail the write it
 * is a hint about — by the time this runs, that write is already committed.
 */
export function invalidateRankings(): void {
  try {
    // The DATA. Without this the page re-renders and reads the same stale rows straight back.
    revalidateTag(LADDER_EXPLORER_TAG, 'max')
    // The homepage figures read the same results through their own cache.
    revalidateTag(REGISTRY_STATS_TAG, 'max')
    // The rendered pages that display them.
    revalidatePath('/rankings')
    revalidatePath('/')
  } catch {
    // Not inside a request. Nothing is cached in that context, so there is nothing to invalidate.
  }
}
