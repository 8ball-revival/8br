'use client'

import { useActionState, useState } from 'react'

import { withdrawSeason2, type FormResult } from '@/lib/account/actions'
import { Button } from '@/components/ui/button'

const initial: FormResult = {}

/**
 * Member self-withdrawal from the active tournament. Two-step confirm (no modal needed).
 * Only rendered while registration is open; after close the option disappears and
 * withdrawal must go through staff. On success the page revalidates and shows the
 * re-register state.
 */
export function WithdrawButton() {
  const [confirming, setConfirming] = useState(false)
  const [state, action, pending] = useActionState(withdrawSeason2, initial)

  const error = state.error && (
    <p role="alert" className="mt-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
      {state.error}
    </p>
  )

  if (!confirming) {
    return (
      <div className="border-t border-border pt-4">
        <Button variant="outline" size="sm" onClick={() => setConfirming(true)}>
          Withdraw from Tournament 2
        </Button>
        <p className="mt-1.5 text-xs text-muted-foreground">
          You can withdraw any time before registration closes, and re-register later.
        </p>
        {error}
      </div>
    )
  }

  return (
    <form action={action} className="border-t border-border pt-4">
      <p className="text-sm text-foreground">Withdraw your Tournament 2 entry?</p>
      <p className="mt-0.5 text-xs text-muted-foreground">
        You&apos;ll be removed from the entrant list. You can re-register before the deadline.
      </p>
      <div className="mt-3 flex gap-2">
        <Button type="submit" variant="destructive" size="sm" disabled={pending}>
          {pending ? 'Withdrawing…' : 'Confirm withdrawal'}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setConfirming(false)} disabled={pending}>
          Cancel
        </Button>
      </div>
      {error}
    </form>
  )
}
