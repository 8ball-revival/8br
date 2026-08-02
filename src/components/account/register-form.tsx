'use client'

import { useActionState } from 'react'
import { CheckCircle2 } from 'lucide-react'

import { registerSeason2, type FormResult } from '@/lib/account/actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

const initial: FormResult = {}

export interface RegisterFormProfile {
  primaryName: string
  cueverseId: string | null
}

/**
 * Season 2 competition entry. If the account is linked to a canonical profile, that
 * profile's identity is used automatically. Otherwise the entrant supplies their
 * public identity (display name, CueVerse ID, Discord, time zone) — shown publicly.
 */
export function RegisterForm({ profile }: { profile?: RegisterFormProfile | null }) {
  const [state, action, pending] = useActionState(registerSeason2, initial)

  if (state.ok) {
    return (
      <div className="flex items-start gap-3 rounded-md border border-success/40 bg-success/10 px-4 py-4 text-sm">
        <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" aria-hidden />
        <div>
          <p className="font-medium text-foreground">
            {state.already ? 'You are already registered for 8 Ball Revival Season 2.' : "You're registered for 8 Ball Revival Season 2!"}
          </p>
          <p className="mt-1 text-muted-foreground">
            Your entry is active. You appear on the registered-players list immediately.
          </p>
        </div>
      </div>
    )
  }

  return (
    <form action={action} className="space-y-4">
      {profile ? (
        <p className="rounded-md border border-border bg-card/50 px-3 py-2 text-sm text-muted-foreground">
          Registering as <span className="font-medium text-foreground">{profile.primaryName}</span>
          {profile.cueverseId && <span> ({profile.cueverseId})</span>} — your linked player profile.
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field name="displayName" label="Public display name" placeholder="Kevin" required />
          <Field name="cueverseId" label="CueVerse ID" placeholder="your_handle" required />
          <Field name="discord" label="Discord (public)" placeholder="username" />
          <Field name="timeZone" label="Time zone" placeholder="EST / GMT / …" />
        </div>
      )}

      <label className="flex items-start gap-3 text-sm">
        <input type="checkbox" name="rulesAck" required className="mt-0.5 size-4 rounded border-input accent-gold" />
        <span className="text-muted-foreground">
          I have read and agree to the 8 Ball Revival Season 2 rules and format.
        </span>
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

function Field({ name, label, placeholder, required }: { name: string; label: string; placeholder?: string; required?: boolean }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium text-foreground">
        {label} {required && <span className="text-gold">*</span>}
      </span>
      <Input name={name} placeholder={placeholder} required={required} />
    </label>
  )
}
