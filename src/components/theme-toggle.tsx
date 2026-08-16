'use client'

import { useSyncExternalStore } from 'react'
import { Moon, Sun } from 'lucide-react'

import { Button } from '@/components/ui/button'

const THEME_EVENT = '8br-theme-change'

function subscribe(callback: () => void) {
  window.addEventListener(THEME_EVENT, callback)
  return () => window.removeEventListener(THEME_EVENT, callback)
}

// Read the current theme straight from the DOM (external system) — no setState in
// an effect, no hydration mismatch (server snapshot = dark default).
function getSnapshot() {
  return document.documentElement.classList.contains('light')
}
function getServerSnapshot() {
  return false
}

/** Dark (default) ↔ light theme toggle. Persists to localStorage; no flash (see layout script). */
export function ThemeToggle() {
  const isLight = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)

  function toggle() {
    const next = !isLight
    document.documentElement.classList.toggle('light', next)
    try {
      localStorage.setItem('8br-theme', next ? 'light' : 'dark')
    } catch {
      /* ignore */
    }
    window.dispatchEvent(new Event(THEME_EVENT))
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggle}
      aria-label={isLight ? 'Switch to dark theme' : 'Switch to light theme'}
      title="Toggle theme"
    >
      {isLight ? <Moon className="size-4" /> : <Sun className="size-4" />}
    </Button>
  )
}
