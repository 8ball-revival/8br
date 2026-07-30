import type { Metadata } from 'next'

import { Container } from '@/components/ui/container'
import { SectionHeader } from '@/components/section-header'
import { SectionNav } from '@/components/section-nav'
import { PlayerHero } from '@/components/player/player-hero'
import { AliasList } from '@/components/player/alias-list'
import { CareerStats } from '@/components/player/career-stats'
import { ChampionshipHistory } from '@/components/player/championship-history'
import { CompetitionHistory } from '@/components/player/competition-history'
import { MatchHistory } from '@/components/player/match-history'
import { RankingHistory } from '@/components/player/ranking-history'
import { HallOfFamePanel } from '@/components/player/hall-of-fame-panel'
import { SourcePanel } from '@/components/player/source-panel'
import { HistoricalNotes } from '@/components/player/historical-notes'
import { getPlayerPreview, getPlayerPreviewSlugs } from '@/lib/preview-players'
import { notFound } from 'next/navigation'

type Params = { params: Promise<{ slug: string }> }

// Only archive-preview slugs are valid → unknown slugs return a real 404.
export const dynamicParams = false

export function generateStaticParams() {
  return getPlayerPreviewSlugs().map((slug) => ({ slug }))
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params
  const player = getPlayerPreview(slug)
  if (!player) return { title: 'Player not found' }
  return {
    title: player.primaryName,
    description: `${player.primaryName} — 8 Ball Revival player profile (archive preview). Canonical identity ${player.playerId} with ${player.aliases.length} known aliases.`,
  }
}

const NAV = [
  { id: 'overview', label: 'Overview' },
  { id: 'career', label: 'Career' },
  { id: 'championships', label: 'Championships' },
  { id: 'competitions', label: 'Competitions' },
  { id: 'matches', label: 'Match Record' },
  { id: 'rankings', label: 'Rankings' },
  { id: 'hall-of-fame', label: 'Hall of Fame' },
  { id: 'sources', label: 'Sources' },
]

function Section({
  id,
  title,
  description,
  children,
}: {
  id: string
  title: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <section id={id} className="scroll-mt-28 border-t border-border py-10 first:border-t-0">
      <Container>
        <SectionHeader title={title} description={description} />
        {children}
      </Container>
    </section>
  )
}

export default async function PlayerDetailPage({ params }: Params) {
  const { slug } = await params
  const player = getPlayerPreview(slug)
  if (!player) notFound()

  return (
    <>
      <PlayerHero player={player} />
      <SectionNav sections={NAV} ariaLabel="Player sections" />

      {/* Overview: aliases + historical notes */}
      <Section id="overview" title="Overview">
        <div className="space-y-8">
          <div>
            <h3 className="mb-3 font-display text-lg font-semibold">Known aliases</h3>
            <AliasList aliases={player.aliases} primaryName={player.primaryName} />
          </div>
          <div>
            <h3 className="mb-3 font-display text-lg font-semibold">Historical notes</h3>
            <HistoricalNotes notes={player.historicalNotes} />
          </div>
        </div>
      </Section>

      <Section id="career" title="Career summary">
        <CareerStats career={player.career} />
      </Section>

      <Section id="championships" title="Championship history">
        <ChampionshipHistory championships={player.championships} />
      </Section>

      <Section id="competitions" title="Competition history">
        <CompetitionHistory seasons={player.seasonHistory} />
      </Section>

      <Section id="matches" title="Match record">
        <MatchHistory career={player.career} headToHead={player.headToHead} />
      </Section>

      <Section id="rankings" title="Ranking history">
        <RankingHistory />
      </Section>

      <Section id="hall-of-fame" title="Hall of Fame">
        <HallOfFamePanel entries={player.hof} />
      </Section>

      <Section id="sources" title="Sources">
        <SourcePanel playerId={player.playerId} />
      </Section>
    </>
  )
}
