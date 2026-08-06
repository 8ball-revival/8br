import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { Container } from '@/components/ui/container'
import { SectionHeader } from '@/components/section-header'
import { PlayerLegacyHero } from '@/components/player/player-legacy-hero'
import { ProfileSectionNav } from '@/components/profile-section-nav'
import { LegacySnapshot } from '@/components/player/legacy-snapshot'
import { ChampionshipShowcase } from '@/components/player/championship-showcase'
import { CareerHighlights } from '@/components/player/career-highlights'
import { CareerStats } from '@/components/player/career-stats'
import { CompetitionHistory } from '@/components/player/competition-history'
import { MatchHistory } from '@/components/player/match-history'
import { HallOfFamePanel } from '@/components/player/hall-of-fame-panel'
import { AliasList } from '@/components/player/alias-list'
import { SourcePanel } from '@/components/player/source-panel'
import { RatingPanel } from '@/components/player/rating-panel'
import { getPlayerPreview, getPlayerPreviewSlugs } from '@/lib/preview-players'
import { resolveCanonicalId } from '@/lib/stats/season-stats'
import { getPlayerRankingProfile } from '@/lib/stats/rankings'
import { getCareerStatById } from '@/lib/stats/career-stats'
import { getLivePublicProfile } from '@/lib/players/public-profile'
import { LivePlayerProfile } from '@/components/player/live-player-profile'
import { formatIdentityLabel } from '@/lib/identity/public-identity'
import { cupStore, loadCupContext } from '@/lib/cups/prime'

type Params = { params: Promise<{ slug: string }> }

// Archive-preview slugs are pre-rendered; LIVE profiles (by CueVerse ID) render on demand.
export const dynamicParams = true

export function generateStaticParams() {
  return getPlayerPreviewSlugs().map((slug) => ({ slug }))
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params
  const live = await getLivePublicProfile(slug)
  if (live) return { title: formatIdentityLabel(live.preferredName, live.cueverseId), description: `${live.preferredName} — 8 Ball Revival player profile.` }
  const player = getPlayerPreview(slug)
  if (!player) return { title: 'Player not found' }
  return {
    title: player.primaryName,
    description: `${player.primaryName} — 8 Ball Revival player legacy profile (archive preview). Canonical identity ${player.playerId} with ${player.aliases.length} known aliases.`,
  }
}

// Primary in-page nav. Aliases & Sources are secondary (below), not in the nav.
const NAV = [
  { id: 'overview', label: 'Overview' },
  { id: 'rating', label: 'Rating' },
  { id: 'championships', label: 'Championships' },
  { id: 'highlights', label: 'Highlights' },
  { id: 'statistics', label: 'Statistics' },
  { id: 'career', label: 'Career' },
  { id: 'head-to-head', label: 'Head-to-Head' },
  { id: 'historical-standing', label: 'Historical Standing' },
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
  cupStore.enterWith(await loadCupContext()) // resolve the live Cup revision before cup-derived career/rankings
  const { slug } = await params

  // LIVE profile (linked account / native profile) takes precedence over the archive preview.
  const live = await getLivePublicProfile(slug)
  if (live) {
    const rating = live.legacyPlayerId ? getPlayerRankingProfile(live.legacyPlayerId) : null
    const career = live.legacyPlayerId ? getCareerStatById(live.legacyPlayerId) : null
    return (
      <LivePlayerProfile
        profile={live}
        ranking={rating ? { currentRank: rating.currentRank, score: rating.score, peakRating: rating.peakRating } : null}
        career={career ? { seasonTitles: career.seasonTitles, cupTitles: career.cupTitles, totalWins: career.totalWins, totalLosses: career.totalLosses, totalWinPct: career.totalWinPct } : null}
      />
    )
  }

  const player = getPlayerPreview(slug)
  if (!player) notFound()

  // Competitive rating (Glicko-2) resolved through the shared canonical identity.
  const ratingId = resolveCanonicalId([player.primaryName, ...player.aliases.map((a) => a.alias)])
  const rating = ratingId ? getPlayerRankingProfile(ratingId) : null

  return (
    <>
      <PlayerLegacyHero player={player} />
      <ProfileSectionNav sections={NAV} />

      <Section id="overview" title="Legacy Snapshot">
        <LegacySnapshot player={player} />
      </Section>

      <Section
        id="rating"
        title="Competitive Rating"
        description="Live Glicko-2 rating derived from official Season and Cup matches — separate from career accomplishments. This is why the player ranks where they do."
      >
        {rating ? (
          <RatingPanel profile={rating} />
        ) : (
          <p className="rounded-md border border-border bg-card/40 px-3 py-2 text-sm text-muted-foreground">
            No rated official matches yet.
          </p>
        )}
      </Section>

      <Section id="championships" title="Championship Legacy">
        <ChampionshipShowcase player={player} />
      </Section>

      <Section id="highlights" title="Career Highlights">
        <CareerHighlights player={player} />
      </Section>

      <Section id="statistics" title="Career Statistics">
        <CareerStats career={player.career} />
      </Section>

      <Section
        id="career"
        title="Career History"
        description="Historical archive seasons (8BRCAM) — distinct from the 8 Ball Revival chronology."
      >
        <CompetitionHistory seasons={player.seasonHistory} />
      </Section>

      <Section id="head-to-head" title="Head-to-Head">
        <MatchHistory career={player.career} headToHead={player.headToHead} />
      </Section>

      <Section id="historical-standing" title="Historical Standing">
        <div className="space-y-4">
          <HallOfFamePanel entries={player.hof} />
          <p className="rounded-md border border-border bg-card/40 px-3 py-2 text-xs text-muted-foreground">
            Time-series ranking snapshots aren&apos;t part of the archive; the all-time placements above
            reflect final standings.
          </p>
        </div>
      </Section>

      <Section id="aliases" title="Aliases & Identity History">
        <AliasList aliases={player.aliases} primaryName={player.primaryName} />
      </Section>

      <Section id="sources" title="Sources & Record Details">
        <SourcePanel playerId={player.playerId} />
      </Section>
    </>
  )
}
