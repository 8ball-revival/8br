'use client'

import { useActionState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { ActionResult } from '@/lib/competition/actions'

type Action = (prev: ActionResult, fd: FormData) => Promise<ActionResult>

/** Optional admin note on a match result (group or playoff). Blank clears it. */
export function MatchNoteForm({ action, matchId, note }: { action: Action; matchId: number; note: string | null }) {
  const [state, formAction, pending] = useActionState<ActionResult, FormData>(action, {})
  return (
    <form action={formAction} className="flex flex-wrap items-center gap-1.5">
      <input type="hidden" name="matchId" value={matchId} />
      <Input
        name="note"
        defaultValue={note ?? ''}
        placeholder="Admin note (optional)…"
        className="h-8 w-64 max-w-full text-xs"
        aria-label="Admin note"
      />
      <Button type="submit" size="sm" variant="ghost" disabled={pending}>
        {pending ? '…' : 'Save note'}
      </Button>
      {state.error && <span className="text-xs text-destructive">{state.error}</span>}
      {state.message && <span className="text-xs text-success">{state.message}</span>}
    </form>
  )
}
