import type { Metadata } from 'next'
import Link from 'next/link'
import { Users } from 'lucide-react'

import { Container } from '@/components/ui/container'
import { PageHeader } from '@/components/page-header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { StageComingSoon } from '@/components/stage-coming-soon'
import { PublicGroupCard } from '@/components/competition/public-group'
import { EntrantList } from '@/components/competition/entrant-list'
import { AdminBar } from '@/components/staff/admin-bar'
import { GroupsDndBuilder } from '@/components/staff/groups-dnd-builder'
import { pageMetadata } from '@/lib/site'
import { getPublicSeason, getPublicGroups, getPublicRegistrations } from '@/lib/competition/public'
import { getGroupBuilder } from '@/lib/competition/queries'
import { resolveStaffAccess } from '@/lib/competition/staff-auth'

export const metadata: Metadata = pageMetadata({
  title: '8 Ball Revival Season 2 Groups',
  description: 'Group stage standings and fixtures for 8 Ball Revival Season 2, drawn once registration closes.',
  path: '/groups',
})

export default async function GroupsPage({ searchParams }: { searchParams: Promise<{ edit?: string }> }) {
  const season = await getPublicSeason()
  const wantsEdit = (await searchParams).edit === 'true'

  // INLINE EDIT MODE — Owner/Admin edit the groups on the branded public page itself
  // (no separate staff site). Members never reach this branch.
  if (wantsEdit && season) {
    const access = await resolveStaffAccess()
    if (access.status === 'ok' && access.actor.can('manage_competitions')) {
      const { groups, unassigned, approvedCount, published } = await getGroupBuilder(season.id)
      return (
        <>
          <PageHeader
            breadcrumbs={[{ label: 'Home', href: '/' }, { label: 'Groups', href: '/groups' }, { label: 'Edit' }]}
            title="Edit Groups"
            description="Build the group stage. Drag entrants from Available Players; drop onto a player to swap; drag out to remove. Draft until published."
            actions={
              <div className="flex items-center gap-2">
                <Badge variant="gold">Edit mode</Badge>
                <Button asChild variant="outline" size="sm"><Link href="/groups">Done / View public</Link></Button>
              </div>
            }
          />
          <Container className="py-10">
            <GroupsDndBuilder seasonId={season.id} groups={groups} unassigned={unassigned} published={published} approvedCount={approvedCount} />
          </Container>
        </>
      )
    }
  }

  const views = season ? await getPublicGroups(season.id) : []
  const hasGroups = views.length > 0
  const registrations = await getPublicRegistrations()
  const entrants = registrations.map((r) => ({ name: r.displayName }))

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Home', href: '/' }, { label: 'Groups' }]}
        title="Season 2 Groups"
        description="The group stage for 8 Ball Revival Season 2. Groups are drawn from registered players once registration closes."
        actions={<Badge variant={hasGroups ? 'success' : 'muted'}>{hasGroups ? 'Groups live' : 'Not yet drawn'}</Badge>}
      />
      <Container className="py-12">
        <AdminBar surface="groups" seasonId={season?.id} />
        {/* Season 2 entrant list — expanded before the draw, collapsible once groups are live. */}
        {entrants.length > 0 && <EntrantList entrants={entrants} collapsible={hasGroups} />}
        {hasGroups ? (
          <div className="space-y-6">
            {views.map((g) => (
              <PublicGroupCard key={g.id} group={g} />
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
