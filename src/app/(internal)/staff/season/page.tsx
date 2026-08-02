import type { Metadata } from 'next'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { StaffShell, StaffDenied } from '@/components/staff/staff-shell'
import { StaffGate } from '@/components/staff/staff-gate'
import { SeasonForm } from '@/components/staff/season-form'
import { resolveStaffAccess } from '@/lib/competition/staff-auth'
import { getActiveSeason } from '@/lib/competition/queries'

export const metadata: Metadata = { title: 'Season · Admin', robots: { index: false, follow: false } }

function toDateInput(d: Date | null): string | null {
  return d ? d.toISOString().slice(0, 10) : null
}

export default async function StaffSeasonPage() {
  const access = await resolveStaffAccess()
  if (access.status !== 'ok') return <StaffGate access={access} />
  if (!access.actor.can('manage_competitions'))
    return <StaffDenied active="seasons" username={access.actor.username} label="Seasons" />
  const season = await getActiveSeason()

  return (
    <StaffShell active="seasons" username={access.actor.username} seasonName={season?.name}>
      <h1 className="font-display text-2xl font-bold tracking-tight">Season settings</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        These control what the public site shows. Changes take effect immediately.
      </p>
      {season ? (
        <Card className="mt-6 max-w-3xl">
          <CardHeader>
            <CardTitle>{season.name}</CardTitle>
          </CardHeader>
          <CardContent>
            <SeasonForm
              season={{
                id: season.id,
                seasonStatus: season.seasonStatus,
                registrationStatus: season.registrationStatus,
                registrationOpensAt: toDateInput(season.registrationOpensAt),
                registrationClosesAt: toDateInput(season.registrationClosesAt),
                groupsStatus: season.groupsStatus,
                playoffsStatus: season.playoffsStatus,
                raceLength: season.raceLength,
                qualifiersPerGroup: season.qualifiersPerGroup,
              }}
            />
          </CardContent>
        </Card>
      ) : (
        <p className="mt-6 text-sm text-muted-foreground">No active season. Create one from the dashboard.</p>
      )}
    </StaffShell>
  )
}
