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
