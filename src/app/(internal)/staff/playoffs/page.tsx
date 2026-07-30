import type { Metadata } from 'next'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { StaffShell } from '@/components/staff/staff-shell'
import { StaffGate } from '@/components/staff/staff-gate'
import { BracketView } from '@/components/competition/bracket-view'
import { ScoreForm } from '@/components/staff/score-form'
import { ActionButton } from '@/components/staff/action-button'
import {
  generatePlayoffAction,
  publishPlayoffAction,
  recordPlayoffScoreAction,
  verifyPlayoffMatchAction,
} from '@/lib/competition/actions'
import { resolveStaffAccess } from '@/lib/competition/staff-auth'
import { getActiveSeason, getAllPlayoffMatches } from '@/lib/competition/queries'
import { VERIFICATION_LABEL } from '@/lib/competition/labels'

export const metadata: Metadata = { title: 'Playoffs · Admin', robots: { index: false, follow: false } }

export default async function StaffPlayoffsPage() {
  const access = await resolveStaffAccess()
  if (access.status !== 'ok') return <StaffGate access={access} />
  const season = await getActiveSeason()
  if (!season) {
    return (
      <StaffShell active="playoffs" username={access.actor.username}>
        <p className="text-sm text-muted-foreground">No active season.</p>
      </StaffShell>
    )
  }

  const matches = await getAllPlayoffMatches(season.id)
  const published = matches.some((m) => m.published)
  const actionable = matches.filter(
    (m) => m.homeRegistrationId != null && m.awayRegistrationId != null && m.verification !== 'VERIFIED',
  )

  return (
    <StaffShell active="playoffs" username={access.actor.username} seasonName={season.name}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-bold tracking-tight">Playoffs</h1>
        <div className="flex flex-wrap items-center gap-2">
          <ActionButton
            action={generatePlayoffAction}
            fields={{ seasonId: season.id, ...(published ? { force: 'on' } : {}) }}
            label={matches.length ? 'Regenerate bracket' : 'Generate bracket'}
            variant={matches.length ? 'outline' : 'default'}
            confirm={matches.length ? 'Regenerate the bracket from current standings? Existing results are cleared.' : undefined}
          />
          {matches.length > 0 &&
            (published ? (
              <Badge variant="success">Published</Badge>
            ) : (
              <ActionButton action={publishPlayoffAction} fields={{ seasonId: season.id }} label="Publish playoffs" confirm="Publish the bracket to the public site?" />
            ))}
        </div>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        Seeded from group standings (group winners above runners-up). Generate after the group stage is
        complete and results verified.
      </p>

      {matches.length === 0 ? (
        <p className="mt-6 text-sm text-muted-foreground">
          No bracket yet. Generate it once enough players have qualified from the groups.
        </p>
      ) : (
        <>
          <div className="mt-6">
            <BracketView matches={matches} />
          </div>

          {actionable.length > 0 && (
            <Card className="mt-8">
              <CardHeader>
                <CardTitle className="text-base">Enter results</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {actionable.map((m) => (
                  <div key={m.id} className="rounded-md border border-border p-3">
                    <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
                      <span>{m.label}</span>
                      <Badge variant={m.verification === 'VERIFIED' ? 'success' : 'muted'}>
                        {VERIFICATION_LABEL[m.verification]}
                      </Badge>
                    </div>
                    <ScoreForm
                      action={recordPlayoffScoreAction}
                      matchId={m.id}
                      homeUsername={m.homeUsername ?? 'TBD'}
                      awayUsername={m.awayUsername ?? 'TBD'}
                      homeGames={m.homeGames}
                      awayGames={m.awayGames}
                      raceLength={season.raceLength}
                    />
                    {m.winnerRegistrationId != null && (
                      <div className="mt-2">
                        <ActionButton action={verifyPlayoffMatchAction} fields={{ matchId: m.id }} label="Verify & advance winner" variant="secondary" />
                      </div>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </StaffShell>
  )
}
