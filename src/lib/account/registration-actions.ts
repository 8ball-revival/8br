'use server'

import { revalidatePath } from 'next/cache'

import { resolveStaffAccess } from '@/lib/competition/staff-auth'
import { parseRegistrationMode } from './registration-code'
import { getRegistrationConfig, updateRegistrationSettings, type RegistrationConfig } from './registration-settings'

/**
 * Reading and writing the "Create an Account" setting from the admin portal.
 *
 * Both directions are gated by the SAME check the Site Settings page uses, and gated HERE rather than
 * only in the page: a Server Action is a public endpoint, so a page-level check protects the screen
 * and not the operation behind it. Anyone without the permission gets the same refusal whether they
 * are trying to read the code or change it.
 */

/** Head Admin, or an administrator holding the staff-management permission. */
async function requireAdmin(): Promise<{ ok: true } | { ok: false; error: string }> {
  const access = await resolveStaffAccess()
  if (access.status !== 'ok') return { ok: false, error: 'You do not have access to this setting.' }
  if (!access.actor.isHeadAdmin && !access.actor.can('manage_staff')) {
    return { ok: false, error: 'You do not have access to this setting.' }
  }
  return { ok: true }
}

export interface RegistrationSettingsResult {
  ok: boolean
  error?: string
  settings?: RegistrationConfig
}

/** The current mode and code, for the admin screen only. */
export async function readRegistrationSettings(): Promise<RegistrationSettingsResult> {
  const gate = await requireAdmin()
  if (!gate.ok) return { ok: false, error: gate.error }
  return { ok: true, settings: await getRegistrationConfig() }
}

export async function saveRegistrationSettings(
  _prev: RegistrationSettingsResult | null,
  formData: FormData,
): Promise<RegistrationSettingsResult> {
  const gate = await requireAdmin()
  if (!gate.ok) return { ok: false, error: gate.error }

  const mode = parseRegistrationMode(String(formData.get('registrationMode') ?? ''))
  const code = String(formData.get('registrationCode') ?? '')

  const result = await updateRegistrationSettings({ mode, code })
  if (!result.ok) return { ok: false, error: result.error }

  // The registration page renders from this setting, so it has to stop serving the previous mode.
  revalidatePath('/register')
  revalidatePath('/staff/settings')

  return { ok: true, settings: await getRegistrationConfig() }
}
