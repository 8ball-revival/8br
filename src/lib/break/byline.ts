/**
 * How an author is named on a post or a comment.
 *
 * The site's identity rule is Preferred Name in gold, CueVerse ID in white beside it. That reads
 * well for somebody who has set a preferred name — "Neo Starkiller" — and badly for somebody who
 * has not, because their preferred name IS their CueVerse ID and the byline printed it twice:
 * "StressTester99 StressTester99". Preferred Name is optional and never required to sign up, so
 * that is the DEFAULT state of a new account, not an edge case.
 *
 * The handle is therefore shown only when it says something the name does not.
 */

/** The handle to show beside a name, or null when it would only repeat it. */
export function secondaryHandle(
  name: string | null | undefined,
  handle: string | null | undefined,
): string | null {
  const h = (handle ?? '').trim()
  if (!h) return null
  // Case-insensitively: "starkiller" beside "Starkiller" is the same repetition with different shift.
  if (h.toLowerCase() === (name ?? '').trim().toLowerCase()) return null
  return h
}
