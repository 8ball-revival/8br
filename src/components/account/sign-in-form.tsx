'use client'

import { useActionState, useState } from 'react'
import Link from 'next/link'

import { signIn, requestPasswordReset, type FormResult } from '@/lib/account/actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

const initial: FormResult = {}

/** Sign in with CueVerse ID (or email) + password, with an inline forgot-password flow. */
export function SignInForm() {
  const [state, action, pending] = useActionState(signIn, initial)
  // Panel opens automatically after a failed sign-in; `null` follows the error, a boolean is
  // the user's manual override (derived, so no state-syncing effect).
  const [manualOpen, setManualOpen] = useState<boolean | null>(null)
  const showReset = manualOpen ?? Boolean(state.error)

  return (
    <div className="space-y-4">
      <form action={action} className="space-y-4">
        <div className="space-y-1.5">
          <label htmlFor="identifier" className="text-sm font-medium">
            CueVerse ID or email
          </label>
          <Input
            id="identifier"
            name="identifier"
            autoComplete="username"
            required
            placeholder="sixohtwo or you@example.com"
          />
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label htmlFor="password" className="text-sm font-medium">
              Password
            </label>
            <button
              type="button"
              onClick={() => setManualOpen(!showReset)}
              className="text-xs font-medium text-brand hover:text-brand-soft"
            >
              Forgot password?
            </button>
          </div>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            placeholder="••••••••"
          />
        </div>

        {state.error && (
          <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {state.error}
          </p>
        )}

        <Button type="submit" size="lg" className="w-full" disabled={pending}>
          {pending ? 'Signing in…' : 'Sign in'}
        </Button>

        <p className="text-center text-sm text-muted-foreground">
          New to World Cue Championships?{' '}
          <Link href="/register" className="font-medium text-brand hover:text-brand-soft">
            Create an account
          </Link>
        </p>
      </form>

      {showReset && <ForgotPasswordPanel onClose={() => setManualOpen(false)} />}
    </div>
  )
}

/** Inline "reset by CueVerse ID or email" panel. Always reports generic success. */
function ForgotPasswordPanel({ onClose }: { onClose: () => void }) {
  const [state, action, pending] = useActionState(requestPasswordReset, initial)

  return (
    <form action={action} className="space-y-3 rounded-md border border-border bg-muted/30 p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Reset your password</h2>
        <button type="button" onClick={onClose} className="text-xs text-muted-foreground hover:text-foreground">
          Close
        </button>
      </div>

      {state.ok ? (
        <p className="text-sm text-muted-foreground">
          If an account matches that CueVerse ID or email, we&apos;ve sent password reset instructions to its email
          address. Check your inbox (and spam folder).
        </p>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            Enter your CueVerse ID or email and we&apos;ll send a reset link.
          </p>
          <div className="space-y-1.5">
            <label htmlFor="reset-identifier" className="text-sm font-medium">
              CueVerse ID or email
            </label>
            <Input
              id="reset-identifier"
              name="identifier"
              autoComplete="username"
              required
              placeholder="sixohtwo or you@example.com"
            />
          </div>
          {state.error && (
            <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {state.error}
            </p>
          )}
          <Button type="submit" size="sm" className="w-full" disabled={pending}>
            {pending ? 'Sending…' : 'Send reset link'}
          </Button>
        </>
      )}
    </form>
  )
}
