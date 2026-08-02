import type { Metadata } from 'next'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { StaffShell, StaffDenied } from '@/components/staff/staff-shell'
import { StaffGate } from '@/components/staff/staff-gate'
import { SeasonForm } from '@/components/staff/season-form'
import { ActionButton } from '@/components/staff/action-button'
import { setRegistrationStateAction } from '@/lib/competition/actions'
import { resolveStaffAccess } from '@/lib/competition/staff-auth'
import { getActiveSeason } from '@/lib/competition/queries'
import { REGISTRATION_STATE_LABEL } from '@/lib/competition/labels'

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
        <>
          {/* Registration control — the manual status is authoritative (a deadline
              is informational only; registration is allowed only when OPEN). */}
          <Card className="mt-6 max-w-3xl border-gold/30">
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle>Season 2 Registration</CardTitle>
                <Badge variant={season.registrationStatus === 'OPEN' ? 'success' : 'muted'}>
                  {REGISTRATION_STATE_LABEL[season.registrationStatus]}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">
                This status controls registration site-wide. When OPEN, users can register and withdraw and appear on
                the public list immediately. When CLOSED, new registrations, re-registrations, and self-withdrawals are
                all blocked; existing entrants stay visible. Each change is recorded in the audit log.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                {season.registrationStatus !== 'OPEN' && (
                  <ActionButton
                    action={setRegistrationStateAction}
                    fields={{ seasonId: season.id, next: 'OPEN' }}
                    label={season.registrationStatus === 'CLOSED' ? 'Reopen Registration' : 'Open Registration'}
                    confirm={
                      season.registrationStatus === 'CLOSED'
                        ? 'Reopen registration? Users will be able to register and withdraw again.'
                        : 'Open registration? Users will be able to register immediately.'
                    }
                  />
                )}
                {season.registrationStatus === 'OPEN' && (
                  <ActionButton
                    action={setRegistrationStateAction}
                    fields={{ seasonId: season.id, next: 'CLOSED' }}
                    label="Close Registration"
                    variant="outline"
                    confirm="Close registration? New registrations and member self-withdrawals will be blocked. Existing entrants remain visible."
                  />
                )}
              </div>
            </CardContent>
          </Card>

          <Card className="mt-6 max-w-3xl">
          <CardHeader>
            <CardTitle>{season.name}</CardTitle>
          </CardHeader>
          <CardContent>
            <SeasonForm
              season={{
                id: season.id,
                seasonStatus: season.seasonStatus,
                registrationClosesAt: toDateInput(season.registrationClosesAt),
                groupsStatus: season.groupsStatus,
                playoffsStatus: season.playoffsStatus,
                raceLength: season.raceLength,
                qualifiersPerGroup: season.qualifiersPerGroup,
              }}
            />
          </CardContent>
          </Card>
        </>
      ) : (
        <p className="mt-6 text-sm text-muted-foreground">No active season. Create one from the dashboard.</p>
      )}
    </StaffShell>
  )
}
