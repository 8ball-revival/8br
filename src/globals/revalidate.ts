import type { GlobalAfterChangeHook } from 'payload'

/**
 * Invalidate the public site's Next.js cache after site content changes.
 *
 * The public routes are `force-dynamic`, so today the homepage already re-reads the globals on
 * every request. This hook is the guarantee that publishing stays correct if any of those routes
 * later gains caching (ISR, `unstable_cache`, or Vercel's data cache) — it revalidates the root
 * layout, which covers `/` and the header on every page.
 *
 * Two deliberate details:
 *
 *  - `next/cache` is imported dynamically. Payload hooks also execute outside a Next.js request
 *    (the seed script runs through `tsx`), where importing it eagerly would blow up module load.
 *  - Failures are swallowed. A cache hint must never be the reason a Publish fails — the content
 *    is already committed to the database by the time this runs.
 */
export const revalidatePublicSite: GlobalAfterChangeHook = async ({ doc, req }) => {
  // Draft saves must not disturb the live site; only a published document changes what visitors see.
  if ((doc as { _status?: string } | null)?._status === 'draft') return doc

  try {
    const { revalidatePath } = await import('next/cache')
    revalidatePath('/', 'layout')
  } catch (err) {
    req?.payload?.logger?.warn?.(
      `Site content published, but Next.js cache revalidation was skipped: ${
        err instanceof Error ? err.message : String(err)
      }`,
    )
  }

  return doc
}
