import 'server-only'
import { hashSecret, verifySecret } from './secret-hash'

/**
 * Hashing for a tournament ACCESS password (the passcode a private tournament requires to register).
 * Delegates to the shared scrypt helper but stores its hash in Tournament.joinPasswordHash — a
 * DIFFERENT field and concept from a per-team JOIN CODE (TournamentTeam.joinCodeHash). Never stores
 * the plaintext, never logs it, never places it in a URL. Only gates registration (account auth is
 * owned by Payload).
 */
export function hashJoinPassword(plain: string): string {
  return hashSecret(plain)
}

/** Constant-time verify. Returns false for any malformed stored value. */
export function verifyJoinPassword(plain: string, stored: string | null | undefined): boolean {
  return verifySecret(plain, stored)
}
