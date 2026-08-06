import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { FileText, ListOrdered, Users } from 'lucide-react'

import { Container } from '@/components/ui/container'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { PageHeader } from '@/components/page-header'
import { SectionHeader } from '@/components/section-header'
import { StatusBadge } from '@/components/status-badge'
import { HistoricalNote } from '@/components/historical-note'
import { SeasonSectionNav } from '@/components/season/season-section-nav'
import { SeasonSummary } from '@/components/season/season-summary'
import { GroupCard } from '@/components/season/group-card'
import { StandingsTable } from '@/components/season/standings-table'
import { MatchList } from '@/components/season/match-list'
import { PlayoffBracketShell } from '@/components/season/playoff-bracket-shell'
import { SourceList } from '@/components/season/source-list'
import { getSeasonDetail, getSeasonSlugs } from '@/lib/mock-data'
import { cupStore, loadCupContext } from '@/lib/cups/prime'
import { pageMetadata } from '@/lib/site'

type Params = { params: Promise<{ slug: string }> }

// Only the slugs from generateStaticParams are valid; any other slug returns a
// real 404 (Next serves the not-found page with a 404 status). When this route is
// backed by the database, switch to dynamicParams=true + notFound() for unknowns.
export const dynamicParams = false

// Season 2 launch: the only real, completed 8 Ball Revival season with an archive detail
// page is Season 1. The former sample seasons (2–5) are intentionally NOT emitted,
// so their fabricated detail pages 404 instead of appearing as real 8 Ball Revival records.
export function generateStaticParams() {
  return getSeasonSlugs()
    .filter((slug) => slug === 'ego-season-1')
    .map((slug) => ({ slug }))
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params
  const season = getSeasonDetail(slug)
  if (!season) return { title: 'Season not found' }
  const description = season.originalName
    ? `${season.name} (originally ${season.originalName}) — 8 Ball Revival season overview, groups, standings, and playoffs.`
    : `${season.name} — 8 Ball Revival season overview, groups, standings, and playoffs.`
  return pageMetadata({ title: season.name, description, path: `/seasons/${season.slug}` })
}

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

export default async function SeasonDetailPage({ params }: Params) {
  cupStore.enterWith(await loadCupContext()) // resolve the live Cup revision (bracket components read cup data)
  const { slug } = await params
  const season = getSeasonDetail(slug)
  if (!season) notFound()

  const hasGroups = season.groups.length > 0

  return (
    <>
      <PageHeader
        breadcrumbs={[
          { label: 'Home', href: '/' },
          { label: 'Seasons', href: '/seasons' },
          { label: season.name },
        ]}
        title={season.name}
        description={
          season.originalName ? `Originally ${season.originalName}.` : `${season.year} season.`
        }
        actions={
          <div className="flex items-center gap-2">
            <StatusBadge status={season.status} />
            {season.dataState === 'pending' && <Badge variant="muted">Pending verification</Badge>}
          </div>
        }
      />

      <SeasonSectionNav />

      {/* Overview */}
      <Section id="overview" title="Overview">
        <div className="space-y-6">
          <SeasonSummary season={season} />
          {season.historicalNote && (
            <HistoricalNote>{season.historicalNote}</HistoricalNote>
          )}
        </div>
      </Section>

      {/* Groups */}
      <Section id="groups" title="Groups">
        {hasGroups ? (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {season.groups.map((g) => (
              <GroupCard key={g.code} group={g} />
            ))}
          </div>
        ) : (
          <EmptyState
            icon={Users}
            title="Group assignments pending source verification"
            description="Groups and participants will appear here once imported and verified from source."
          />
        )}
      </Section>

      {/* Standings */}
      <Section id="standings" title="Standings">
        {hasGroups ? (
          <div className="space-y-8">
            {season.groups.map((g) => (
              <div key={g.code}>
                <h3 className="mb-3 font-display text-lg font-semibold">{g.name}</h3>
                <StandingsTable rows={g.standings} />
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={ListOrdered}
            title="Standings not yet imported"
            description="Group standings will be shown here once results are imported."
          />
        )}
      </Section>

      {/* Schedule & Results */}
      <Section id="schedule" title="Schedule & Results">
        {hasGroups ? (
          <div className="space-y-8">
            {season.groups.map((g) => (
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

      {/* Playoffs */}
      <Section id="playoffs" title="Playoffs">
        <PlayoffBracketShell playoff={season.playoff} />
      </Section>

      {/* Rules */}
      <Section id="rules" title="Rules">
        {season.rulesRef ? (
          <Button asChild variant="secondary">
            <Link href="/rules">View rules & formats</Link>
          </Button>
        ) : (
          <EmptyState
            icon={FileText}
            title="Rules not yet published"
            description="The rules applied to this season will be linked here once published."
          />
        )}
      </Section>

      {/* Sources */}
      <Section id="sources" title="Sources">
        <SourceList sources={season.sources} />
      </Section>
    </>
  )
}
