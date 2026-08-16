import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'

import { Wide } from '@/components/primitives'
import { getHomepageHero } from '@/lib/site-content/service'
import { pageMetadata, brandName } from '@/lib/site'

// The hero is admin-managed: publishing must show up without a redeploy, so the page is rendered
// per request rather than cached at build time. (Publishing additionally calls revalidatePath — see
// src/globals/revalidate.ts — so this stays correct if caching is introduced later.)
export const dynamic = 'force-dynamic'

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
 */
const HOME_CSS = `
/* Drop the footer for this route only. */
body > footer { display: none !important; }

/* Tailwind's min-h-screen is 100vh, which on mobile is taller than the visible area
   while the URL bar is showing and leaves a small phantom scroll. This is a floor,
   not a cap — the page still grows normally when content exceeds the viewport. */
body { min-height: 100vh !important; min-height: 100svh !important; }
`

// Button styling lifted verbatim from the reference hero so the two calls to action keep their
// exact size, weight, radius and focus treatment.
const primaryBtn =
  'inline-flex items-center rounded-md bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
const secondaryBtn =
  'inline-flex items-center rounded-md border border-border px-6 py-3 text-sm font-semibold text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

/**
 * `/` — the admin-managed hero, and nothing else yet.
 *
 * Wording, images and button destinations come from the `homepage-hero` Payload global (published
 * version only). The design around them is fixed here in code: typography, colours, spacing and
 * responsive behaviour are not editable from the admin.
 */
export default async function HomePage() {
  const hero = await getHomepageHero()

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: HOME_CSS }} />

      {/* Full-bleed hero. <main> spans the viewport with no padding, so the section is edge-to-edge
          with no outer margin. object-cover keeps the artwork's aspect ratio (it crops, never
          stretches) with a centred focal point, and overflow-hidden guarantees no horizontal
          scroll. Height is a MINIMUM so the box grows rather than clipping the copy on small
          screens. */}
      <section className="relative w-full overflow-hidden">
        {hero.bannerUrl ? (
          <Image
            src={hero.bannerUrl}
            alt={hero.bannerAlt}
            fill
            priority
            /* object-cover scales the wide art to FILL the shorter hero box, so at narrow widths it
               is painted wider than the viewport. These hints reflect that painted width, otherwise
               the browser under-fetches and the banner looks soft on phones. */
            sizes="(max-width: 640px) 170vw, (max-width: 1024px) 130vw, 100vw"
            className="object-cover object-center"
          />
        ) : null}
        {/* Subtle darkening only — settles the artwork against the black canvas below and lifts the
            copy off it, without losing the centrepiece or the brass detail. */}
        <div aria-hidden className="absolute inset-0 bg-black/25" />

        <Wide className="relative flex min-h-[440px] flex-col justify-end py-12 sm:min-h-[480px] sm:py-14 lg:min-h-[560px] lg:py-20">
          <div className="relative">
            <p className="eyebrow text-hero-gold">{hero.welcomeLine}</p>
            <h1 className="mt-3 max-w-2xl text-4xl font-bold uppercase leading-[0.95] tracking-tight sm:text-5xl lg:text-6xl">
              <span className="block">{hero.headlineLine1}</span>
              <span className="block text-hero-gold">{hero.headlineLine2}</span>
            </h1>
            <p className="mt-4 max-w-xl text-lg text-foreground">{hero.description}</p>
            <p className="mt-3 max-w-xl text-muted-foreground">{hero.supportingSentence}</p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link href={hero.primaryButtonHref} className={primaryBtn}>
                {hero.primaryButtonLabel}
              </Link>
              <Link href={hero.secondaryButtonHref} className={secondaryBtn}>
                {hero.secondaryButtonLabel}
              </Link>
            </div>
          </div>
        </Wide>
      </section>
    </>
  )
}
