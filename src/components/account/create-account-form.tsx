'use client'

import { useActionState } from 'react'
import Link from 'next/link'

import { createAccount, type FormResult } from '@/lib/account/actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PASSWORD_MIN } from '@/lib/account/validation'

const initial: FormResult = {}

/** Account creation — only CueVerse ID, Email, and Password. The CueVerse ID is the public
 *  identity and the login handle. Preferred Name / Discord / Time Zone are optional and are
 *  added later in My Account, never required to sign up or to enter a competition. */
export function CreateAccountForm({ returnTo = '/account', requireCode = false }: {
  returnTo?: string
  /**
   * Whether the site is in Private mode.
   *
   * Only the MODE reaches this component, never the code itself — so there is nothing here for a
   * reader of the page source to find. The field this renders is a convenience; the server checks the
   * submitted code regardless of what the form did or did not show.
   */
  requireCode?: boolean
}) {
  const [state, action, pending] = useActionState(createAccount, initial)
  const loginHref = returnTo && returnTo !== '/account' ? `/login?returnTo=${encodeURIComponent(returnTo)}` : '/login'

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="returnTo" value={returnTo} />

      {requireCode && (
        <div className="space-y-1.5">
          <label htmlFor="registrationCode" className="text-sm font-medium">
            Registration code
          </label>
          <input
            id="registrationCode"
            name="registrationCode"
            type="text"
            required
            autoComplete="off"
            spellCheck={false}
            aria-describedby="registrationCode-hint"
            className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm outline-none focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/25"
          />
          <p id="registrationCode-hint" className="text-xs text-muted-foreground">
            Sign-ups are currently invite-only. Enter the code you were given.
          </p>
        </div>
      )}
      <div className="space-y-1.5">
        <label htmlFor="cueverseId" className="text-sm font-medium">
          CueVerse ID
        </label>
        <Input
          id="cueverseId"
          name="cueverseId"
          autoComplete="username"
          required
          placeholder="Starkiller"
          aria-describedby="cueverseId-hint"
        />
        <p id="cueverseId-hint" className="text-xs text-muted-foreground">
          Must exactly match your current CueVerse in-game ID. This is your public identity and your login name — sign in with this or your email.
        </p>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="preferredName" className="text-sm font-medium">
          Preferred Name <span className="font-normal text-muted-foreground">(optional)</span>
        </label>
        <Input
          id="preferredName"
          name="preferredName"
          autoComplete="name"
          placeholder="How you'd like to be shown"
          aria-describedby="preferredName-hint"
        />
        <p id="preferredName-hint" className="text-xs text-muted-foreground">
          An optional public display name. You can add or change this later in My Account.
        </p>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="email" className="text-sm font-medium">
          Email
        </label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          placeholder="you@example.com"
          aria-describedby="email-hint"
        />
        <p id="email-hint" className="text-xs text-muted-foreground">
          Private — never shown publicly. Used for sign-in, recovery, and notifications only.
        </p>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="password" className="text-sm font-medium">
          Password
        </label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={PASSWORD_MIN}
          placeholder="••••••••"
          aria-describedby="password-hint"
        />
        <p id="password-hint" className="text-xs text-muted-foreground">
          At least {PASSWORD_MIN} characters.
        </p>
      </div>

      {state.error && (
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {state.error}
        </p>
      )}

      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending ? 'Creating account…' : 'Create account'}
      </Button>

      <p className="text-center text-sm text-muted-foreground">
        Already have an account?{' '}
        <Link href={loginHref} className="font-medium text-brand hover:text-brand-soft">
          Sign in
        </Link>
      </p>
    </form>
  )
}
