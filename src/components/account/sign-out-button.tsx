'use client'

import { useFormStatus } from 'react-dom'

import { signOut } from '@/lib/account/actions'
import { Button } from '@/components/ui/button'

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" variant="outline" size="sm" disabled={pending}>
      {pending ? 'Signing out…' : 'Sign out'}
    </Button>
  )
}

/** Sign out (clears the Payload session cookie, redirects home). */
export function SignOutButton() {
  return (
    <form action={signOut}>
      <SubmitButton />
    </form>
  )
}
