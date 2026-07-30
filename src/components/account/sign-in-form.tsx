'use client'

import { useActionState } from 'react'
import Link from 'next/link'

import { signIn, type FormResult } from '@/lib/account/actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

const initial: FormResult = {}

/** Sign in with User ID (or email) + password. */
export function SignInForm() {
  const [state, action, pending] = useActionState(signIn, initial)

  return (
    <form action={action} className="space-y-4">
      <div className="space-y-1.5">
        <label htmlFor="identifier" className="text-sm font-medium">
          User ID or email
        </label>
        <Input
          id="identifier"
          name="identifier"
          autoComplete="username"
          required
          placeholder="your_user_id"
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="password" className="text-sm font-medium">
          Password
        </label>
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
        New to 8 Ball Revival?{' '}
        <Link href="/register" className="font-medium text-gold hover:text-gold-soft">
          Create an account
        </Link>
      </p>
    </form>
  )
}
