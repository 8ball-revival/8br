'use server'

import { revalidatePath } from 'next/cache'
import { getPayload } from 'payload'
import config from '@payload-config'

import { getCurrentUser } from '@/lib/account/auth'
import { recordAudit } from '@/lib/competition/audit'
import { areColorsTooSimilar, deriveTheme, validateThemePreference } from './theme'

export interface SaveThemeResult { ok: boolean; error?: string; warnings?: string[] }

/**
 * Persist the SIGNED-IN player's own color theme. The target is always the caller's own account id
 * (read from their session), so this can never change another player's theme — an Admin using it
 * only restyles their own view. Validated server-side (rejects unknown themes, malformed/out-of-range
 * colors, css/markup injection). The change is recorded once in the account activity log.
 */
export async function saveThemePreference(input: unknown): Promise<SaveThemeResult> {
  const user = await getCurrentUser()
  if (!user) return { ok: false, error: 'You must be signed in to change your theme.' }

  const res = validateThemePreference(input)
  if (!res.ok || !res.pref) return { ok: false, error: res.error ?? 'Invalid theme.' }
  const pref = res.pref
  if (pref.type === 'CUSTOM' && areColorsTooSimilar(pref.mainColor ?? '', pref.accentColor ?? ''))
    return { ok: false, error: 'Choose two more distinct colors.' }
  const warnings = deriveTheme(pref).warnings

  const payload = await getPayload({ config: await config })
  await payload.update({
    collection: 'users',
    id: user.id,
    data: {
      themeType: pref.type,
      themeMainColor: pref.type === 'CUSTOM' ? pref.mainColor : null,
      themeAccentColor: pref.type === 'CUSTOM' ? pref.accentColor : null,
    },
    overrideAccess: true, // self-target only; field access still blocks cross-account writes via the API
  })

  await recordAudit(
    { userId: Number(user.id), username: user.username },
    { action: 'account.theme.update', entity: 'User', entityId: user.id, oldValue: user.theme, newValue: pref },
  ).catch(() => {})

  revalidatePath('/', 'layout') // re-render server HTML with the new theme on <html>
  return { ok: true, warnings }
}
