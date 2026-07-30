import type { Metadata } from 'next'

import { StaffShell } from '@/components/staff/staff-shell'
import { StaffGate } from '@/components/staff/staff-gate'
import { GroupStandings, type GroupView } from '@/components/competition/group-standings'
import { resolveStaffAccess } from '@/lib/competition/staff-auth'
import { getActiveSeason, getAllGroups, getGroupMatches } from '@/lib/competition/queries'

export const metadata: Metadata = { title: 'Standings · Admin', robots: { index: false, follow: false } }

export default async function StaffStandingsPage() {
  const access = await resolveStaffAccess()
  if (access.status !== 'ok') return <StaffGate access={access} />
  const season = await getActiveSeason()
  const groups = season ? await getAllGroups(season.id) : []

  const views: GroupView[] = await Promise.all(
    groups.map(async (g) => ({
      id: g.id,
      code: g.code,
      name: g.name,
      standings: g.standings,
      matches: await getGroupMatches(g.id),
    })),
  )

  return (
    <StaffShell active="standings" username={access.actor.username} seasonName={season?.name}>
      <h1 className="font-display text-2xl font-bold tracking-tight">Standings</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Recomputed automatically from verified results. Top {season?.qualifiersPerGroup ?? 2} per group
        (shaded) qualify for the playoffs.
      </p>
      {views.length === 0 ? (
        <p className="mt-6 text-sm text-muted-foreground">No groups yet.</p>
      ) : (
        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          {views.map((g) => (
            <GroupStandings key={g.id} group={g} />
          ))}
        </div>
      )}
    </StaffShell>
  )
}
