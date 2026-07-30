'use client'

import { useActionState } from 'react'

import { Button } from '@/components/ui/button'
import { movePlayerAction, type ActionResult } from '@/lib/competition/actions'

/** Move one player to another group. Pre-publish is free; post-publish needs `force`. */
export function MovePlayerForm({
  seasonId,
  registrationId,
  currentGroupId,
  groups,
  locked,
}: {
  seasonId: number
  registrationId: number
  currentGroupId: number
  groups: { id: number; name: string }[]
  locked: boolean
}) {
  const [state, action, pending] = useActionState<ActionResult, FormData>(movePlayerAction, {})
  return (
    <form action={action} className="flex items-center gap-1.5">
      <input type="hidden" name="seasonId" value={seasonId} />
      <input type="hidden" name="registrationId" value={registrationId} />
      {locked && <input type="hidden" name="force" value="on" />}
      <select
        name="toGroupId"
        defaultValue={currentGroupId}
        className="h-8 rounded-md border border-input bg-background/60 px-2 text-xs"
        aria-label="Move to group"
      >
        {groups.map((g) => (
          <option key={g.id} value={g.id}>
            {g.name}
          </option>
        ))}
      </select>
      <Button type="submit" size="sm" variant="ghost" disabled={pending}>
        {pending ? '…' : 'Move'}
      </Button>
      {state.error && <span className="text-xs text-destructive">{state.error}</span>}
    </form>
  )
}
