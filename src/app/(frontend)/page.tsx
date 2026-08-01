import type { Metadata } from 'next'

import { Wide } from '@/components/home/primitives'
import { Hero, HeroBackdrop } from '@/components/home/hero'
import { RegisteredPlayers } from '@/components/home/registered-players'
import { Top10Panel } from '@/components/home/top10-panel'
import { CurrentCupBox } from '@/components/home/current-cup-box'
import { NewsPanel } from '@/components/home/news-panel'
import { PlayerSpotlight } from '@/components/home/player-spotlight'
import { ByTheNumbers } from '@/components/home/by-the-numbers'
import { OnThisDay } from '@/components/home/on-this-day'
import { getHomeData } from '@/lib/home/fixtures'
import { getTop10 } from '@/lib/hall-of-fame/fixtures'
import { getSpotlightPlayers } from '@/lib/spotlight/fixtures'
import { getCups } from '@/lib/cups/fixtures'
import { absoluteUrl } from '@/lib/site'

const DESCRIPTION =
  'The next chapter of competitive online 8-ball. Formerly known as 8BRCAM. Season 2 registration is now open — compete in the group stage and playoffs and explore two decades of history.'

export const metadata: Metadata = {
  title: { absolute: '8 Ball Revival | Formerly 8BRCAM' },
  description: DESCRIPTION,
  alternates: { canonical: '/' },
  openGraph: {
    title: '8 Ball Revival | Formerly 8BRCAM',
    description: DESCRIPTION,
    url: absoluteUrl('/'),
    siteName: '8 Ball Revival',
    type: 'website',
  },
  twitter: { card: 'summary_large_image', title: '8 Ball Revival', description: DESCRIPTION },
}

export default function HomePage() {
  // Homepage is driven entirely by the fixture seam for now (see lib/home/fixtures).
  // Swap getHomeData() for real Payload/Prisma queries later — components unchanged.
  const data = getHomeData()
  const currentCup = getCups().find((c) => c.status === 'live')

  return (
    <>
      {/* Hero band: arena backdrop + registration CTA + upcoming events */}
      <section className="relative overflow-hidden border-b border-border">
        <HeroBackdrop />
        <Wide className="relative grid items-start gap-6 py-10 lg:grid-cols-[minmax(0,1fr)_360px] lg:py-14">
          <Hero data={data.hero} />
          <RegisteredPlayers players={data.registrations} />
        </Wide>
      </section>

      {/* Live dashboard: five panels */}
      <section className="py-8">
        <Wide className="grid items-stretch gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-[minmax(0,3fr)_minmax(0,3.5fr)_minmax(0,2fr)_minmax(0,3fr)]">
          <Top10Panel players={getTop10()} className="sm:col-span-2 xl:col-span-1" />
          {currentCup && <CurrentCupBox cup={currentCup} />}
          <NewsPanel items={data.news} />
          <PlayerSpotlight players={getSpotlightPlayers()} />
        </Wide>
      </section>

      {/* By the numbers + on this day */}
      <section className="border-t border-border bg-card/20 py-10">
        <Wide>
          <h2 className="eyebrow mb-5 text-gold">8 Ball Revival by the Numbers</h2>
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
            <ByTheNumbers stats={data.byTheNumbers} />
            <OnThisDay items={data.onThisDay} />
          </div>
        </Wide>
      </section>
    </>
  )
}
