'use client'

import { useCallback, useSyncExternalStore } from 'react'

import {
  PINS_KEY, PREF_KEY, readDevicePrefs, readPins,
  DEFAULT_DENSITY, type Density, type DevicePrefs,
} from './rankings-columns'

/**
 * The two things the Rankings page keeps on the DEVICE rather than on the account: pinned players,
 * and the preferred column layout.
 *
 * `localStorage` is external state, so it is read through `useSyncExternalStore` rather than copied
 * into React state inside an effect. Three reasons, in order of how much they matter:
 *
 *  1. Correctness on arrival. An effect that calls setState runs AFTER the first paint, so the page
 *     renders once without the reader's pins and then again with them. useSyncExternalStore gives
 *     the server a defined snapshot and the client the real value, with no cascading render.
 *  2. Two tabs stay in step. The `storage` event fires in every other tab, so pinning someone in
 *     one window updates the other instead of the two quietly disagreeing until a reload.
 *  3. It is the shape React 19 asks for, and the compiler enforces.
 *
 * Snapshots are CACHED because useSyncExternalStore compares them by identity: parsing the JSON
 * afresh on every call returns a new object each time, React sees a changed store on every render,
 * and the page spins. The cache is invalidated only when something actually writes.
 */

type Listener = () => void

function makeStore<T>(key: string, parse: (raw: string | null) => T, serverValue: T) {
  const listeners = new Set<Listener>()
  let cache: T | null = null
  let cachedRaw: string | null | undefined

  const read = (): T => {
    if (typeof window === 'undefined') return serverValue
    let raw: string | null = null
    try { raw = window.localStorage.getItem(key) } catch { raw = null }
    // Re-parse only when the underlying text changed, so the snapshot keeps its identity.
    if (cache === null || raw !== cachedRaw) {
      cachedRaw = raw
      cache = parse(raw)
    }
    return cache
  }

  const emit = () => { for (const l of listeners) l() }

  return {
    subscribe(listener: Listener) {
      listeners.add(listener)
      // Another tab writing the same key.
      const onStorage = (e: StorageEvent) => {
        if (e.key === key || e.key === null) { cache = null; listener() }
      }
      window.addEventListener('storage', onStorage)
      return () => { listeners.delete(listener); window.removeEventListener('storage', onStorage) }
    },
    getSnapshot: read,
    getServerSnapshot: () => serverValue,
    write(value: unknown) {
      try { window.localStorage.setItem(key, JSON.stringify(value)) } catch { /* private mode, quota */ }
      cache = null
      emit()
    },
  }
}

/** Server snapshots are module constants so their identity is stable across renders. */
const NO_PINS: string[] = []
const DEFAULT_PREFS: DevicePrefs = { density: DEFAULT_DENSITY, columns: null }

const pinStore = makeStore<string[]>(PINS_KEY, (raw) => readPins({ getItem: () => raw }), NO_PINS)
const prefStore = makeStore<DevicePrefs>(
  PREF_KEY,
  (raw) => readDevicePrefs({ getItem: () => raw }) ?? DEFAULT_PREFS,
  DEFAULT_PREFS,
)

export function usePins(): [string[], (playerId: string) => void, () => void] {
  const pins = useSyncExternalStore(pinStore.subscribe, pinStore.getSnapshot, pinStore.getServerSnapshot)
  const toggle = useCallback((playerId: string) => {
    const current = pinStore.getSnapshot()
    pinStore.write(current.includes(playerId)
      ? current.filter((id) => id !== playerId)
      : [...current, playerId])
  }, [])
  const clear = useCallback(() => pinStore.write([]), [])
  return [pins, toggle, clear]
}

export function useDevicePrefs(): [DevicePrefs, (next: { density: Density; columns: string[] | null }) => void] {
  const prefs = useSyncExternalStore(prefStore.subscribe, prefStore.getSnapshot, prefStore.getServerSnapshot)
  const write = useCallback((next: { density: Density; columns: string[] | null }) => {
    prefStore.write(next)
  }, [])
  return [prefs, write]
}
