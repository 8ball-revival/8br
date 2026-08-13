import { deriveTheme, dataThemeAttr, validateThemePreference, type ThemePreference } from './theme'

/**
 * Logged-out theme persistence: a visitor's choice is stored in THIS browser (localStorage) and
 * applied client-side. When they sign in, the account preference becomes the source of truth (the
 * boot script + layout skip localStorage while `data-theme-source="account"` is set). Client-only —
 * every call guards `window`.
 *
 * The stored payload includes the pre-derived `attr` + `vars` so the inline boot script (which can't
 * import the engine) can apply them with zero flash on the next load.
 */
export const LOCAL_THEME_KEY = 'wcc-theme'

export function writeLocalTheme(pref: ThemePreference): void {
  if (typeof window === 'undefined') return
  const { vars } = deriveTheme(pref)
  const payload = {
    type: pref.type,
    mainColor: pref.mainColor ?? null,
    accentColor: pref.accentColor ?? null,
    attr: dataThemeAttr(pref.type),
    vars,
  }
  try { window.localStorage.setItem(LOCAL_THEME_KEY, JSON.stringify(payload)) } catch { /* storage disabled */ }
}

export function readLocalTheme(): ThemePreference | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(LOCAL_THEME_KEY)
    if (!raw) return null
    const t = JSON.parse(raw) as { type?: string; mainColor?: string | null; accentColor?: string | null }
    const res = validateThemePreference({ type: t.type, mainColor: t.mainColor ?? undefined, accentColor: t.accentColor ?? undefined })
    return res.ok && res.pref ? res.pref : null
  } catch {
    return null
  }
}

export function clearLocalTheme(): void {
  if (typeof window === 'undefined') return
  try { window.localStorage.removeItem(LOCAL_THEME_KEY) } catch { /* ignore */ }
}
