import type { Metadata } from 'next'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { StaffShell, StaffDenied } from '@/components/staff/staff-shell'
import { StaffGate } from '@/components/staff/staff-gate'
import { ScoreForm } from '@/components/staff/score-form'
import { MatchExtras } from '@/components/staff/match-extras'
import { MatchNoteForm } from '@/components/staff/match-note-form'
import { MatchHistory } from '@/components/staff/match-history'
import { ActionButton } from '@/components/staff/action-button'
import { recordScoreAction, verifyMatchAction, undoMatchAction, setMatchNoteAction } from '@/lib/competition/actions'
import { resolveStaffAccess } from '@/lib/competition/staff-auth'
import { getActiveSeason, getAllGroups, getSeasonMatches, getMatchHistory } from '@/lib/competition/queries'
import { MATCH_STATUS_LABEL, VERIFICATION_LABEL } from '@/lib/competition/labels'

export const metadata: Metadata = { title: 'Matches · Admin', robots: { index: false, follow: false } }

export default async function StaffMatchesPage() {
  const access = await resolveStaffAccess()
  if (access.status !== 'ok') return <StaffGate access={access} />
  if (!access.actor.can('edit_results'))
    return <StaffDenied active="matches" username={access.actor.username} label="Matches" />
  const season = await getActiveSeason()
  if (!season) {
    return (
      <StaffShell active="matches" username={access.actor.username}>
        <p className="text-sm text-muted-foreground">No active season.</p>
      </StaffShell>
    )
  }

  const [groups, matches] = await Promise.all([getAllGroups(season.id), getSeasonMatches(season.id)])
  const groupName = new Map(groups.map((g) => [g.id, g.name]))
  const history = await getMatchHistory('Match', matches.map((m) => m.id))

  return (
    <StaffShell active="matches" username={access.actor.username} seasonName={season.name}>
      <h1 className="font-display text-2xl font-bold tracking-tight">Matches &amp; results</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Race to {season.raceLength}. Record a score, then verify it — only verified results count toward
        standings.
      </p>

      {matches.length === 0 ? (
        <p className="mt-6 text-sm text-muted-foreground">
          No matches yet. Publish groups to generate the round-robin schedule.
        </p>
      ) : (
        <div className="mt-6 space-y-6">
          {groups.map((g) => {
            const gm = matches.filter((m) => m.groupId === g.id)
            if (gm.length === 0) return null
            return (
              <Card key={g.id}>
                <CardHeader>
                  <CardTitle className="text-base">{groupName.get(g.id)}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {gm.map((m) => {
                    const decided = m.winnerRegistrationId != null
                    const verified = m.verification === 'VERIFIED'
                    return (
                      <div key={m.id} className="rounded-md border border-border p-3">
                        <div className="mb-2 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                          <span>Round {m.round}</span>
                          <span className="flex items-center gap-2">
                            <Badge variant={m.status === 'DISPUTED' ? 'destructive' : decided ? 'success' : 'muted'}>
                              {MATCH_STATUS_LABEL[m.status]}
                            </Badge>
                            <Badge variant={verified ? 'success' : 'muted'}>{VERIFICATION_LABEL[m.verification]}</Badge>
                          </span>
                        </div>
                        <ScoreForm
                          action={recordScoreAction}
                          matchId={m.id}
                          homeUsername={m.homeUsername}
                          awayUsername={m.awayUsername}
                          homeGames={m.homeGames}
                          awayGames={m.awayGames}
                          raceLength={season.raceLength}
                          confirm={decided ? 'Save this edited score? Group standings, rankings, and player statistics will be recalculated.' : 'Save this result? Group standings will update once verified, and rankings recalculate.'}
                        />
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          {decided && !verified && (
                            <ActionButton action={verifyMatchAction} fields={{ matchId: m.id, verified: 'true' }} label="Verify" variant="secondary" />
                          )}
                          {verified && (
                            <ActionButton action={verifyMatchAction} fields={{ matchId: m.id, verified: 'false' }} label="Unverify" variant="ghost" />
                          )}
                          {(decided || m.homeGames != null) && (
                            <ActionButton
                              action={undoMatchAction}
                              fields={{ matchId: m.id }}
                              label="Undo result"
                              variant="destructive"
                              confirm="Undo this result? It reverts to unplayed and recalculates group standings, rankings, and player statistics."
                            />
                          )}
                          <MatchExtras
                            matchId={m.id}
                            homeRegistrationId={m.homeRegistrationId}
                            awayRegistrationId={m.awayRegistrationId}
                            homeUsername={m.homeUsername}
                            awayUsername={m.awayUsername}
                          />
                        </div>
                        <div className="mt-2">
                          <MatchNoteForm action={setMatchNoteAction} matchId={m.id} note={m.note} />
                        </div>
                        <MatchHistory entries={history.get(String(m.id)) ?? []} />
                      </div>
                    )
                  })}
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </StaffShell>
  )
}
