'use client'

import { useActionState } from 'react'
import Link from 'next/link'

import { createAccount, type FormResult } from '@/lib/account/actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { USERNAME_MIN, USERNAME_MAX, PASSWORD_MIN } from '@/lib/account/validation'

const initial: FormResult = {}

/** Account creation: User ID + email + password only. No email verification. */
export function CreateAccountForm() {
  const [state, action, pending] = useActionState(createAccount, initial)

  return (
    <form action={action} className="space-y-4">
      <div className="space-y-1.5">
        <label htmlFor="username" className="text-sm font-medium">
          User ID
        </label>
        <Input
          id="username"
          name="username"
          autoComplete="username"
          required
          minLength={USERNAME_MIN}
          maxLength={USERNAME_MAX}
          placeholder="your_user_id"
          aria-describedby="username-hint"
        />
        <p id="username-hint" className="text-xs text-muted-foreground">
          {USERNAME_MIN}–{USERNAME_MAX} characters: letters, numbers, underscores, or hyphens. This is
          how you sign in and how you appear on 8 Ball Revival.
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
          Used for account recovery only. Kept private — never shown publicly. No verification email
          is required to start competing.
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
        <Link href="/login" className="font-medium text-gold hover:text-gold-soft">
          Sign in
        </Link>
      </p>
    </form>
  )
}
