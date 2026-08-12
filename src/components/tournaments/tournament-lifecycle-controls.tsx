'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Play, Lock, Unlock, CheckCircle2, GitBranch, RefreshCw, AlertTriangle } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  setCupStateAction,
  recoverCupStateAction,
  beginCupTournamentAction,
  generateCupBracketAction,
  reopenCupRegistrationAction,
} from '@/lib/competition/tournament-actions'

type State = 'DRAFT' | 'REGISTRATION_OPEN' | 'REGISTRATION_CLOSED' | 'BRACKET_GENERATED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED'

const LABEL: Record<State, string> = {
  DRAFT: 'Draft',
  REGISTRATION_OPEN: 'Registration Open',
  REGISTRATION_CLOSED: 'Registration Closed',
  BRACKET_GENERATED: 'Bracket Ready',
  IN_PROGRESS: 'Tournament Live',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
}

/**
 * Primary tournament-lifecycle actions (shown on the Overview). Only the VALID next actions for the
 * current state are offered; the server enforces the same transitions and audits them. Registration
 * is a toggle (Close ⇄ Re-Open) that is permanently locked once the tournament is live. Generate Brackets
 * jumps to the Bracket tab; Start Tournament (confirmed) jumps to the Results tab. Cancelling/deleting a
 * cup is intentionally NOT here — it lives in the Settings tab. Owners get a recovery control.
 */
export function CupLifecycleControls({
  tournamentId,
  state,
  isOwner,
  bracketStale = false,
  onNavigate,
}: {
  tournamentId: number
  state: State
  isOwner: boolean
  bracketStale?: boolean
  onNavigate?: (tab: 'bracket' | 'results') => void
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState<{ ok?: boolean; text: string } | null>(null)

  const act = (fn: () => Promise<{ ok?: boolean; error?: string; message?: string; navigate?: 'bracket' | 'results' }>, confirm?: string) => {
    if (confirm && !window.confirm(confirm)) return
    setMsg(null)
    start(async () => {
      const r = await fn()
      if (r.error) setMsg({ text: r.error })
      else {
        setMsg({ ok: true, text: r.message ?? 'Updated.' })
        if (r.navigate && onNavigate) onNavigate(r.navigate)
        router.refresh()
      }
    })
  }

  const recover = (to: State) => {
    const reason = window.prompt(`Recovery: force this tournament to "${LABEL[to]}"? Enter a reason (Owner action, audited):`)
    if (reason == null) return
    if (!reason.trim()) { setMsg({ text: 'A reason is required.' }); return }
    setMsg(null)
    start(async () => {
      const r = await recoverCupStateAction(tournamentId, to, reason)
      if (r.error) setMsg({ text: r.error })
      else { setMsg({ ok: true, text: r.message ?? 'Recovered.' }); router.refresh() }
    })
  }

  const badgeVariant = state === 'COMPLETED' ? 'gold' : state === 'CANCELLED' ? 'muted' : state === 'IN_PROGRESS' ? 'destructive' : 'success'

  return (
    <div className="mb-6 rounded-lg border border-border bg-card/40 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm text-muted-foreground">Lifecycle:</span>
        <Badge variant={badgeVariant}>{LABEL[state]}</Badge>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {state === 'DRAFT' && (
            <Button size="sm" disabled={pending} onClick={() => act(() => setCupStateAction(tournamentId, 'REGISTRATION_OPEN'))}>
              <Unlock className="size-4" /> Open registration
            </Button>
          )}

          {state === 'REGISTRATION_OPEN' && (
            <Button size="sm" variant="outline" disabled={pending} onClick={() => act(() => setCupStateAction(tournamentId, 'REGISTRATION_CLOSED'), 'Close registration? No new sign-ups or self-withdrawals after this.')}>
              <Lock className="size-4" /> Close Registration
            </Button>
          )}

          {state === 'REGISTRATION_CLOSED' && (
            <>
              <Button size="sm" variant="outline" disabled={pending} onClick={() => act(() => reopenCupRegistrationAction(tournamentId))}>
                <Unlock className="size-4" /> Re-Open Registration
              </Button>
              <Button size="sm" disabled={pending} onClick={() => act(() => generateCupBracketAction(tournamentId))}>
                <GitBranch className="size-4" /> Generate Brackets
              </Button>
            </>
          )}

          {state === 'BRACKET_GENERATED' && (
            <>
              <Button size="sm" variant="outline" disabled={pending} onClick={() => act(() => reopenCupRegistrationAction(tournamentId), 'Re-open registration? The current bracket will be outdated and must be regenerated before the tournament can start.')}>
                <Unlock className="size-4" /> Re-Open Registration
              </Button>
              {bracketStale ? (
                <Button size="sm" disabled={pending} onClick={() => act(() => generateCupBracketAction(tournamentId))}>
                  <RefreshCw className="size-4" /> Regenerate Bracket
                </Button>
              ) : (
                <Button size="sm" disabled={pending} onClick={() => act(() => beginCupTournamentAction(tournamentId), 'Start Tournament?\n\nThis will make the tournament live, permanently lock registration, and enable match reporting.')}>
                  <Play className="size-4" /> Start Tournament
                </Button>
              )}
            </>
          )}

          {state === 'IN_PROGRESS' && (
            <Button size="sm" disabled={pending} onClick={() => act(() => setCupStateAction(tournamentId, 'COMPLETED'), 'Complete this tournament? The Final must have a confirmed winner. This applies the ladder and locks the bracket.')}>
              <CheckCircle2 className="size-4" /> Complete tournament
            </Button>
          )}

          {isOwner && (state === 'COMPLETED' || state === 'CANCELLED') && (
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => recover('IN_PROGRESS')}>Recover → In Progress</Button>
          )}
        </div>
      </div>

      {state === 'BRACKET_GENERATED' && bracketStale && (
        <p className="mt-2 inline-flex items-center gap-1.5 text-sm text-amber-500">
          <AlertTriangle className="size-4" /> The entrant list changed after this bracket was generated — regenerate it before starting the tournament.
        </p>
      )}
      {msg && <p role="status" className={`mt-2 text-sm ${msg.ok ? 'text-success' : 'text-destructive'}`}>{msg.text}</p>}
    </div>
  )
}
