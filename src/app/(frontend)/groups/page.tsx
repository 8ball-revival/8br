import type { Metadata } from 'next'
import { Users } from 'lucide-react'

import { Container } from '@/components/ui/container'
import { PageHeader } from '@/components/page-header'
import { Badge } from '@/components/ui/badge'
import { StageComingSoon } from '@/components/stage-coming-soon'
import { GroupStandings, type GroupView } from '@/components/competition/group-standings'
import { pageMetadata } from '@/lib/site'
import { getPublicSeason } from '@/lib/competition/public'
import { getPublishedGroups, getGroupMatches } from '@/lib/competition/queries'

export const metadata: Metadata = pageMetadata({
  title: '8 Ball Revival Season 2 Groups',
  description: 'Group stage standings and fixtures for 8 Ball Revival Season 2, drawn once registration closes.',
  path: '/groups',
})

export default async function GroupsPage() {
  const season = await getPublicSeason()
  const groups = season ? await getPublishedGroups(season.id) : []

  const views: GroupView[] = await Promise.all(
    groups.map(async (g) => ({
      id: g.id,
      code: g.code,
      name: g.name,
      standings: g.standings,
      matches: await getGroupMatches(g.id),
    })),
  )

  const hasGroups = views.length > 0

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Home', href: '/' }, { label: 'Groups' }]}
        title="Season 2 Groups"
        description="The group stage for 8 Ball Revival Season 2. Groups are drawn from registered players once registration closes."
        actions={<Badge variant={hasGroups ? 'success' : 'muted'}>{hasGroups ? 'Groups live' : 'Not yet drawn'}</Badge>}
      />
      <Container className="py-12">
        {hasGroups ? (
          <div className="grid gap-6 lg:grid-cols-2">
            {views.map((g) => (
              <GroupStandings key={g.id} group={g} />
            ))}
          </div>
        ) : (
          <StageComingSoon
            icon={Users}
            statusLabel="Groups pending"
            title="Groups have not been drawn yet"
            description="The group stage begins once Season 2 registration closes. Every confirmed player is seeded into a group, and standings and fixtures will appear here automatically."
            steps={[
              { title: 'Registration closes', body: 'The pool of confirmed Season 2 players is locked in.' },
              { title: 'Groups are drawn', body: 'Players are seeded into balanced groups for round-robin play.' },
              { title: 'Standings go live', body: 'Fixtures, results, and live standings publish on this page.' },
            ]}
            primary={{ label: 'Register for Season 2', href: '/register' }}
            secondary={{ label: 'Your account', href: '/account' }}
            footerLinks={[
              { label: 'Rules & format', href: '/rules' },
              { label: 'Season 1 groups', href: '/seasons/ego-season-1#groups' },
            ]}
          />
        )}
      </Container>
    </>
  )
}
