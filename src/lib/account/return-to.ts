/**
 * Sanitize a post-authentication `returnTo` target. Only same-origin, root-relative paths are
 * allowed so a crafted `?returnTo=` can never bounce a freshly-signed-in user to another site
 * (open-redirect protection). Anything else falls back to the account page.
 */
export function safeReturnTo(raw: string | null | undefined, fallback = '/account'): string {
  if (!raw) return fallback
  // Must be a root-relative path. Reject protocol-relative ("//host") and backslash tricks ("/\\host").
  if (!raw.startsWith('/')) return fallback
  if (raw.startsWith('//') || raw.startsWith('/\\')) return fallback
  return raw
}
