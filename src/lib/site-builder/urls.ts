/**
 * URL and embed validation for anything an administrator can type into the builder.
 *
 * Every link, button destination, background source and embed passes through here. The rule is an
 * allowlist in both directions: which schemes may appear, and which hosts may be framed.
 *
 * The scheme check is the one that matters. `javascript:` in an href is a script execution, and it
 * is reachable from a plain text field — so a builder that accepts arbitrary URLs is a builder that
 * accepts arbitrary code. Blocking the literal string is not enough, because browsers tolerate a
 * great deal of noise inside a scheme: tabs, newlines, NULs and HTML entities are all stripped
 * before the scheme is read. `java\tscript:alert(1)` navigates. So the value is normalised the way a
 * browser would normalise it BEFORE the scheme is inspected.
 */

/** Schemes a link may use. `mailto:` and `tel:` are included because a contact block needs them. */
const ALLOWED_SCHEMES = new Set(['http:', 'https:', 'mailto:', 'tel:'])

/**
 * Providers an embed module may frame.
 *
 * An iframe runs a third party's code in a frame on the site, so this is a trust list, not a
 * convenience list. Adding to it is a deliberate act.
 */
export const EMBED_ALLOWLIST: { id: string; label: string; hosts: string[] }[] = [
  { id: 'youtube', label: 'YouTube', hosts: ['www.youtube.com', 'youtube.com', 'youtu.be', 'www.youtube-nocookie.com'] },
  { id: 'vimeo', label: 'Vimeo', hosts: ['vimeo.com', 'player.vimeo.com'] },
  { id: 'twitch', label: 'Twitch', hosts: ['www.twitch.tv', 'twitch.tv', 'player.twitch.tv', 'clips.twitch.tv'] },
]

/**
 * Strip what a browser strips before it reads a scheme.
 *
 * Control characters and whitespace inside the scheme are ignored during URL parsing, and HTML
 * entities are decoded first when the value came from an attribute. Both are how `javascript:` gets
 * past a naive check, so both are removed here before anything is decided.
 */
function normalise(raw: string): string {
  return raw
    .replace(/&#(\d+);?/g, (_, d: string) => String.fromCharCode(Number(d)))
    .replace(/&#x([0-9a-f]+);?/gi, (_, h: string) => String.fromCharCode(parseInt(h, 16)))
    // eslint-disable-next-line no-control-regex
    .replace(new RegExp('[\u0000-\u0020\u007f-\u009f]', 'g'), '')
    .trim()
}

export function isSafeUrl(raw: string, opts: { internalOnly?: boolean } = {}): boolean {
  const value = normalise(raw)
  if (value === '') return false

  // An internal path. Rejecting `//` matters: `//evil.com` is a protocol-relative URL, which looks
  // like a path and navigates off-site.
  if (value.startsWith('/') && !value.startsWith('//')) return true
  if (opts.internalOnly) return false

  // Fragment and query-only links stay on the current page, so they are internal by nature.
  if (value.startsWith('#') || value.startsWith('?')) return true

  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }
  if (!ALLOWED_SCHEMES.has(url.protocol)) return false
  // A hostname is required for http(s) — `https:///path` parses but goes nowhere useful.
  if ((url.protocol === 'http:' || url.protocol === 'https:') && !url.hostname) return false
  return true
}

/** True when the URL leaves the site, so a link can be given the right target and rel. */
export function isExternalUrl(raw: string): boolean {
  const value = normalise(raw)
  return /^https?:\/\//i.test(value)
}

/**
 * Resolve an embed URL to the provider that may frame it.
 *
 * Returns null when the host is not on the allowlist, which is what the embed module renders its
 * refusal from. Host matching is exact rather than a suffix test: `youtube.com.evil.example`
 * ends with a trusted string and must not pass.
 */
export function resolveEmbedProvider(raw: string): { id: string; label: string } | null {
  const value = normalise(raw)
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null
  }
  if (url.protocol !== 'https:') return null
  const host = url.hostname.toLowerCase()
  const provider = EMBED_ALLOWLIST.find((p) => p.hosts.includes(host))
  return provider ? { id: provider.id, label: provider.label } : null
}
