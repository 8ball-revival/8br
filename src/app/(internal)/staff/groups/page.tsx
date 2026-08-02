import type { Metadata } from 'next'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { StaffShell, StaffDenied } from '@/components/staff/staff-shell'
import { StaffGate } from '@/components/staff/staff-gate'
import { GenerateGroupsForm } from '@/components/staff/generate-groups-form'
import { MovePlayerForm } from '@/components/staff/move-player-form'
import { ActionButton } from '@/components/staff/action-button'
import { publishGroupsAction } from '@/lib/competition/actions'
import { resolveStaffAccess } from '@/lib/competition/staff-auth'
import { getActiveSeason, getAllGroups, getApprovedCount } from '@/lib/competition/queries'

export const metadata: Metadata = { title: 'Groups · Admin', robots: { index: false, follow: false } }

export default async function StaffGroupsPage() {
  const access = await resolveStaffAccess()
  if (access.status !== 'ok') return <StaffGate access={access} />
  if (!access.actor.can('manage_competitions'))
    return <StaffDenied active="seasons" username={access.actor.username} label="Seasons" />
  const season = await getActiveSeason()

  if (!season) {
    return (
      <StaffShell active="seasons" username={access.actor.username}>
        <p className="text-sm text-muted-foreground">No active season. Create one from the dashboard.</p>
      </StaffShell>
    )
  }

  const [groups, approvedCount] = await Promise.all([getAllGroups(season.id), getApprovedCount(season.id)])
  const published = groups.some((g) => g.published)
  const groupOptions = groups.map((g) => ({ id: g.id, name: g.name }))

  return (
    <StaffShell active="seasons" username={access.actor.username} seasonName={season.name}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-bold tracking-tight">Groups</h1>
        {groups.length > 0 &&
          (published ? (
            <Badge variant="success">Published</Badge>
          ) : (
            <ActionButton
              action={publishGroupsAction}
              fields={{ seasonId: season.id }}
              label="Publish groups"
              confirm="Publish groups? This generates round-robin matches and shows them on the public site."
            />
          ))}
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base">Draw groups</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-sm text-muted-foreground">
            Deterministic &amp; seeded — the recorded seed reproduces the exact draw. Generated groups are
            a draft (a preview) you can adjust before publishing. {approvedCount} approved player(s).
          </p>
          <GenerateGroupsForm seasonId={season.id} approvedCount={approvedCount} alreadyPublished={published} />
        </CardContent>
      </Card>

      {groups.length > 0 && (
        <div className="mt-6 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {groups.map((g) => (
            <Card key={g.id}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">{g.name}</CardTitle>
                  <Badge variant="muted">{g.players.length} players</Badge>
                </div>
                {g.generationSeed && (
                  <p className="truncate text-xs text-muted-foreground">seed: {g.generationSeed}</p>
                )}
              </CardHeader>
              <CardContent>
                <ol className="space-y-2 text-sm">
                  {g.players.map((p) => (
                    <li key={p.id} className="flex items-center justify-between gap-2">
                      <span>
                        <span className="tabular text-xs text-muted-foreground">{p.seed}.</span>{' '}
                        {p.registration.username}
                      </span>
                      {groupOptions.length > 1 && (
                        <MovePlayerForm
                          seasonId={season.id}
                          registrationId={p.registrationId}
                          currentGroupId={g.id}
                          groups={groupOptions}
                          locked={published}
                        />
                      )}
                    </li>
                  ))}
                </ol>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </StaffShell>
  )
}
