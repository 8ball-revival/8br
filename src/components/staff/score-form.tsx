'use client'

import { useActionState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { ActionResult } from '@/lib/competition/actions'

type Action = (prev: ActionResult, fd: FormData) => Promise<ActionResult>

/** Compact score-entry form (race-to-N). Server validates; errors show inline. */
export function ScoreForm({
  action,
  matchId,
  homeUsername,
  awayUsername,
  homeGames,
  awayGames,
  raceLength,
  confirm,
}: {
  action: Action
  matchId: number
  homeUsername: string
  awayUsername: string
  homeGames: number | null
  awayGames: number | null
  raceLength: number
  confirm?: string
}) {
  const [state, formAction, pending] = useActionState<ActionResult, FormData>(action, {})
  return (
    <form
      action={formAction}
      className="flex flex-wrap items-center gap-2"
      onSubmit={confirm ? (e) => { if (!window.confirm(confirm)) e.preventDefault() } : undefined}
    >
      <input type="hidden" name="matchId" value={matchId} />
      <span className="min-w-24 text-right text-sm">{homeUsername}</span>
      <Input
        type="number"
        name="homeGames"
        min={0}
        max={raceLength}
        defaultValue={homeGames ?? ''}
        aria-label={`${homeUsername} games`}
        className="w-16 text-center"
        required
      />
      <span className="text-muted-foreground">–</span>
      <Input
        type="number"
        name="awayGames"
        min={0}
        max={raceLength}
        defaultValue={awayGames ?? ''}
        aria-label={`${awayUsername} games`}
        className="w-16 text-center"
        required
      />
      <span className="min-w-24 text-sm">{awayUsername}</span>
      <Button type="submit" size="sm" variant="secondary" disabled={pending}>
        {pending ? '…' : 'Save'}
      </Button>
      {state.error && <span className="w-full text-xs text-destructive">{state.error}</span>}
    </form>
  )
}
