'use client'

import { useState, useTransition } from 'react'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { useRouter } from 'next/navigation'
import { Play, Lock, Unlock, CheckCircle2, GitBranch, RefreshCw, AlertTriangle, Users, Trophy, Swords } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  setTournamentStateAction,
  recoverTournamentStateAction,
  beginTournamentAction,
  generateTournamentBracketAction,
  generateRandomTeamsAction,
  reopenTournamentRegistrationAction,
  startGroupStageAction,
  confirmQualifiersAction,
  startSwissAction,
  completeSwissAction,
} from '@/lib/competition/tournament-actions'

type State = 'DRAFT' | 'REGISTRATION_OPEN' | 'REGISTRATION_CLOSED' | 'GROUPS_IN_PROGRESS' | 'BRACKET_GENERATED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED'
type NavTab = 'bracket' | 'results' | 'groups'

const LABEL: Record<State, string> = {
  DRAFT: 'Draft',
  REGISTRATION_OPEN: 'Registration Open',
  REGISTRATION_CLOSED: 'Registration Closed',
  GROUPS_IN_PROGRESS: 'Group Stage',
  BRACKET_GENERATED: 'Bracket Ready',
  IN_PROGRESS: 'Tournament Live',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
}

/**
 * Primary tournament-lifecycle actions. Only the VALID next actions for the current state are
 * offered; the server enforces the same transitions and audits them. For Group Stage + Playoffs
 * tournaments the group phase (Start Group Stage → Confirm Qualifiers) is inserted before the
 * bracket; bracket-only tournaments are unchanged.
 */
