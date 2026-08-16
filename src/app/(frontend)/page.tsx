import type { Metadata } from 'next'
import Image from 'next/image'

import { pageMetadata, brandName } from '@/lib/site'

export const metadata: Metadata = pageMetadata({
  title: brandName,
  description:
    'World Cue Championships (WCC) — the home of competitive cue sports. Enter the active Season, follow live brackets and standings, and climb the rankings.',
  path: '/',
})

/**
 * Homepage-only styling.
 *
 * The footer is rendered by the shared (frontend) layout as a sibling of <main>, so a page cannot
 * remove it from its own subtree. These rules are emitted as part of THIS page's output instead:
 * they exist only while `/` is rendered and disappear as soon as another route takes over, so no
 * other page is affected and the layout itself is untouched.
 *
 * Server-rendered with the page, so there is no flash and no JS involved.
 */
const HOME_CSS = `
/* Drop the footer for this route only. */
body > footer { display: none !important; }

/* Tailwind's min-h-screen is 100vh, which on mobile is taller than the visible area
   while the URL bar is showing and leaves a small phantom scroll. With the footer
   hidden there is nothing below <main>, so pin this route to the small-viewport
   height instead (100vh first as the fallback). This is a floor, not a cap — the
   page still grows normally if content exceeds the viewport. */
body { min-height: 100vh !important; min-height: 100svh !important; }
`

/**
 * `/` — the hero banner, and nothing else yet.
 *
 * The header comes from the shared layout and is untouched. Directly beneath it sits the full-bleed
 * banner; everything below that is the existing blank black canvas (the page background showing
 * through a transparent <main>). No registration copy, buttons, cards, rankings or tournament data.
 */
export default function HomePage() {
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: HOME_CSS }} />

      {/* Full-bleed hero. <main> spans the viewport with no padding, so w-full is edge-to-edge with
          no outer margin. Fixed responsive heights + object-cover keep the image's aspect ratio
          intact (it crops, never stretches), and overflow-hidden guarantees no horizontal scroll.
          The trophy is dead-centre in the source art, so a centred focal point keeps it in frame at
          every width. */}
      <section className="relative w-full overflow-hidden h-[240px] sm:h-[320px] lg:h-[440px] xl:h-[520px]">
        <Image
          src="/assets/branding/8br-banner.png"
          alt="The 8 Ball Registry champion's trophy displayed on a tournament pool table"
          fill
          priority
          /* object-cover scales the 2.5:1 art to FILL the shorter hero box, so at narrow widths it
             is rendered wider than the viewport (e.g. ~600px of image across a 375px screen). These
             hints reflect that painted width, otherwise the browser under-fetches and the banner is
             visibly soft on phones. */
          sizes="(max-width: 640px) 170vw, (max-width: 1024px) 130vw, 100vw"
          className="object-cover object-center"
        />
        {/* Subtle darkening only — enough to settle the image against the black canvas below
            without losing the trophy, the shelves, or the lettering on the walls. */}
        <div aria-hidden className="absolute inset-0 bg-black/25" />
      </section>
    </>
  )
}
