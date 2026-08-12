import type { Metadata } from 'next'

import { Wide } from '@/components/home/primitives'
import { Hero, HeroBackdrop } from '@/components/home/hero'
import { CompetitionsPanel, type CompetitionItem } from '@/components/home/competitions-panel'
import { Top10Panel } from '@/components/home/top10-panel'
import { CurrentCupBox } from '@/components/home/current-cup-box'
import { NewsPanel } from '@/components/home/news-panel'
import { PlayerSpotlight } from '@/components/home/player-spotlight'
import { ByTheNumbers } from '@/components/home/by-the-numbers'
import { OnThisDay } from '@/components/home/on-this-day'
import { getHomeData, type HeroData } from '@/lib/home/fixtures'
import { getSeasonTop, getSeasonRankings } from '@/lib/stats/tournament-stats'
import { getAllArchiveSeasons } from '@/lib/seasons/archive'
import { getPublicSeason, isRegistrationOpen, registrationDeadlineLabel } from '@/lib/competition/public'
import { getSpotlightPlayers } from '@/lib/spotlight/fixtures'
import { getCups } from '@/lib/cups/service'
import { cupStore, loadCupContext } from '@/lib/cups/prime'
import { absoluteUrl } from '@/lib/site'

const DESCRIPTION =
  'The next chapter of competitive online 8-ball. Formerly known as 8BRCAM. Compete in Tournament 2 — the group stage and playoffs — and explore two decades of history.'

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

export default async function HomePage() {
  cupStore.enterWith(await loadCupContext()) // resolve the live Cup revision before any cup-derived render
  // Most homepage panels are still fixture-driven (see lib/home/fixtures); the
  // Registered Players panel is now live from the database.
  const data = getHomeData()
  const currentCup = getCups().find((c) => c.status === 'live')

  // Registration state on the hero is DB-driven (the manual staff status is
  // authoritative) — never a hardcoded label or deadline.
  const tournament = await getPublicSeason()
  const open = isRegistrationOpen(tournament)
  const hero: HeroData = {
    ...data.hero,
    seasonLabel: tournament?.name ?? data.hero.seasonLabel,
    headingTop: 'Registration',
    headingBottom: open ? 'Now Open' : tournament?.registrationStatus === 'CLOSED' ? 'Now Closed' : 'Opening Soon',
    // Countdown only when open AND a deadline is set; otherwise hidden.
    registrationClosesAt: open && tournament?.registrationClosesAt ? tournament.registrationClosesAt.toISOString() : '',
    deadlineNote: open
      ? tournament?.registrationClosesAt
        ? registrationDeadlineLabel(tournament)
        : 'Registration is open — enter Tournament 2 now.'
      : tournament?.registrationStatus === 'CLOSED'
        ? 'Registration is closed. Follow the group stage and playoffs.'
        : 'Registration will open soon.',
  }

  // Current & upcoming competitions for the hero side panel (existing data only).
  const competitions: CompetitionItem[] = []
  if (tournament) {
    competitions.push({
      title: tournament.name,
      meta: open ? 'Group stage → playoffs' : 'Tournament in progress',
      href: open ? '/register' : '/groups',
      status: open ? 'open' : 'closed',
    })
  }
  for (const c of getCups().filter((c) => c.status === 'live')) {
    competitions.push({
      title: c.name,
      meta: `Cup ${c.number}${c.currentRound ? ` · ${c.currentRound}` : ''}`,
      href: `/cups/${c.number}`,
      status: 'live',
    })
  }

  // Championship + tournament counters derived from the canonical Seasons source (the
  // remaining by-the-numbers tiles are decorative site-level counters, not player stats).
  const champions = getSeasonRankings().filter((p) => p.championships > 0).length
  const seasonCount = getAllArchiveSeasons().filter((s) => !s.pending).length
  const byTheNumbers = data.byTheNumbers.map((s) =>
    s.icon === 'champions'
      ? { ...s, value: String(champions) }
      : s.id === 's2' && s.icon === 'seasons'
        ? { ...s, value: String(seasonCount) }
        : s,
  )

  return (
    <>
      {/* Hero band: arena backdrop + registration CTA + upcoming events */}
      <section className="relative overflow-hidden border-b border-border">
        <HeroBackdrop />
        <Wide className="relative grid items-start gap-6 py-10 lg:grid-cols-[minmax(0,1fr)_360px] lg:py-14">
          <Hero data={hero} registrationOpen={open} />
          <CompetitionsPanel items={competitions} />
        </Wide>
      </section>

      {/* Live dashboard: five panels */}
      <section className="py-8">
        <Wide className="grid items-stretch gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-[minmax(0,3fr)_minmax(0,3.5fr)_minmax(0,2fr)_minmax(0,3fr)]">
          <Top10Panel players={getSeasonTop(10)} className="sm:col-span-2 xl:col-span-1" />
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
            <ByTheNumbers stats={byTheNumbers} />
            <OnThisDay items={data.onThisDay} />
          </div>
        </Wide>
      </section>
    </>
  )
}
