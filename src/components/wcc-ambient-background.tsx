'use client'

import { useEffect } from 'react'

/**
 * Ambient WCC background — a single fixed layer behind the entire app: a static obsidian image with
 * two slowly-animated overlays (a drifting scoreboard-dot grid and a breathing crimson glow). Purely
 * decorative: pointer-events none, aria-hidden, never focusable, never scrolls the page.
 *
 * All visuals + animation live in globals.css (`.wcc-ambient`), scoped to the DARK/default theme only
 * (hidden under `.light`) and gated by `prefers-reduced-motion` and viewport width. This component
 * only toggles `data-ambient-motion` on <html> so the overlay animations PAUSE while the tab is hidden
 * and resume on return — it never touches `data-theme`/the theme class.
 */
export function WccAmbientBackground() {
  useEffect(() => {
    const root = document.documentElement
    const sync = () => root.setAttribute('data-ambient-motion', document.hidden ? 'paused' : 'running')
    sync()
    document.addEventListener('visibilitychange', sync)
    return () => {
      document.removeEventListener('visibilitychange', sync)
      root.removeAttribute('data-ambient-motion')
    }
  }, [])

  return <div className="wcc-ambient" aria-hidden="true" />
}
