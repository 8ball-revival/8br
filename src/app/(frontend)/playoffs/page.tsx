import type { Metadata } from 'next'
import Link from 'next/link'
import { Trophy } from 'lucide-react'

import { Container } from '@/components/ui/container'
import { PageHeader } from '@/components/page-header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { StageComingSoon } from '@/components/stage-coming-soon'
import { BracketView } from '@/components/competition/bracket-view'
import { AdminBar } from '@/components/staff/admin-bar'
import { PlayoffDndBuilder } from '@/components/staff/playoff-dnd-builder'
import { PlayoffResultsSection } from '@/components/staff/playoff-results'
import { ActionButton } from '@/components/staff/action-button'
import { generatePlayoffAction } from '@/lib/competition/actions'
import { pageMetadata } from '@/lib/site'
import { getPublicSeason } from '@/lib/competition/public'
import { getPublishedPlayoff, getAllPlayoffMatches, getPlayoffBuilder, getMatchHistory } from '@/lib/competition/queries'
import { resolveStaffAccess } from '@/lib/competition/staff-auth'

export const dynamic = 'force-dynamic' // auth/user-specific — must render per-request (reads headers/cookies)

export const metadata: Metadata = pageMetadata({
  title: '8 Ball Revival Season 2 Playoffs',
  description: 'The single-elimination playoff bracket for 8 Ball Revival Season 2, set after the group stage.',
  path: '/playoffs',
})

export default async function PlayoffsPage({ searchParams }: { searchParams: Promise<{ edit?: string }> }) {
  const season = await getPublicSeason()
  const wantsEdit = (await searchParams).edit === 'true'

  // INLINE EDIT MODE — Owner/Admin build the bracket + enter results on the branded page.
  if (wantsEdit && season) {
    const access = await resolveStaffAccess()
    if (access.status === 'ok' && access.actor.can('manage_competitions')) {
      const [builder, allMatches] = await Promise.all([getPlayoffBuilder(season.id), getAllPlayoffMatches(season.id)])
      const history = await getMatchHistory('PlayoffMatch', allMatches.map((m) => m.id))
      return (
        <>
          <PageHeader
            breadcrumbs={[{ label: 'Home', href: '/' }, { label: 'Playoffs', href: '/playoffs' }, { label: 'Edit' }]}
            title="Edit Playoffs"
            description="Seed the single-elimination bracket by hand — drag entrants into seeds, drop onto a seed to swap, drag out to remove. The published bracket uses the standard bracket styling."
            actions={
              <div className="flex items-center gap-2">
                <Badge variant="gold">Edit mode</Badge>
                <Button asChild variant="outline" size="sm"><Link href="/playoffs">Done / View public</Link></Button>
              </div>
            }
          />
          <Container className="py-10">
            {!builder.published && builder.seeds.length === 0 && allMatches.length === 0 && (
              <div className="mb-4">
                <ActionButton
                  action={generatePlayoffAction}
                  fields={{ seasonId: season.id }}
                  label="Auto-seed from group standings"
                  variant="outline"
                  confirm="Seed the bracket from current group standings? You can then adjust the seeding by hand."
                />
              </div>
            )}
            <PlayoffDndBuilder seasonId={season.id} seeds={builder.seeds} pool={builder.pool} published={builder.published} />
            {allMatches.length > 0 && (
              <div className="mt-8">
                <h2 className="mb-3 font-display text-lg font-semibold">Bracket preview</h2>
                <BracketView matches={allMatches} />
              </div>
            )}
            <PlayoffResultsSection matches={allMatches} history={history} raceLength={season.raceLength} />
          </Container>
        </>
      )
    }
  }

  const matches = season ? await getPublishedPlayoff(season.id) : []
  const hasBracket = matches.length > 0

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Home', href: '/' }, { label: 'Playoffs' }]}
        title="Season 2 Playoffs"
        description="The single-elimination playoff bracket for 8 Ball Revival Season 2, set once the group stage concludes."
        actions={<Badge variant={hasBracket ? 'success' : 'muted'}>{hasBracket ? 'Bracket live' : 'Bracket pending'}</Badge>}
      />
      <Container className="py-12">
        <AdminBar surface="playoffs" seasonId={season?.id} />
        {hasBracket ? (
          <BracketView matches={matches} />
        ) : (
          <StageComingSoon
            icon={Trophy}
            statusLabel="Playoffs pending"
            title="The playoff bracket is not set yet"
            description="Playoffs begin after the group stage. The top finishers advance to a single-elimination bracket, seeded by their group results — the full bracket and results will be published here."
            steps={[
              { title: 'Group stage finishes', body: 'Final group standings determine who advances and their seeding.' },
              { title: 'Bracket is seeded', body: 'Qualified players are placed into the single-elimination bracket.' },
              { title: 'Playoffs begin', body: 'Matchups, results, and the road to the title go live here.' },
            ]}
            primary={{ label: 'View the group stage', href: '/groups' }}
            secondary={{ label: 'Register for Season 2', href: '/register' }}
            footerLinks={[
              { label: 'Rules & format', href: '/rules' },
              { label: 'Season 1 playoffs', href: '/seasons/ego-season-1#playoffs' },
            ]}
          />
        )}
      </Container>
    </>
  )
}
