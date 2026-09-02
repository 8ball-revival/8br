/**
 * How large an upload may be, in one place both the browser and the server can read.
 *
 * ── Why this number, and not a bigger one ───────────────────────────────────────────────────────
 * Three ceilings have to agree, and the smallest wins whether or not it is written down:
 *
 *   1. Vercel caps the request body of a serverless function at 4.5 MB. This is the platform's
 *      limit, not ours, and nothing in the application can raise it.
 *   2. Next caps a Server Action body at 1 MB unless `serverActions.bodySizeLimit` says otherwise.
 *      It was unset, so this was the real limit — see next.config.ts, now set to match this file.
 *   3. Our own validator had 12 MB, and 20 MB for an animated GIF.
 *
 * The gap between (2) and (3) is what made avatar upload look broken: anything over 1 MB was
 * refused by the framework before a line of our code ran, and a refusal at that layer is not a
 * returned error a component can display — it is an exception, so the whole page fell into the
 * error boundary and the reader saw "An unexpected error occurred". A 1.4 MB PNG did it every time.
 *
 * So the ceiling is stated once, below the platform's 4.5 MB, and everything else is derived from
 * it: the config, the validator, the browser's check before it sends, and the sentence in the panel
 * telling the reader what they can upload. A limit the interface does not mention is a trap, and one
 * the layers disagree about is worse.
 */

/** The most an upload may weigh. Kept under Vercel's 4.5 MB request-body cap with room to spare. */
export const UPLOAD_MAX_BYTES = 4 * 1024 * 1024

/** The same number for Next's config, which wants a string. */
export const UPLOAD_MAX_BODY = '4mb'

/** How to say it to a reader. */
export const UPLOAD_MAX_LABEL = '4 MB'

/** A file's size in the same units the limit is given in, for an error worth reading. */
export function describeBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}
