import type { PlayoffMatch, AuditLog } from '@prisma/client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ScoreForm } from '@/components/staff/score-form'
import { MatchNoteForm } from '@/components/staff/match-note-form'
import { MatchHistory } from '@/components/staff/match-history'
import { ActionButton } from '@/components/staff/action-button'
import { recordPlayoffScoreAction, verifyPlayoffMatchAction, undoPlayoffMatchAction, setPlayoffNoteAction } from '@/lib/competition/actions'
import { VERIFICATION_LABEL } from '@/lib/competition/labels'

/**
 * Playoff results entry (enter / edit / verify / undo / note / history) for every
 * match whose participants are set. Reused by the inline Playoffs edit mode — the
 * single management implementation (no separate staff editor).
 */
export function PlayoffResultsSection({
  matches,
  history,
  raceLength,
}: {
  matches: PlayoffMatch[]
  history: Map<string, AuditLog[]>
  raceLength: number
}) {
  const actionable = matches.filter((m) => m.homeRegistrationId != null && m.awayRegistrationId != null)
  if (actionable.length === 0) return null
  return (
    <Card className="mt-8">
      <CardHeader><CardTitle className="text-base">Enter / edit results</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        {actionable.map((m) => (
          <div key={m.id} className="rounded-md border border-border p-3">
            <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
              <span>{m.label}</span>
              <Badge variant={m.verification === 'VERIFIED' ? 'success' : 'muted'}>{VERIFICATION_LABEL[m.verification]}</Badge>
            </div>
            <ScoreForm
              action={recordPlayoffScoreAction}
              matchId={m.id}
              homeUsername={m.homeUsername ?? 'TBD'}
              awayUsername={m.awayUsername ?? 'TBD'}
              homeGames={m.homeGames}
              awayGames={m.awayGames}
              raceLength={raceLength}
              confirm={m.winnerRegistrationId != null ? 'Save this edited playoff score? Bracket advancement and rankings will be recalculated.' : 'Save this playoff result? Verify it to advance the winner.'}
            />
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {m.winnerRegistrationId != null && m.verification !== 'VERIFIED' && (
                <ActionButton action={verifyPlayoffMatchAction} fields={{ matchId: m.id }} label="Verify & advance winner" variant="secondary" />
              )}
              {(m.winnerRegistrationId != null || m.homeGames != null) && (
                <ActionButton
                  action={undoPlayoffMatchAction}
                  fields={{ matchId: m.id }}
                  label="Undo result"
                  variant="destructive"
                  confirm="Undo this playoff result? The score is cleared and, if the winner already advanced, that downstream slot is reverted."
                />
              )}
            </div>
            <div className="mt-2"><MatchNoteForm action={setPlayoffNoteAction} matchId={m.id} note={m.note} /></div>
            <MatchHistory entries={history.get(String(m.id)) ?? []} />
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
