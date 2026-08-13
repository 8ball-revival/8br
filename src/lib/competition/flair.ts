/**
 * Curated, on-brand per-tournament FLAIR — the SAFE replacement for MyLeague's raw-HTML/free-color
 * customizer. What remains is a closed, validated set: an approved badge icon set and plain-text
 * descriptions. NO raw HTML/CSS/JS, no data: URLs, no arbitrary colors.
 *
 * NOTE: the per-tournament hero banner + accent-color presets were removed — color is now a personal
 * account theme (see src/lib/theme), not a tournament-level setting. Shared by the create form, the
 * manage page, and the public tournament page so validation is identical everywhere.
 *
 * This module is import-safe from both server and client (no 'server-only', no node deps).
 */

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
  description?: string | null
  badge?: string | null
}
export interface NormalizedFlair {
  description: string | null
  badge: string | null
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

/** Full server-side normalization of flair input to safe, persistable values. */
export function normalizeFlair(input: FlairInput): { ok: boolean; error?: string; value?: NormalizedFlair } {
  const description = sanitizeDescription(input.description)

  let badge: string | null = null
  if (input.badge) {
    if (!BADGES.some((b) => b.key === input.badge)) return { ok: false, error: 'Unknown badge.' }
    badge = input.badge
  }

  return { ok: true, value: { description, badge } }
}
