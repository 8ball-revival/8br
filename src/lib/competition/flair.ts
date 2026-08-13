/**
 * Curated, on-brand per-tournament FLAIR — the SAFE replacement for MyLeague's raw-HTML/free-color
 * customizer. Everything here is a closed, validated set: accent presets that stay readable on the
 * WCC black theme, an approved badge icon set, an https-only banner, and plain-text descriptions.
 * NO raw HTML/CSS/JS, no data: URLs, no arbitrary colors/transparency. Shared by the create form,
 * the manage page, and the public tournament page so validation is identical everywhere.
 *
 * This module is import-safe from both server and client (no 'server-only', no node deps).
 */

/** Accent presets. Each recolors ONLY brand-accented elements (title, borders, buttons, status
 *  badges, highlights) by overriding the --brand* CSS vars on a scoped wrapper. All chosen to hold
 *  AA contrast for text/icons on the dark ground (#050505 / #0D0D0D / #171717). */
export interface AccentPreset {
  key: string
  label: string
  brand: string // base accent
  brandHover: string // hover/active
}

export const ACCENT_PRESETS: AccentPreset[] = [
  { key: 'crimson', label: 'WCC Crimson', brand: '#C8102E', brandHover: '#E31B3D' },
  { key: 'ember', label: 'Ember', brand: '#E4572E', brandHover: '#F26B44' },
  { key: 'amber', label: 'Amber', brand: '#D9A441', brandHover: '#EDBB57' },
  { key: 'emerald', label: 'Emerald', brand: '#2FA969', brandHover: '#40BF7C' },
  { key: 'sky', label: 'Sky', brand: '#3E8FE0', brandHover: '#59A3F0' },
  { key: 'violet', label: 'Violet', brand: '#8B6DF0', brandHover: '#A48BF5' },
  { key: 'rose', label: 'Rose', brand: '#E05684', brandHover: '#F06D99' },
]

export const DEFAULT_ACCENT_KEY = 'crimson'

export function accentByKey(key: string | null | undefined): AccentPreset {
  return ACCENT_PRESETS.find((p) => p.key === key) ?? ACCENT_PRESETS[0]
}

/** Hex → "r g b" triplet for rgba(var / alpha) tints. */
function hexToRgb(hex: string): string {
  const h = hex.replace('#', '')
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  const n = parseInt(full, 16)
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`
}

/** CSS custom-property overrides for a tournament's accent, applied on a scoped wrapper via `style`.
 *  Returns an object usable as a React `style` prop. Derived dim/soft tints keep component styles
 *  (which read --brand-dim / --brand-soft) coherent. */
export function accentStyleVars(key: string | null | undefined): Record<string, string> {
  const a = accentByKey(key)
  const rgb = hexToRgb(a.brand)
  return {
    '--brand': a.brand,
    '--brand-hover': a.brandHover,
    '--color-brand': a.brand,
    '--brand-dim': `rgba(${rgb} / 0.14)`,
    '--brand-soft': `rgba(${rgb} / 0.40)`,
    '--primary': a.brand,
    '--ring': a.brand,
  }
}

/** Approved badge icon set (emoji are inert — no markup/script). Null/absent = no badge. */
export interface TournamentBadge {
  key: string
  label: string
  emoji: string
}

export const BADGES: TournamentBadge[] = [
  { key: 'trophy', label: 'Trophy', emoji: '🏆' },
  { key: 'flame', label: 'Flame', emoji: '🔥' },
  { key: 'star', label: 'Star', emoji: '⭐' },
  { key: 'crown', label: 'Crown', emoji: '👑' },
  { key: 'eightball', label: '8-Ball', emoji: '🎱' },
  { key: 'target', label: 'Target', emoji: '🎯' },
  { key: 'bolt', label: 'Bolt', emoji: '⚡' },
  { key: 'medal', label: 'Medal', emoji: '🥇' },
  { key: 'diamond', label: 'Diamond', emoji: '💎' },
  { key: 'snow', label: 'Snowflake', emoji: '❄️' },
]

export function badgeByKey(key: string | null | undefined): TournamentBadge | null {
  if (!key) return null
  return BADGES.find((b) => b.key === key) ?? null
}

export const DESCRIPTION_MAX = 500

/** Validated, sanitized flair values ready to persist. */
export interface FlairInput {
  bannerImageUrl?: string | null
  description?: string | null
  badge?: string | null
  accentPreset?: string | null
}
export interface NormalizedFlair {
  bannerImageUrl: string | null
  description: string | null
  badge: string | null
  accentPreset: string | null
}

/** Strip ALL markup + control chars from a description; collapse whitespace runs; hard-cap length.
 *  Stored as plain text and rendered escaped (pre-wrap) — never as HTML. Uses a codepoint filter
 *  (no literal control chars in source): keeps tab (9) and newline (10), drops other C0/DEL. */
export function sanitizeDescription(raw: string | null | undefined): string | null {
  if (!raw) return null
  const noTags = String(raw).replace(/<[^>]*>/g, ' ') // drop anything tag-like
  let out = ''
  for (const ch of noTags) {
    const c = ch.codePointAt(0) ?? 0
    if (c === 9 || c === 10 || (c >= 32 && c !== 127)) out += ch
  }
  const collapsed = out.replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
  if (!collapsed) return null
  return collapsed.slice(0, DESCRIPTION_MAX)
}

/** Validate a banner URL. Accepts EITHER an absolute https URL (external image) OR a same-origin
 *  relative path beginning with a single "/" (an upload through the media library). Rejects
 *  http/data/javascript/protocol-relative ("//host") and over-long values. Returns the URL or null. */
export function validateBannerUrl(raw: string | null | undefined): { ok: boolean; url: string | null; error?: string } {
  if (!raw) return { ok: true, url: null }
  const url = String(raw).trim()
  if (!url) return { ok: true, url: null }
  if (url.length > 2048) return { ok: false, url: null, error: 'Banner URL is too long.' }
  // Same-origin relative path (uploaded media). Must start with a single slash, never "//".
  if (url.startsWith('/') && !url.startsWith('//')) return { ok: true, url }
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return { ok: false, url: null, error: 'Enter a valid image URL.' }
  }
  if (parsed.protocol !== 'https:') return { ok: false, url: null, error: 'An external banner image must be an https:// URL.' }
  return { ok: true, url: parsed.toString() }
}

/** Full server-side normalization of flair input to safe, persistable values. */
export function normalizeFlair(input: FlairInput): { ok: boolean; error?: string; value?: NormalizedFlair } {
  const banner = validateBannerUrl(input.bannerImageUrl)
  if (!banner.ok) return { ok: false, error: banner.error }

  const description = sanitizeDescription(input.description)

  let badge: string | null = null
  if (input.badge) {
    if (!BADGES.some((b) => b.key === input.badge)) return { ok: false, error: 'Unknown badge.' }
    badge = input.badge
  }

  let accentPreset: string | null = null
  if (input.accentPreset && input.accentPreset !== DEFAULT_ACCENT_KEY) {
    if (!ACCENT_PRESETS.some((p) => p.key === input.accentPreset)) return { ok: false, error: 'Unknown accent color.' }
    accentPreset = input.accentPreset
  }

  return { ok: true, value: { bannerImageUrl: banner.url, description, badge, accentPreset } }
}
