'use client'

/**
 * A Tournament being played: the Season's scoring board, plus the one control that ends it.
 *
 * ── Why the completion control lives here ───────────────────────────────────────────────────────
 * The board knows a champion exists — it has just watched the final resolve — but ending a
 * Tournament is not a scoring action, and burying it inside the board would put an irreversible
 * step in the middle of a screen whose every other control is reversible. It appears underneath,
 * only once there is a champion, and it says who it is about to crown.
 */

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

import { cn } from '@/lib/utils'
import { identityText } from '@/lib/identity/display'
import { PlayoffScoring, ChampionBanner, type ScoringRound } from './playoff-scoring'
import { tournamentScoringApi } from './tournament-scoring-api'
import { completeTournamentAction } from '@/lib/competition/tournament-actions'

export interface LiveChampion {
  name: string
  cueverseId: string | null
  runnerUp: string | null
  runnerUpCueverseId: string | null
  finalScore: string | null
  byForfeit: boolean
}

export function TournamentLiveBracket({
  tournamentId, rounds, champion, isCompleted,
}: {
  tournamentId: number
  rounds: ScoringRound[]
  /** Present once the final has produced a winner. Null while anything is still to be decided. */
  champion: LiveChampion | null
  isCompleted: boolean
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)

  return (
    <div className="space-y-4">
      {champion && (
        <ChampionBanner
          champion={champion.name}
          championCueverseId={champion.cueverseId}
          runnerUp={champion.runnerUp}
          runnerUpCueverseId={champion.runnerUpCueverseId}
          byForfeit={champion.byForfeit}
        />
      )}

      {error && (
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      <PlayoffScoring rounds={rounds} api={tournamentScoringApi()} />

      {champion && !isCompleted && (
        <div className="flex flex-wrap items-center gap-3 cyber-clip border border-[var(--gold)]/40 bg-[var(--selected-surface)] px-3 py-2.5">
          <p className="min-w-0 flex-1 text-sm text-foreground">
            The final is decided. Closing records the champion and locks the bracket.
          </p>
          <button
            type="button"
            disabled={pending}
            onClick={() => setConfirming(true)}
            className="cyber-clip-sm bg-[var(--gold)] px-3 py-1.5 text-sm font-semibold text-black transition-opacity hover:opacity-90 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]/60"
          >
            Close Tournament &amp; Crown Champion
          </button>
        </div>
      )}

      {isCompleted && (
        <p className="cyber-clip border border-border px-3 py-2 text-sm text-muted-foreground">
          This Tournament is complete and the bracket is locked. A correction goes through the
          audited reopen.
        </p>
      )}

      {confirming && champion && (
        <CrownDialog
          champion={champion}
          pending={pending}
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            setConfirming(false)
            setError(null)
            start(async () => {
              const r = await completeTournamentAction(tournamentId)
              if (r.error) { setError(r.error); return }
              router.refresh()
            })
          }}
        />
      )}
    </div>
  )
}

/** Who is being crowned, and over whom — read before the irreversible step, not after it. */
function CrownDialog({
  champion, pending, onCancel, onConfirm,
}: {
  champion: LiveChampion
  pending: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  const name = identityText({ cueverseId: champion.cueverseId, preferredName: champion.name })
  const runnerUp = champion.runnerUp
    ? identityText({ cueverseId: champion.runnerUpCueverseId, preferredName: champion.runnerUp })
    : null

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="crown-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-none border border-border bg-card p-5 shadow-xl">
        <h2 id="crown-title" className="font-display text-lg font-bold text-foreground">
          Crown {name}?
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The Tournament is marked complete, the bracket locks, and the result reaches the rankings
          and the records. A correction afterwards goes through the audited reopen.
        </p>

        <dl className="mt-4 space-y-1.5 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Champion</dt>
            <dd className="font-semibold text-[var(--gold)]">{name}</dd>
          </div>
          {runnerUp && (
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Runner-up</dt>
              <dd className="font-semibold text-foreground">{runnerUp}</dd>
            </div>
          )}
          {champion.finalScore && (
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Final</dt>
              <dd className={cn('tabular font-semibold text-foreground')}>{champion.finalScore}</dd>
            </div>
          )}
        </dl>

        {champion.byForfeit && (
          <p className="mt-3 rounded-md border border-[var(--gold)]/40 bg-[var(--selected-surface)] px-3 py-2 text-sm text-foreground">
            The final was decided by a forfeit.
          </p>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onCancel}
            className="cyber-clip-sm border border-border px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]/60">
            Not yet
          </button>
          <button type="button" onClick={onConfirm} disabled={pending}
            className="cyber-clip-sm bg-[var(--gold)] px-3 py-1.5 text-sm font-semibold text-black transition-opacity hover:opacity-90 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]/60">
            {pending ? 'Closing…' : 'Close & Crown'}
          </button>
        </div>
      </div>
    </div>
  )
}
