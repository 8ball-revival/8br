/**
 * Persistence mapping for the personal theme: a stored user record (Payload fields) ↔ a validated
 * ThemePreference. Anything malformed collapses to WCC Default, so a bad row can never render an
 * unreadable or broken theme. Pure + isomorphic.
 */
import { validateThemePreference, type ThemePreference, type ThemeType } from './theme'

export type { ThemePreference, ThemeType }

export const WCC_DEFAULT_PREFERENCE: ThemePreference = { type: 'WCC_DEFAULT', mainColor: null, accentColor: null }

/** Map a stored user record's theme columns into a safe, validated preference (defaults to WCC). */
export function normalizeThemeFromRecord(rec: {
  themeType?: string | null
  themeMainColor?: string | null
  themeAccentColor?: string | null
}): ThemePreference {
  const res = validateThemePreference({
    type: rec.themeType ?? 'WCC_DEFAULT',
    mainColor: rec.themeMainColor ?? undefined,
    accentColor: rec.themeAccentColor ?? undefined,
  })
  return res.ok && res.pref ? res.pref : WCC_DEFAULT_PREFERENCE
}
