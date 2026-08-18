/**
 * Validation for admin-authored button destinations.
 *
 * Editors type these into the Payload admin, so the value is untrusted input that ends up in an
 * `href`. The rule set is deliberately an allowlist, not a blocklist, because blocklists lose to
 * obfuscation (`JaVaScRiPt:`, or a tab wedged inside the scheme).
 *
 * Allowed:
 *   - internal site paths: `/seasons`, `/tournaments?year=2026`, `/players`
 *   - absolute http(s) URLs: `https://example.com`
 *   - bare fragments / queries: `#section`, `?tab=all`
 *
 * Rejected: every other scheme (`javascript:`, `data:`, `vbscript:`, `file:`…), protocol-relative
 * URLs (`//evil.example`, which the browser resolves against the current scheme), and backslash
 * variants (`/\evil.example`) that some parsers normalise to a host.
 *
 * Pure and framework-free so the Payload field validator and the render path can share it.
 */

/** Result of checking a destination. */
export type LinkCheck = { ok: true; href: string } | { ok: false; reason: string }

/** Control characters browsers strip from a URL before resolving it. */
const CONTROL_CHARS = /[\u0000-\u0020\u007F]/g

/** Schemes that are never acceptable in an href, whatever the casing or leading whitespace. */
const DANGEROUS_SCHEME = /^\s*(javascript|data|vbscript|file|blob|about)\s*:/i

/** A scheme we do allow, in absolute form. */
const SAFE_ABSOLUTE = /^https?:\/\//i

export function checkLinkDestination(raw: unknown): LinkCheck {
  if (typeof raw !== 'string') return { ok: false, reason: 'Destination must be text.' }

  // Strip control characters (incl. tab/newline) before inspecting: browsers ignore them inside a
  // scheme, so "java<TAB>script:alert(1)" would otherwise slip past a naive prefix check.
  const href = raw.replace(CONTROL_CHARS, '').trim()

  if (!href) return { ok: false, reason: 'Destination is required.' }
  if (DANGEROUS_SCHEME.test(href)) {
    return { ok: false, reason: 'That URL scheme is not allowed. Use a site path like /seasons.' }
  }
  // `//host` and `/\host` are protocol-relative — they leave the site despite looking internal.
  if (/^[/\\]{2}/.test(href)) {
    return { ok: false, reason: 'Protocol-relative URLs are not allowed. Use /path or https://…' }
  }
  if (href.startsWith('/')) return { ok: true, href }
  if (href.startsWith('#') || href.startsWith('?')) return { ok: true, href }
  if (SAFE_ABSOLUTE.test(href)) {
    try {
      new URL(href)
      return { ok: true, href }
    } catch {
      return { ok: false, reason: 'That does not parse as a valid URL.' }
    }
  }
  return {
    ok: false,
    reason: 'Enter a site path starting with / (e.g. /seasons) or a full https:// URL.',
  }
}

/** True when the destination is safe to put in an href. */
export function isSafeLinkDestination(raw: unknown): boolean {
  return checkLinkDestination(raw).ok
}

/**
 * Render-time guard. Even though the field validator runs on save, content can predate the
 * validator or arrive through a direct API call, so the renderer never trusts stored data:
 * anything unsafe collapses to the fallback rather than emitting a live `javascript:` href.
 */
export function safeHref(raw: unknown, fallback = '/'): string {
  const result = checkLinkDestination(raw)
  return result.ok ? result.href : fallback
}

/** Payload field validator — returns `true` when valid, else the message Payload shows the editor. */
export function validateLinkDestination(value: unknown): true | string {
  const result = checkLinkDestination(value)
  return result.ok ? true : result.reason
}
