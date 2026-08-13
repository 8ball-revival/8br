import { deriveTheme, dataThemeAttr, THEME_VARS, type ThemePreference } from './theme'

/**
 * Imperatively apply a theme preference to the document root (client-only; call inside effects/handlers).
 * Used for live preview + immediate apply. Any theme var not in the derived set is REMOVED so the
 * value falls back to the :root default — this is how WCC Default cleanly clears a prior custom theme.
 */
export function applyThemeToRoot(pref: ThemePreference): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  const { vars } = deriveTheme(pref)
  for (const name of THEME_VARS) {
    const v = vars[name]
    if (v) root.style.setProperty(name, v)
    else root.style.removeProperty(name)
  }
  root.setAttribute('data-theme', dataThemeAttr(pref.type))
}
