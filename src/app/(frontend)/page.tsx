import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'

import { Wide } from '@/components/primitives'
import { getHomepageHero } from '@/lib/site-content/service'
import { getRegistryStats } from '@/lib/stats/registry-stats'
import { getAlmanac, phoenixDateKey } from '@/lib/stats/almanac'
import { ByTheNumbers } from '@/components/home/by-the-numbers'
import { NewsPanel } from '@/components/home/news-panel'
import { Top10Panel } from '@/components/home/top10-panel'
import { CompetitionCenter } from '@/components/home/competition-center'
import { RecentResultsCard } from '@/components/home/recent-results'
import { getHomeNews } from '@/lib/home/news'
import { getTop10, getTop10Options } from '@/lib/home/top10'
import { getRecentResults } from '@/lib/home/results'
import { getLatestSnapshot } from '@/lib/cueverse/service'
import { pageMetadata, brandName } from '@/lib/site'

// The hero is admin-managed: publishing must show up without a redeploy, so the page is rendered
// per request rather than cached at build time. (Publishing additionally calls revalidatePath — see
// src/globals/revalidate.ts — so this stays correct if caching is introduced later.)
export const dynamic = 'force-dynamic'

export const metadata: Metadata = pageMetadata({
  title: brandName,
  description:
    '8 Ball Registry (8BR) — the home of competitive cue sports. Enter the active Season, follow live brackets and standings, and climb the rankings.',
  path: '/',
})

/**
 * Homepage-only styling.
 *
 * Emitted as part of THIS page's output, so the rules exist only while `/` is rendered and vanish
 * as soon as another route takes over — no other page is affected and the layout is untouched.
 */
const HOME_CSS = `
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
  // Everything the page needs, fetched together. Each of these is independently cached, so a busy
  // homepage is a handful of cache reads rather than a dozen aggregate queries.
  const [hero, stats, almanac, news, top10Options, results, cueverse] = await Promise.all([
    getHomepageHero(),
    getRegistryStats(),
    getAlmanac(phoenixDateKey()),
    getHomeNews(),
    getTop10Options(),
    getRecentResults(),
    // Read from our own snapshot table. The homepage never calls CueVerse.
    getLatestSnapshot(),
  ])

  // The panel's default view. A device with a saved preference swaps to it after mount, which is why
  // this is rendered rather than guessed at on the client — the first paint is real content.
  const top10 = await getTop10('all-competitions')

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
            <p className="eyebrow text-gold">{hero.welcomeLine}</p>
            <h1 className="mt-3 max-w-2xl text-4xl font-bold uppercase leading-[0.95] tracking-tight sm:text-5xl lg:text-6xl">
              <span className="block">{hero.headlineLine1}</span>
              <span className="block text-gold">{hero.headlineLine2}</span>
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

      {/*
        Below the hero: a main column and a sidebar, each packing its own sections tightly.

        Each column packs its own sections, so the sidebar puts Recent Results directly under the
        Top 10 rather than waiting for the taller main column to finish — which is what avoids the
        large dead space a plain two-column grid leaves.

        The `contents` wrappers plus explicit `order` are what let one markup serve both layouts. On a
        phone the grid is a single column, the wrappers collapse, and all four sections become direct
        grid items ordered 1-4: Competition Center, Top 10, News, Recent Results. From `lg` up each
        wrapper becomes its own flex column and the same order values sort within it.

        The order values are not decoration. `contents` flattens each wrapper's children as a block,
        so document order alone gives Competition Center, News, Top 10, Recent Results — News above
        the Top 10, which is not the required stacking.
      */}
      <section className="py-10 lg:py-12">
        <Wide>
          <div className="grid gap-8 lg:grid-cols-[minmax(0,68fr)_minmax(0,32fr)] lg:items-start">
            <div className="contents lg:flex lg:flex-col lg:gap-10">
              <div className="order-1 min-w-0"><CompetitionCenter snapshot={cueverse} /></div>
              <div className="order-3 min-w-0">
                <NewsPanel featured={news.featured} latest={news.latest} second={news.second} />
              </div>
            </div>
            <div className="contents lg:flex lg:flex-col lg:gap-10">
              <div className="order-2 min-w-0"><Top10Panel options={top10Options} initial={top10} /></div>
              <div className="order-4 min-w-0"><RecentResultsCard results={results} /></div>
            </div>
          </div>
        </Wide>
      </section>

      <ByTheNumbers stats={stats} almanac={almanac} />
    </>
  )
}
