'use client'

import { useActionState } from 'react'

import { Button } from '@/components/ui/button'
import { setResolutionAction, type ActionResult } from '@/lib/competition/actions'

/** Forfeit / no-show (award to a chosen player) or mark disputed. */
export function MatchExtras({
  matchId,
  homeRegistrationId,
  awayRegistrationId,
  homeUsername,
  awayUsername,
}: {
  matchId: number
  homeRegistrationId: number
  awayRegistrationId: number
  homeUsername: string
  awayUsername: string
}) {
  const [state, action, pending] = useActionState<ActionResult, FormData>(setResolutionAction, {})
  return (
    <form action={action} className="flex flex-wrap items-center gap-1.5 text-xs">
      <input type="hidden" name="matchId" value={matchId} />
      <select name="winnerRegistrationId" className="h-8 rounded-md border border-input bg-background/60 px-2" aria-label="Winner (for forfeit/no-show)">
        <option value={homeRegistrationId}>{homeUsername} advances</option>
        <option value={awayRegistrationId}>{awayUsername} advances</option>
      </select>
      <Button type="submit" name="kind" value="FORFEIT" size="sm" variant="outline" disabled={pending}>
        Forfeit
      </Button>
      <Button type="submit" name="kind" value="NO_SHOW" size="sm" variant="outline" disabled={pending}>
        No-show
      </Button>
      <Button type="submit" name="kind" value="DISPUTED" size="sm" variant="ghost" disabled={pending}>
        Dispute
      </Button>
      {state.error && <span className="w-full text-destructive">{state.error}</span>}
    </form>
  )
}
