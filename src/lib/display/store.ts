'use client'

import { useCallback, useMemo, useSyncExternalStore } from 'react'

import {
  DISPLAY_DEFAULTS, DISPLAY_KEY, LEGACY_HUD_KEY,
  applyDisplay, migrateLegacyHud, parseDisplay,
  type DisplaySettings,
} from './settings'

/**
 * The stored display settings, as a subscribable value.
 *
 * ── Why the components hold no copy ──────────────────────────────────────────────────────────────
 * An earlier version seeded `useState` from storage inside an effect, which meant the panel held a
 * SECOND copy of a value that already existed in localStorage and on <html> — so the copy had to be
 * kept in step by hand, and the mount-time sync was a synchronous setState inside an effect, the
 * classic cascading render. Reading the store directly removes the copy: there is one value, every
 * component renders whatever it currently says, and a change made in another TAB arrives through
 * exactly the same path as a change made here.
 *
 * ── Why the snapshot is a string ─────────────────────────────────────────────────────────────────
 * `getSnapshot` must return a stable reference or React re-renders forever, and parsing would mint a
 * fresh object on every call. The raw string compares by value; the parse happens once per change,
 * in a memo.
 */

const listeners = new Set<() => void>()

function subscribe(cb: () => void) {
  listeners.add(cb)
  window.addEventListener('storage', cb)
  return () => { listeners.delete(cb); window.removeEventListener('storage', cb) }
}

function getSnapshot(): string {
  try { return localStorage.getItem(DISPLAY_KEY) ?? '' } catch { return '' }
}

/*
 * The server renders the DEFAULT appearance, always.
 *
 * It cannot know what a browser has stored, and guessing produces a hydration mismatch. The pre-paint
 * script in <head> has already applied the real settings to <html> by the time React runs, so the
 * page is never seen in the default state — only the React tree briefly describes it that way, and
 * the settings live on the document rather than in the markup, so nothing visible depends on it.
 */
const getServerSnapshot = () => ''

/** Read the settings once, outside React — for the migration and for imperative callers. */
export function readDisplay(): DisplaySettings {
  return parseDisplay(getSnapshot())
}

/**
 * Persist and apply in one step, then tell every subscriber.
 *
 * Applying BEFORE writing is deliberate: if storage throws — private mode, a full quota — the
 * setting still takes effect for this session rather than the whole interaction failing silently.
 * A display preference must never be able to break the page it is decorating.
 */
export function writeDisplay(next: DisplaySettings | null): void {
  const value = next ?? DISPLAY_DEFAULTS
  if (typeof document !== 'undefined') applyDisplay(document.documentElement, value)
  try {
    if (next) localStorage.setItem(DISPLAY_KEY, JSON.stringify(next))
    else localStorage.removeItem(DISPLAY_KEY)
  } catch { /* private mode: applied for this session, not remembered */ }
  listeners.forEach((cb) => cb())
}

/**
 * Bring an old `8br-hud` configuration forward, once.
 *
 * Runs only when Display Lab has nothing stored and the old panel does, so it cannot overwrite a
 * newer choice, and it cannot run twice: the first write creates the new key, which is the guard.
 * The old key is left in place rather than deleted — it costs nothing, and removing a reader's data
 * to tidy up is not this function's business.
 */
export function migrateOnce(): void {
  try {
    if (localStorage.getItem(DISPLAY_KEY)) return
    const legacy = migrateLegacyHud(localStorage.getItem(LEGACY_HUD_KEY))
    if (!legacy) return
    writeDisplay({ ...DISPLAY_DEFAULTS, ...legacy })
  } catch { /* storage unavailable: nothing to migrate from */ }
}

/** The panel's hook: current settings, and a setter that persists and applies. */
export function useDisplaySettings(): [DisplaySettings, (next: DisplaySettings) => void, () => void] {
  const raw = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
  const settings = useMemo(() => parseDisplay(raw), [raw])
  const set = useCallback((next: DisplaySettings) => writeDisplay(next), [])
  const reset = useCallback(() => writeDisplay(null), [])
  return [settings, set, reset]
}
