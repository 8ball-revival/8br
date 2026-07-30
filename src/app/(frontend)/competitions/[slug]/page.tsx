import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { Container } from '@/components/ui/container'
import { SectionHeader } from '@/components/section-header'
import { SectionNav } from '@/components/section-nav'
import { EmptyState } from '@/components/ui/empty-state'
import { HistoricalNote } from '@/components/historical-note'
import { CompetitionHero } from '@/components/competition/competition-hero'
import { CompetitionSummary } from '@/components/competition/competition-summary'
import { ParticipantList } from '@/components/competition/participant-list'
import { StageOverview } from '@/components/competition/stage-overview'
import { ChampionPanel } from '@/components/competition/champion-panel'
// Reused season components (same problem, no duplication):
import { GroupCard } from '@/components/season/group-card'
import { StandingsTable } from '@/components/season/standings-table'
import { MatchList } from '@/components/season/match-list'
import { PlayoffBracketShell } from '@/components/season/playoff-bracket-shell'
import { SourceList } from '@/components/season/source-list'
import { ListOrdered } from 'lucide-react'
import { getCompetitionPreview, getCompetitionPreviewSlugs } from '@/lib/preview-competitions'

type Params = { params: Promise<{ slug: string }> }

export const dynamicParams = false

export function generateStaticParams() {
  return getCompetitionPreviewSlugs().map((slug) => ({ slug }))
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params
  const c = getCompetitionPreview(slug)
  if (!c) return { title: 'Competition not found' }
  return {
    title: c.name,
    description: `${c.name} — historical archive competition (${c.legacyName}), preview pending 8 Ball Revival verification.`,
  }
}

const NAV = [
  { id: 'overview', label: 'Overview' },
  { id: 'participants', label: 'Participants' },
  { id: 'stages', label: 'Stages' },
  { id: 'groups', label: 'Groups' },
  { id: 'standings', label: 'Standings' },
  { id: 'schedule', label: 'Schedule' },
  { id: 'playoffs', label: 'Playoffs' },
  { id: 'champion', label: 'Champion' },
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

export default async function CompetitionDetailPage({ params }: Params) {
  const { slug } = await params
  const c = getCompetitionPreview(slug)
  if (!c) notFound()

  const hasGroups = c.groups.length > 0
  const matchNote =
    c.totalGroupMatches > 0
      ? `Showing ${c.shownGroupMatches} of ${c.totalGroupMatches} recorded group matches (full logs pending import).`
      : undefined

  return (
    <>
      <CompetitionHero competition={c} />
      <SectionNav sections={NAV} ariaLabel="Competition sections" />

      <Section id="overview" title="Overview">
        <div className="space-y-6">
          <CompetitionSummary competition={c} />
          {c.historicalNotes.length > 0 && (
            <div className="space-y-3">
              {c.historicalNotes.map((n, i) => (
                <HistoricalNote key={i}>{n}</HistoricalNote>
              ))}
            </div>
          )}
        </div>
      </Section>

      <Section id="participants" title="Participants">
        <ParticipantList participants={c.participants} />
      </Section>

      <Section id="stages" title="Stages">
        <StageOverview stages={c.stages} />
      </Section>

      <Section id="groups" title="Groups">
        {hasGroups ? (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {c.groups.map((g) => (
              <GroupCard key={g.code} group={g} />
            ))}
          </div>
        ) : (
          <EmptyState
            icon={ListOrdered}
            title="Group assignments pending verification"
            description="Groups will appear here once verified from source."
          />
        )}
      </Section>

      <Section id="standings" title="Standings">
        {hasGroups ? (
          <div className="space-y-8">
            {c.groups.map((g) => (
              <div key={g.code}>
                <h3 className="mb-3 font-display text-lg font-semibold">{g.name}</h3>
                <StandingsTable rows={g.standings} />
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={ListOrdered}
            title="Standings not yet available"
            description="Group standings will be shown here once verified."
          />
        )}
      </Section>

      <Section id="schedule" title="Schedule & Results" description={matchNote}>
        {hasGroups ? (
          <div className="space-y-8">
            {c.groups.map((g) => (
              <div key={g.code}>
                <h3 className="mb-3 font-display text-lg font-semibold">{g.name}</h3>
                <MatchList matches={g.matches} />
              </div>
            ))}
          </div>
        ) : (
          <MatchList matches={[]} />
        )}
      </Section>

      <Section id="playoffs" title="Playoffs">
        <div className="space-y-5">
          <HistoricalNote title="Records note">
            Playoff match results were not recorded in the archive — only seedings and first-round
            pairings survive. The bracket below reflects the official seedings used at the time.
          </HistoricalNote>
          <PlayoffBracketShell playoff={c.playoff} />
        </div>
      </Section>

      <Section id="champion" title="Champion">
        <ChampionPanel champion={c.champion} runnerUp={c.runnerUp} />
      </Section>

      <Section id="sources" title="Sources">
        <SourceList sources={c.sources} />
      </Section>
    </>
  )
}
