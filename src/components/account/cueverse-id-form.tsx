'use client'

import { useActionState } from 'react'
import { changeMyCueverseId } from '@/lib/account/actions'
import { Button } from '@/components/ui/button'

/**
 * Self-service CueVerse ID change. The CueVerse ID is the player's public identity
 * across the whole site; changing it propagates everywhere via the linked profile.
 * A 7-day cooldown is enforced server-side; when active, the input is disabled and the
 * next available date is shown.
 */
export function CueverseIdForm({
  current,
  canChange,
  nextAvailableAt,
}: {
  current: string | null
  canChange: boolean
  nextAvailableAt: string | null
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
          placeholder="e.g. sixohtwo"
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm disabled:opacity-60"
        />
        <Button type="submit" size="sm" disabled={!canChange || pending}>
          {pending ? 'Saving…' : 'Save'}
        </Button>
      </div>
      {!canChange && nextAvailableAt && (
        <p className="text-xs text-muted-foreground">
          You can change your CueVerse ID again on{' '}
          <span className="font-medium text-foreground">{new Date(nextAvailableAt).toLocaleDateString()}</span>. (7-day cooldown)
        </p>
      )}
      {canChange && <p className="text-xs text-muted-foreground">Changes are limited to once every 7 days. Your old ID stays searchable.</p>}
      {state?.error && <p className="text-sm text-destructive">{state.error}</p>}
      {state?.ok && <p className="text-sm text-success">CueVerse ID updated across the site.</p>}
    </form>
  )
}
