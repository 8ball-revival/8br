import type { Metadata } from 'next'

import { pageMetadata, brandName } from '@/lib/site'

export const metadata: Metadata = pageMetadata({
  title: brandName,
  description:
    'World Cue Championships (WCC) — the home of competitive cue sports. Enter the active Season, follow live brackets and standings, and climb the rankings.',
  path: '/',
})

/**
 * Homepage blank-canvas styling.
 *
 * The footer is rendered by the shared (frontend) layout as a sibling of <main>, so a page cannot
 * remove it from its own subtree. These rules are emitted as part of THIS page's output instead:
 * they exist only while `/` is rendered and disappear as soon as another route takes over, so no
 * other page is affected and the layout itself is untouched.
 *
 * The ambient background layer is deliberately left alone — the homepage shows the same backdrop as
 * every other route. <main> keeps its default transparent background so that fixed layer (z-index -1)
 * shows through unchanged.
 *
 * Server-rendered with the page, so there is no flash and no JS involved.
 */
const BLANK_CANVAS_CSS = `
/* Drop the footer for this route only. */
body > footer { display: none !important; }

/* Tailwind's min-h-screen is 100vh, which on mobile is taller than the visible area
   while the URL bar is showing and leaves a small phantom scroll. With the footer
   hidden there is nothing below <main>, so pin this route to the small-viewport
   height instead (100vh first as the fallback). */
body { min-height: 100vh !important; min-height: 100svh !important; }
`

/**
 * `/` — deliberately blank.
 *
 * The header (logo, navigation, theme control, Sign In) comes from the shared layout and is left
 * exactly as-is, as is the site-wide ambient background. Everything between them is empty: no hero,
 * entrants, rankings, tournament cards, copy, controls, database queries, or loading states.
 */
export default function HomePage() {
  return <style dangerouslySetInnerHTML={{ __html: BLANK_CANVAS_CSS }} />
}
