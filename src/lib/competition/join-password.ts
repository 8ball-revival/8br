import 'server-only'
import { prisma } from '@/lib/prisma'
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

/**
 * Validate a tournament join password against the tournament's access mode. Returns null when OK (open
 * tournament, or correct password) or an error message when a private tournament's password is wrong.
 * Used by EVERY registration path (individual, random-team, and pick-team create/join/free-agent).
 */
export function joinPasswordError(accessMode: string | null | undefined, joinPasswordHash: string | null | undefined, password: string | null | undefined): string | null {
  if (accessMode !== 'PASSWORD') return null
  return verifyJoinPassword((password ?? '').trim(), joinPasswordHash) ? null : 'Incorrect join password for this private Cup.'
}

/** DB-backed gate: loads the tournament's access mode and validates the supplied password. Returns an
 *  error message when a private tournament's password is missing/wrong, else null. */
export async function joinPasswordGate(tournamentId: number, password: string | null | undefined): Promise<string | null> {
  const t = await prisma.tournament.findUnique({ where: { id: tournamentId }, select: { accessMode: true, joinPasswordHash: true } })
  return joinPasswordError(t?.accessMode, t?.joinPasswordHash, password)
}
