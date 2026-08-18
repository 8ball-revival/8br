/**
 * The registration-code comparison, on its own.
 *
 * Pure and dependency-free so it can be tested directly and so the rule lives in exactly one place —
 * the server action, the admin validation and the tests all compare codes the same way.
 *
 * Two deliberate leniencies, both about people rather than security. A code is something a member is
 * told in Discord or reads off a message, so it arrives with a stray space or the wrong capitalisation
 * far more often than it arrives wrong. Neither of those should turn into "that code is not correct".
 * The code is a soft gate on who may sign up, not a secret protecting anything, so being forgiving
 * about whitespace and case costs nothing.
 */

export type RegistrationMode = 'PUBLIC' | 'PRIVATE'

export const REGISTRATION_MODES: RegistrationMode[] = ['PUBLIC', 'PRIVATE']

/** The label shown to administrators, exactly as specified. */
export const REGISTRATION_SETTING_LABEL = 'Create an Account'

export function parseRegistrationMode(value: string | null | undefined): RegistrationMode {
  const v = (value ?? '').trim().toUpperCase()
  // Anything unrecognised means Public. A corrupted or missing value must not silently lock the site
  // into Private, where nobody could sign up and the reason would be invisible.
  return v === 'PRIVATE' ? 'PRIVATE' : 'PUBLIC'
}

/**
 * The comparable form of a code.
 *
 * Outer whitespace goes, internal runs collapse to one space (a pasted code sometimes carries a line
 * break), and case is folded. Unicode is normalised first so a code typed with a composed accent
 * matches the same code typed with a combining one.
 */
export function normalizeCode(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase()
}

/** Is this a code an administrator is allowed to save? */
export function isUsableCode(value: string | null | undefined): boolean {
  return normalizeCode(value).length > 0
}

/**
 * Does the submitted code match the configured one?
 *
 * A blank configured code never matches anything, including a blank submission. Saving Private with no
 * code is already rejected, but if one ever reached the database it must fail closed — an empty
 * configured code that matched an empty submission would leave registration wide open while the admin
 * screen said Private.
 */
export function codesMatch(submitted: string | null | undefined, configured: string | null | undefined): boolean {
  const want = normalizeCode(configured)
  if (want.length === 0) return false
  return normalizeCode(submitted) === want
}

/** Shown when a code is missing or wrong. Deliberately identical for both, and never echoes the code. */
export const CODE_REJECTED_MESSAGE =
  'That registration code is not correct. Check the code you were given and try again.'

export const CODE_REQUIRED_MESSAGE =
  'A registration code is required to create an account right now. Enter the code you were given.'

export const CODE_RATE_LIMITED_MESSAGE =
  'Too many attempts. Wait a few minutes and try again.'