export function TournamentLifecycleControls({
  tournamentId,
  state,
  isOwner,
  bracketStale = false,
  isGroupStage = false,
  isSwiss = false,
  isRandom = false,
  groupsComplete = false,
  onNavigate,
}: {
  tournamentId: number
  state: State
  isOwner: boolean
  bracketStale?: boolean
  isGroupStage?: boolean
  isSwiss?: boolean
  isRandom?: boolean
  groupsComplete?: boolean
  onNavigate?: (tab: NavTab) => void
}) {
  const router = useRouter()
  const confirm = useConfirm()
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState<{ ok?: boolean; text: string } | null>(null)

  const go = (fn: () => Promise<{ ok?: boolean; error?: string; message?: string; navigate?: NavTab }>) => {
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
  // Lifecycle actions that carry a confirmation prompt go through the 8BR modal (explicit click).
  const act = (fn: () => Promise<{ ok?: boolean; error?: string; message?: string; navigate?: NavTab }>, confirmText?: string) => {
    if (!confirmText) { go(fn); return }
    void confirm({ title: 'Confirm this action?', message: confirmText, confirmLabel: 'Confirm', cancelLabel: 'Cancel', tone: 'warning' }).then((res) => { if (res.confirmed) go(fn) })
  }

  const recover = async (to: State) => {
    const res = await confirm({ title: `Recovery: force to "${LABEL[to]}"?`, message: 'Owner recovery action — this is audited. Enter a reason.', confirmLabel: 'Force state', cancelLabel: 'Cancel', tone: 'danger', input: { label: 'Reason (required)', required: true } })
    if (!res.confirmed) return
    setMsg(null)
    start(async () => {
      const r = await recoverTournamentStateAction(tournamentId, to, res.value)
      if (r.error) setMsg({ text: r.error })
      else { setMsg({ ok: true, text: r.message ?? 'Recovered.' }); router.refresh() }
    })
  }

  const badgeVariant = state === 'COMPLETED' ? 'default' : state === 'CANCELLED' ? 'muted' : state === 'IN_PROGRESS' ? 'destructive' : 'success'

  return (
    <div className="mb-6 rounded-lg border border-border bg-card/40 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm text-muted-foreground">Lifecycle:</span>
        <Badge variant={badgeVariant}>{LABEL[state]}</Badge>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {state === 'DRAFT' && (
            <Button size="sm" disabled={pending} onClick={() => act(() => setTournamentStateAction(tournamentId, 'REGISTRATION_OPEN'))}>
              <Unlock className="size-4" /> Open registration
            </Button>
          )}

          {state === 'REGISTRATION_OPEN' && (
            <Button size="sm" variant="outline" disabled={pending} onClick={() => act(() => setTournamentStateAction(tournamentId, 'REGISTRATION_CLOSED'), 'Close registration? No new sign-ups or self-withdrawals after this.')}>
              <Lock className="size-4" /> Close Registration
            </Button>
          )}

          {/* RANDOM tournaments: the ONLY progression is the one-time, atomic Generate Teams. No
              re-open, no manual bracket, no groups/swiss — teams are drawn once, locked, and the
              bracket goes live immediately. */}
          {state === 'REGISTRATION_CLOSED' && isRandom && (
            <Button
              size="sm"
              disabled={pending}
              onClick={() => act(
                () => generateRandomTeamsAction(tournamentId),
                'Generate teams now?\n\nTeams are drawn ONCE and permanently locked, and the bracket immediately becomes public. This cannot be undone or regenerated.',
              )}
            >
              <Users className="size-4" /> Generate Teams
            </Button>
          )}

          {state === 'REGISTRATION_CLOSED' && !isRandom && (
            <>
              <Button size="sm" variant="outline" disabled={pending} onClick={() => act(() => reopenTournamentRegistrationAction(tournamentId))}>
                <Unlock className="size-4" /> Re-Open Registration
              </Button>
              {isGroupStage ? (
                <Button size="sm" disabled={pending} onClick={() => act(() => startGroupStageAction(tournamentId), 'Set up groups? Registration locks and the Group Setup board opens so you can organize the groups before publishing.')}>
                  <Users className="size-4" /> Set Up Groups
                </Button>
              ) : isSwiss ? (
                <Button size="sm" disabled={pending} onClick={() => act(() => startSwissAction(tournamentId), 'Start the Swiss rounds? Round 1 is paired from the current entrants.')}>
                  <Swords className="size-4" /> Start Swiss
                </Button>
              ) : (
                <Button size="sm" disabled={pending} onClick={() => act(() => generateTournamentBracketAction(tournamentId))}>
                  <GitBranch className="size-4" /> Generate Brackets
                </Button>
              )}
            </>
          )}

          {state === 'GROUPS_IN_PROGRESS' && (
            <Button
              size="sm"
              disabled={pending || !groupsComplete}
              title={groupsComplete ? undefined : 'Every group match needs a result first.'}
              onClick={() => act(() => confirmQualifiersAction(tournamentId), 'Confirm qualifiers and seed the playoff bracket? The qualifying players advance into the bracket.')}
            >
              <Trophy className="size-4" /> Confirm Qualifiers &amp; Seed Bracket
            </Button>
          )}

          {state === 'BRACKET_GENERATED' && (
            <>
              {/* Re-opening registration here scraps the bracket — destructive once play has begun. A
                  Group Stage + Playoffs tournament already has group results at this point, so it is
                  hidden there; a bracket-only tournament has no results yet, so it stays available. */}
              {!isGroupStage && (
                <Button size="sm" variant="outline" disabled={pending} onClick={() => act(() => reopenTournamentRegistrationAction(tournamentId), 'Re-open registration? The current bracket will be outdated and must be regenerated before the Tournament can start.')}>
                  <Unlock className="size-4" /> Re-Open Registration
                </Button>
              )}
              {bracketStale && !isGroupStage ? (
                <Button size="sm" disabled={pending} onClick={() => act(() => generateTournamentBracketAction(tournamentId))}>
                  <RefreshCw className="size-4" /> Regenerate Bracket
                </Button>
              ) : (
                <Button size="sm" disabled={pending} onClick={() => act(() => beginTournamentAction(tournamentId), 'Start Tournament?\n\nThis will make the Tournament live, permanently lock registration, and enable match reporting.')}>
                  <Play className="size-4" /> Start Tournament
                </Button>
              )}
            </>
          )}

          {state === 'IN_PROGRESS' && isSwiss && (
            <Button size="sm" disabled={pending} onClick={() => act(() => completeSwissAction(tournamentId), 'Complete this Swiss Tournament? Every round must be reported. This applies the individual Rankings update.')}>
              <CheckCircle2 className="size-4" /> Complete Tournament
            </Button>
          )}
          {state === 'IN_PROGRESS' && !isSwiss && (
            <Button size="sm" disabled={pending} onClick={() => act(() => setTournamentStateAction(tournamentId, 'COMPLETED'), 'Complete this Tournament? The Final must have a confirmed winner. This applies the ladder and locks the bracket.')}>
              <CheckCircle2 className="size-4" /> Complete Tournament
            </Button>
          )}

          {isOwner && (state === 'COMPLETED' || state === 'CANCELLED') && (
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => recover('IN_PROGRESS')}>Recover → In Progress</Button>
          )}
        </div>
      </div>

      {state === 'BRACKET_GENERATED' && bracketStale && !isGroupStage && (
        <p className="mt-2 inline-flex items-center gap-1.5 text-sm text-[var(--gold)]">
          <AlertTriangle className="size-4" /> The entrant list changed after this bracket was generated — regenerate it before starting the tournament.
        </p>
      )}
      {state === 'GROUPS_IN_PROGRESS' && !groupsComplete && (
        <p className="mt-2 inline-flex items-center gap-1.5 text-sm text-muted-foreground">
          <AlertTriangle className="size-4" /> Enter every group result in the Groups tab, then confirm qualifiers.
        </p>
      )}
      {msg && <p role="status" className={`mt-2 text-sm ${msg.ok ? 'text-success' : 'text-destructive'}`}>{msg.text}</p>}
    </div>
  )
}
