'use client'

import { useActionState, useState } from 'react'
import { KeyRound, Loader2, Lock, Unlock } from 'lucide-react'

import { saveRegistrationSettings } from '@/lib/account/registration-actions'
import { REGISTRATION_SETTING_LABEL, type RegistrationMode } from '@/lib/account/registration-code'

/**
 * The "Create an Account" control.
 *
 * The code is shown in plain text on purpose: this is a soft gate an administrator hands out in
 * Discord, not a credential, and hiding it behind a reveal toggle would only make it harder to read
 * out while protecting nothing. It reaches this component only because the page fetched it behind an
 * administrator check.
 *
 * Private with an empty code is refused by the server. It is also disabled here, so the refusal is
 * visible before anyone submits rather than after.
 */
export function RegistrationModeForm({ initial }: { initial: { mode: RegistrationMode; code: string } }) {
  const [state, action, pending] = useActionState(saveRegistrationSettings, null)
  const [mode, setMode] = useState<RegistrationMode>(initial.mode)
  const [code, setCode] = useState(initial.code)

  const blocked = mode === 'PRIVATE' && code.trim().length === 0

  return (
    <form action={action} className="rounded-none border border-border bg-card/40 p-4">
      <div className="flex items-center gap-2">
        <KeyRound className="size-4 text-[var(--gold)]" aria-hidden />
        <h2 className="font-medium">{REGISTRATION_SETTING_LABEL}</h2>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        Who may create a new account. Sign-in, password recovery and existing accounts are unaffected,
        and an administrator can still create accounts directly.
      </p>

      <fieldset className="mt-4">
        <legend className="sr-only">{REGISTRATION_SETTING_LABEL} mode</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {([
            { id: 'PUBLIC' as const, icon: Unlock, title: 'Public', blurb: 'Anyone can sign up. No code is asked for.' },
            { id: 'PRIVATE' as const, icon: Lock, title: 'Private', blurb: 'A registration code is required to sign up.' },
          ]).map(({ id, icon: Icon, title, blurb }) => (
            <label
              key={id}
              className={`flex cursor-pointer gap-2.5 rounded-md border p-3 transition-colors ${
                mode === id
                  ? 'border-[var(--gold)]/50 bg-[var(--selected-surface)]'
                  : 'border-border hover:border-brand/40'
              }`}
            >
              <input
                type="radio"
                name="registrationMode"
                value={id}
                checked={mode === id}
                onChange={() => setMode(id)}
                className="mt-0.5 accent-[var(--gold)]"
              />
              <span className="min-w-0">
                <span className="flex items-center gap-1.5 text-sm font-medium">
                  <Icon className="size-3.5" aria-hidden />{title}
                </span>
                <span className="mt-0.5 block text-xs text-muted-foreground">{blurb}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="mt-4 space-y-1.5">
        <label htmlFor="registrationCode" className="text-sm font-medium">
          Registration code
        </label>
        <input
          id="registrationCode"
          name="registrationCode"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          autoComplete="off"
          spellCheck={false}
          className="w-full max-w-xs rounded-none border border-input bg-card px-3 py-2 font-mono text-sm outline-none focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/25"
        />
        <p className="text-xs text-muted-foreground">
          Matched ignoring capitalisation and surrounding spaces. Kept when you switch back to Public,
          so you can toggle without retyping it.
        </p>
      </div>

      {blocked && (
        <p className="mt-3 text-sm text-warning">Private mode needs a code before it can be saved.</p>
      )}
      {state?.error && <p className="mt-3 text-sm text-destructive">{state.error}</p>}
      {state?.ok && !state.error && (
        <p className="mt-3 text-sm text-[var(--gold)]">Saved.</p>
      )}

      <button
        type="submit"
        disabled={pending || blocked}
        className="mt-4 inline-flex items-center gap-1.5 rounded-none border border-border px-3 py-1.5 text-sm font-medium hover:border-brand/50 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending && <Loader2 className="size-3.5 motion-safe:animate-spin" aria-hidden />}
        Save
      </button>
    </form>
  )
}
