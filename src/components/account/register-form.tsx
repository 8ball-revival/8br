'use client'

import { useActionState } from 'react'
import { CheckCircle2 } from 'lucide-react'

import { registerSeason2, type FormResult } from '@/lib/account/actions'
import { Button } from '@/components/ui/button'
import { RegistrationIdentitySummary } from '@/components/identity/registration-identity-summary'
import { ProfileCompletionNotice } from '@/components/identity/profile-completion-notice'

const initial: FormResult = {}

export interface SignupIdentity {
  preferredName: string
  cueverseId: string | null
  discord: string | null
  timeZone: string | null
}

/**
 * Season 2 competition entry. A signed-in member never re-enters identity — the linked
 * profile's `Preferred Name (CueVerse ID)` is shown as confirmation. If the profile is
 * missing or incomplete, a completion notice replaces the form entirely.
 */
export function RegisterForm({ identity, missing }: { identity: SignupIdentity | null; missing: string[] }) {
  const [state, action, pending] = useActionState(registerSeason2, initial)

  if (state.ok) {
    return (
      <div className="flex items-start gap-3 rounded-md border border-success/40 bg-success/10 px-4 py-4 text-sm">
        <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" aria-hidden />
        <div>
          <p className="font-medium text-foreground">
            {state.already ? 'You are already registered for 8 Ball Revival Season 2.' : "You're registered for 8 Ball Revival Season 2!"}
          </p>
          <p className="mt-1 text-muted-foreground">Your entry is active — you appear on the registered-players list immediately.</p>
        </div>
      </div>
    )
  }

  if (!identity || missing.length > 0) return <ProfileCompletionNotice missing={missing} />

  return (
    <form action={action} className="space-y-4">
      <RegistrationIdentitySummary
        preferredName={identity.preferredName}
        cueverseId={identity.cueverseId}
        discord={identity.discord}
        timeZone={identity.timeZone}
      />

      <label className="flex items-start gap-3 text-sm">
        <input type="checkbox" name="rulesAck" required className="mt-0.5 size-4 rounded border-input accent-gold" />
        <span className="text-muted-foreground">I have read and agree to the 8 Ball Revival Season 2 rules and format.</span>
      </label>

      {state.error && (
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {state.error}
        </p>
      )}

      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending ? 'Registering…' : 'Register for Season 2'}
      </Button>
    </form>
  )
}
