/** Pure, unit-testable account validation (shared by server actions). */

export const USERNAME_MIN = 3
export const USERNAME_MAX = 24
export const PASSWORD_MIN = 8

/**
 * The temporary password every staff-created account starts on.
 *
 * It is deliberately fixed and shown in the form so whoever creates the account can pass it on. That
 * also means it is a SHARED secret: any account still on it can be signed into by anyone who knows
 * it, so members should change it from My Account at first sign-in.
 */
export const TEMPORARY_PASSWORD = 'Luna8ear'

/**
 * Address used when an account is created without one.
 *
 * Payload authenticates on email, so a row must have one, but staff creating a member should not have
 * to invent it. `.invalid` is reserved by RFC 2606 and can never resolve, so a generated address can
 * never reach a real person. A member can set a real address later from My Account.
 */
export function generatedEmailFor(cueverseId: string): string {
  /*
   * The handle has to be made SAFE for the local part of an address.
   *
   * CueVerse IDs are free-form now, and plenty of real ones are themselves email addresses —
   * "uslander@sbcglobal.net". Pasting one straight in produced
   * "uslander@sbcglobal.net@member.8br.invalid": two at-signs, not an address, rejected by Payload's
   * email validation, and reported to staff as "could not create the account".
   *
   * So everything outside the safe set becomes a hyphen, runs are collapsed, and the ends are
   * trimmed. The result only has to be unique and well-formed — the domain is reserved by RFC 2606
   * and can never receive mail, and members never see this address. Their identity is the CueVerse
   * ID, which is stored exactly as typed.
   */
  const local = cueverseLoginKey(cueverseId)
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 64)
  return `${local || 'member'}@member.8br.invalid`
}

/** True for an address minted by {@link generatedEmailFor}. */
export function isGeneratedEmail(email: string | null | undefined): boolean {
  return /@member\.8br\.invalid$/i.test((email ?? '').trim())
}
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

/**
 * The only characters a CueVerse ID cannot contain.
 *
 * Real handles are full of things a tidy charset would reject — "slamballmanlita@sbcglobal.net",
 * "xlx_master_of_tables_xlx", "dp.gary" — and the archive holds stranger ones still. So the rule is
 * inverted: everything is allowed except the few characters that would genuinely break something.
 *
 * A forward slash is excluded because a profile lives at /players/<id>, which is ONE path segment —
 * an id containing a slash would split into two and never resolve. A backslash goes with it. Control
 * characters are excluded because they cannot be typed deliberately and would corrupt any display
 * they reached. Nothing else is refused: @ + ! # spaces, accents and emoji all pass.
 */
const CUEVERSE_FORBIDDEN = new RegExp('[/\\\\\\u0000-\\u001f\\u007f]')

/** A bound, not a shape. Long enough for an email-style handle. */
export const CUEVERSE_MAX = 60

/** Trim accidental leading/trailing spaces while preserving everything the member actually typed. */
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
  if (v.length > CUEVERSE_MAX) return `CueVerse ID is too long (max ${CUEVERSE_MAX} characters).`
  if (CUEVERSE_FORBIDDEN.test(v)) return 'CueVerse ID cannot contain a slash or a backslash.'
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
