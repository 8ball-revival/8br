'use client'

import { useActionState } from 'react'
import { changeMyCueverseId } from '@/lib/account/actions'
import { Button } from '@/components/ui/button'

/**
 * Self-service CueVerse ID change. The CueVerse ID is the player's public identity
 * across the whole site; changing it propagates everywhere via the linked profile.
 * There is no waiting period between changes. The old ID stays searchable, so renaming never
 * strands anyone's history or their old links.
 */
export function CueverseIdForm({
  current,
  canChange,
}: {
  current: string | null
  canChange: boolean
}) {
  const [state, action, pending] = useActionState(changeMyCueverseId, {} as { ok?: boolean; error?: string })

  return (
    <form action={action} className="space-y-2">
      <label className="eyebrow text-muted-foreground" htmlFor="cueverseId">
        CueVerse ID (your public identity)
      </label>
      <div className="flex gap-2">
        <input
          id="cueverseId"
          name="cueverseId"
          defaultValue={current ?? ''}
          disabled={!canChange || pending}
          maxLength={40}
          placeholder="e.g. Starkiller"
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm disabled:opacity-60"
        />
        <Button type="submit" size="sm" disabled={!canChange || pending}>
          {pending ? 'Saving…' : 'Save'}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">Your old ID stays searchable.</p>
      {state?.error && <p className="text-sm text-destructive">{state.error}</p>}
      {state?.ok && <p className="text-sm text-success">CueVerse ID updated across the site.</p>}
    </form>
  )
}
