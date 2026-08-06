/** Pure, unit-testable account validation (shared by server actions). */

export const USERNAME_MIN = 3
export const USERNAME_MAX = 24
export const PASSWORD_MIN = 8
const USERNAME_RE = /^[a-z0-9_-]{3,24}$/
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Safe case normalization only (trim + lowercase). */
export function normalizeUsername(input: string): string {
  return (input ?? '').trim().toLowerCase()
}

/** Returns an error string, or null if valid. Validates the normalized form. */
export function validateUsername(input: string): string | null {
  const n = normalizeUsername(input)
  if (!n) return 'User ID is required.'
  if (!USERNAME_RE.test(n))
    return `User ID must be ${USERNAME_MIN}–${USERNAME_MAX} characters: letters, numbers, underscores, or hyphens.`
  return null
}

export function validateEmail(input: string): string | null {
  const v = (input ?? '').trim()
  if (!v) return 'Email is required.'
  if (!EMAIL_RE.test(v)) return 'Enter a valid email address.'
  return null
}

export function validatePassword(input: string): string | null {
  if (!input || input.length < PASSWORD_MIN) return `Password must be at least ${PASSWORD_MIN} characters.`
  return null
}

// --- Public profile identity (collected at registration; one account = one profile) ---

export function validatePreferredName(input: string): string | null {
  const v = (input ?? '').trim()
  if (!v) return 'Preferred Name is required.'
  if (v.length > 40) return 'Preferred Name is too long (max 40 characters).'
  return null
}

const CUEVERSE_RE = /^[a-z0-9_.\-]{2,40}$/i

/** Trim accidental leading/trailing spaces while preserving the user's capitalization and
 *  valid punctuation (dots/underscores/hyphens) for public display. */
export function normalizeCueverseId(input: string): string {
  return (input ?? '').trim()
}

/** Canonical (case-insensitive) form used for uniqueness + login matching. Never displayed. */
export function cueverseLoginKey(input: string): string {
  return normalizeCueverseId(input).toLowerCase()
}

export function validateCueverseId(input: string): string | null {
  const v = normalizeCueverseId(input)
  if (!v) return 'CueVerse ID is required.'
  if (!CUEVERSE_RE.test(v)) return 'CueVerse ID must be 2–40 characters: letters, numbers, dots, underscores, or hyphens.'
  return null
}

export function validateDiscord(input: string): string | null {
  const v = (input ?? '').trim()
  if (!v) return 'Discord is required.'
  if (v.length > 64) return 'Discord value is too long.'
  return null
}

export function validateTimeZone(input: string): string | null {
  const v = (input ?? '').trim()
  if (!v) return 'Time Zone is required.'
  // Free-form: the user types whatever they want (e.g. "MST"). Only bound the length.
  if (v.length > 60) return 'Time zone is too long.'
  return null
}
