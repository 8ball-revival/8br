import type { Metadata } from 'next'
import { Trophy } from 'lucide-react'

import { Container } from '@/components/ui/container'
import { PageHeader } from '@/components/page-header'
import { Badge } from '@/components/ui/badge'
import { StageComingSoon } from '@/components/stage-coming-soon'
import { BracketView } from '@/components/competition/bracket-view'
import { pageMetadata } from '@/lib/site'
import { getPublicSeason } from '@/lib/competition/public'
import { getPublishedPlayoff } from '@/lib/competition/queries'

export const metadata: Metadata = pageMetadata({
  title: '8 Ball Revival Season 2 Playoffs',
  description: 'The single-elimination playoff bracket for 8 Ball Revival Season 2, set after the group stage.',
  path: '/playoffs',
})

export default async function PlayoffsPage() {
  const season = await getPublicSeason()
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
