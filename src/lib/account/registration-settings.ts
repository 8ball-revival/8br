import 'server-only'
import { createHash } from 'node:crypto'
import { headers } from 'next/headers'

import { prisma } from '@/lib/prisma'
import {
  codesMatch, isUsableCode, parseRegistrationMode,
  type RegistrationMode,
} from './registration-code'

/**
 * The "Create an Account" setting: whether anyone may sign up, or only people holding a code.
 *
 * Stored as two rows in `site_setting`, the key/value table the Site Settings screen already uses. The
 * mode is ordinary configuration. The CODE is not, and the split below is the whole design:
 *
 *   getRegistrationMode()   — safe anywhere, returns only PUBLIC or PRIVATE
 *   getRegistrationConfig() — includes the code, and is only ever called behind an admin check
 *
 * The registration page renders from the first. That is what keeps the code out of the public page's
 * HTML, its server-rendered props and its RSC payload: the value never enters the component tree at
 * all, so there is nothing to leak, rather than something leaked-but-hidden. The code is also
 * deliberately absent from SETTINGS_FIELDS, so the generic settings reader cannot return it either.
 *
 * Verification happens on the server, in the registration action. The client-side field is a
 * convenience; posting the form without it, or with anything else, still goes through checkCode().
 */

export const REGISTRATION_MODE_KEY = 'registrationMode'
export const REGISTRATION_CODE_KEY = 'registrationCode'

/** A generous ceiling for a person typing a code, and a low one for a script trying every word. */
export const CODE_ATTEMPT_LIMIT = { perWindow: 10, windowMinutes: 15 }

async function readSetting(key: string): Promise<string | null> {
  const rows = await prisma.$queryRawUnsafe<{ value: string }[]>(
    `SELECT value FROM public.site_setting WHERE key = $1 LIMIT 1`, key,
  )
  return rows[0]?.value ?? null
}

/**
 * The mode alone — never the code.
 *
 * Public callers use this. It answers exactly one question: should the registration form show a code
 * field and require one?
 */
export async function getRegistrationMode(): Promise<RegistrationMode> {
  try {
    return parseRegistrationMode(await readSetting(REGISTRATION_MODE_KEY))
  } catch {
    // A missing table or an unreachable database must not take the signup page down, and must not
    // silently lock it either. Public is the safe default in both directions.
    return 'PUBLIC'
  }
}

export interface RegistrationConfig {
  mode: RegistrationMode
  /** Plain text, by design — the admin screen displays it. Never returned to a public surface. */
  code: string
}

/** Mode AND code. Call only after an administrator check; see updateRegistrationSettings. */
export async function getRegistrationConfig(): Promise<RegistrationConfig> {
  const [mode, code] = await Promise.all([
    readSetting(REGISTRATION_MODE_KEY),
    readSetting(REGISTRATION_CODE_KEY),
  ])
  return { mode: parseRegistrationMode(mode), code: code ?? '' }
}

export interface UpdateResult { ok: boolean; error?: string }

/**
 * Persist the setting.
 *
 * Private with a blank code is refused: it would present a required field that nothing could ever
 * satisfy, locking registration completely while appearing merely restricted. `codesMatch` also fails
 * closed on a blank configured code, so the two guards agree even if a row were edited by hand.
 *
 * Switching to Public keeps the stored code rather than clearing it, so an administrator can toggle
 * back and forth during launch without retyping it.
 */
export async function updateRegistrationSettings(
  next: { mode: RegistrationMode; code: string },
): Promise<UpdateResult> {
  const mode = parseRegistrationMode(next.mode)
  const code = (next.code ?? '').trim()

  if (mode === 'PRIVATE' && !isUsableCode(code)) {
    return { ok: false, error: 'Private mode needs a registration code. Enter one, or choose Public.' }
  }
  if (code.length > 200) {
    return { ok: false, error: 'That registration code is too long.' }
  }

  await prisma.$transaction(async (tx) => {
    const put = (key: string, value: string) => tx.$executeRawUnsafe(
      `INSERT INTO public.site_setting(key, value, "updatedAt") VALUES ($1, $2, CURRENT_TIMESTAMP)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, "updatedAt" = CURRENT_TIMESTAMP`,
      key, value,
    )
    await put(REGISTRATION_MODE_KEY, mode)
    if (code) await put(REGISTRATION_CODE_KEY, code)
  })

  return { ok: true }
}

// --------------------------------------------------------------------------- attempt limiting

/**
 * A one-way, salted fingerprint of the caller.
 *
 * The address itself is never stored. PAYLOAD_SECRET is reused as the salt so the fingerprints are
 * meaningless outside this deployment and cannot be reversed by hashing a list of addresses.
 */
async function clientFingerprint(): Promise<string> {
  let raw = 'unknown'
  try {
    const h = await headers()
    raw = h.get('x-forwarded-for')?.split(',')[0]?.trim() || h.get('x-real-ip') || 'unknown'
  } catch {
    // Outside a request (a test, a script): everything shares one bucket, which is correct — there is
    // no caller to distinguish.
  }
  return createHash('sha256').update(`${process.env.PAYLOAD_SECRET ?? 'dev'}:${raw}`).digest('hex')
}

/**
 * Check a submitted code, recording failures against a modest rate limit.
 *
 * Only failures are counted, so somebody who types their code correctly is never limited, and a
 * successful signup clears nothing that matters. Returns a discriminated result rather than a boolean
 * so the caller can tell "wrong code" from "stop trying" without inspecting a message.
 */
export type CodeCheck =
  | { outcome: 'ok' }
  | { outcome: 'rejected' }
  | { outcome: 'rate-limited' }

export async function checkRegistrationCode(submitted: string | null | undefined): Promise<CodeCheck> {
  const { code } = await getRegistrationConfig()
  const fingerprint = await clientFingerprint()
  const since = new Date(Date.now() - CODE_ATTEMPT_LIMIT.windowMinutes * 60_000)

  const recent = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
    `SELECT count(*)::bigint AS n FROM public.registration_attempt
      WHERE client_hash = $1 AND "createdAt" >= $2`,
    fingerprint, since,
  ).catch(() => [{ n: BigInt(0) }])

  if (Number(recent[0]?.n ?? 0) >= CODE_ATTEMPT_LIMIT.perWindow) return { outcome: 'rate-limited' }

  if (codesMatch(submitted, code)) return { outcome: 'ok' }

  await prisma.$executeRawUnsafe(
    `INSERT INTO public.registration_attempt(client_hash) VALUES ($1)`, fingerprint,
  ).catch(() => {})

  return { outcome: 'rejected' }
}
