import 'server-only'

import { prisma } from '@/lib/prisma'

/**
 * Who may put themselves into a competition: nobody, or any signed-in member.
 *
 * ── Deliberately NOT the account-creation setting ────────────────────────────────────────────────
 * `registrationMode` in `account/registration-settings` decides whether a stranger may create an
 * account. This decides whether an existing member may enter a Season or Tournament. They are
 * different questions with different risks — a site can want open signup and admin-run competitions,
 * or a closed membership that runs itself — so they are separate keys and neither reads the other.
 * Coupling them would mean opening one to open the other.
 *
 * ── Admin Only is the default, and the default matters ───────────────────────────────────────────
 * An unset value, an unreadable table, a typo in the stored string: all answer ADMIN_ONLY. The
 * failure mode of guessing wrong in that direction is that an administrator adds an entrant by hand.
 * Guessing wrong the other way puts a public Register button on every open competition on the site.
 */

export type CompetitionRegistrationMode = 'ADMIN_ONLY' | 'MEMBERS_ALLOWED'

export const COMPETITION_REGISTRATION_KEY = 'competitionRegistrationMode'

export function parseCompetitionRegistrationMode(v: string | null | undefined): CompetitionRegistrationMode {
  return v === 'MEMBERS_ALLOWED' ? 'MEMBERS_ALLOWED' : 'ADMIN_ONLY'
}

/** The current policy. Safe to call from any surface: it carries no secret. */
export async function getCompetitionRegistrationMode(): Promise<CompetitionRegistrationMode> {
  try {
    const rows = await prisma.$queryRawUnsafe<{ value: string }[]>(
      `SELECT value FROM public.site_setting WHERE key = $1 LIMIT 1`, COMPETITION_REGISTRATION_KEY,
    )
    return parseCompetitionRegistrationMode(rows[0]?.value)
  } catch {
    return 'ADMIN_ONLY'
  }
}

/**
 * Whether THIS record should offer a public Register control right now.
 *
 * Two conditions, both required. The policy has to allow it at all, and the record has to be open to
 * entries — a completed Season does not become joinable because somebody flipped a global switch.
 * Every public surface asks this one function rather than reasoning about the policy itself, so the
 * answer cannot differ between the Season page and the Tournament page.
 */
export async function publicRegistrationOpen(opts: {
  lifecycleState: string
  /** Tournaments carry a separate registration status; Seasons express it through the lifecycle. */
  registrationStatus?: string | null
}): Promise<boolean> {
  if ((await getCompetitionRegistrationMode()) !== 'MEMBERS_ALLOWED') return false
  if (opts.registrationStatus != null) return opts.registrationStatus === 'OPEN'
  return opts.lifecycleState === 'REGISTRATION_OPEN'
}

/**
 * Set the policy. Administrative, and audited by the caller.
 *
 * Switching back to ADMIN_ONLY removes the public controls and nothing else: existing entrants are
 * entrants, and a competition somebody already joined is not un-joined by a change of policy.
 */
export async function setCompetitionRegistrationMode(mode: CompetitionRegistrationMode): Promise<void> {
  await prisma.$executeRawUnsafe(
    `INSERT INTO public.site_setting (key, value, "updatedAt") VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, "updatedAt" = now()`,
    COMPETITION_REGISTRATION_KEY, mode,
  )
}
