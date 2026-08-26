'use client'

import { useActionState } from 'react'
import { createFirstOwner } from '@/lib/account/actions'
import { Button } from '@/components/ui/button'

const FIELD = 'w-full rounded-none border border-border bg-background px-3 py-2 text-sm'
const LABEL = 'eyebrow text-muted-foreground'

/** First-run owner setup form. Only ever rendered when no account exists. */
export function SetupForm({ secretRequired }: { secretRequired: boolean }) {
  const [state, formAction, pending] = useActionState(createFirstOwner, {} as { ok?: boolean; error?: string })

  return (
    <form action={formAction} className="space-y-4">
      {secretRequired && (
        <div>
          <label className={LABEL} htmlFor="setupSecret">Setup secret</label>
          <input id="setupSecret" name="setupSecret" type="password" autoComplete="off" required className={`${FIELD} mt-1`} />
          <p className="mt-1 text-xs text-muted-foreground">The SETUP_SECRET configured for this deployment.</p>
        </div>
      )}
      <div>
        <label className={LABEL} htmlFor="cueverseId">CueVerse ID</label>
        <input id="cueverseId" name="cueverseId" required autoComplete="username" className={`${FIELD} mt-1`} />
        <p className="mt-1 text-xs text-muted-foreground">Your public identity and login name. Sign in with this or your email.</p>
      </div>
      <div>
        <label className={LABEL} htmlFor="preferredName">Preferred Name <span className="normal-case text-muted-foreground/70">(optional)</span></label>
        <input id="preferredName" name="preferredName" autoComplete="name" className={`${FIELD} mt-1`} />
      </div>
      <div>
        <label className={LABEL} htmlFor="email">Email</label>
        <input id="email" name="email" type="email" required autoComplete="email" className={`${FIELD} mt-1`} />
        <p className="mt-1 text-xs text-muted-foreground">Private — for account recovery only.</p>
      </div>
      <div>
        <label className={LABEL} htmlFor="password">Password</label>
        <input id="password" name="password" type="password" required autoComplete="new-password" className={`${FIELD} mt-1`} />
      </div>
      <div>
        <label className={LABEL} htmlFor="confirmPassword">Confirm password</label>
        <input id="confirmPassword" name="confirmPassword" type="password" required autoComplete="new-password" className={`${FIELD} mt-1`} />
      </div>

      {state?.error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/[0.06] px-3 py-2 text-sm text-destructive">{state.error}</p>
      )}

      <Button type="submit" disabled={pending} className="w-full">
        {pending ? 'Creating owner…' : 'Create owner account'}
      </Button>
    </form>
  )
}
