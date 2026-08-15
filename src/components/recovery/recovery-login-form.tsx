'use client'

import { useActionState } from 'react'
import { loginRecovery } from '@/lib/recovery/actions'
import { Button } from '@/components/ui/button'

const FIELD = 'w-full rounded-md border border-border bg-background px-3 py-2 text-sm'
const LABEL = 'eyebrow text-muted-foreground'

/** Minimal, utilitarian break-glass login. No links, no branding beyond app tokens. */
export function RecoveryLoginForm() {
  const [state, formAction, pending] = useActionState(loginRecovery, {} as { ok?: boolean; error?: string })

  return (
    <form action={formAction} className="space-y-4">
      <div>
        <label className={LABEL} htmlFor="username">Operator</label>
        <input id="username" name="username" required autoComplete="off" className={`${FIELD} mt-1`} />
      </div>
      <div>
        <label className={LABEL} htmlFor="password">Passphrase</label>
        <input id="password" name="password" type="password" required autoComplete="off" className={`${FIELD} mt-1`} />
      </div>

      {state?.error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/[0.06] px-3 py-2 text-sm text-destructive">{state.error}</p>
      )}

      <Button type="submit" disabled={pending} className="w-full">
        {pending ? 'Verifying…' : 'Unlock'}
      </Button>
    </form>
  )
}
