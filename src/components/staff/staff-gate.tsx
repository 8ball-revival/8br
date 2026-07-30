import Link from 'next/link'
import { ShieldAlert } from 'lucide-react'

import { Button } from '@/components/ui/button'
import type { StaffAccess } from '@/lib/competition/staff-auth'

/**
 * Access gate for the competition admin. Not-signed-in → prompt to sign in;
 * signed-in-but-not-staff → a clear 403 Forbidden page. (Content is never rendered
 * behind this — pages return it early before any data is read.)
 */
export function StaffGate({ access }: { access: Exclude<StaffAccess, { status: 'ok' }> }) {
  const forbidden = access.status === 'forbidden'
  return (
    <div className="mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center px-6 text-center">
      <span className="flex size-14 items-center justify-center rounded-full border border-destructive/30 bg-destructive/10 text-destructive">
        <ShieldAlert className="size-7" aria-hidden />
      </span>
      {forbidden ? (
        <>
          <p className="mt-6 font-mono text-sm text-destructive">403 · Forbidden</p>
          <h1 className="mt-2 font-display text-2xl font-bold tracking-tight">Staff access only</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Your account does not have permission to open the competition administration console. If
            you believe this is a mistake, contact an 8 Ball Revival administrator.
          </p>
          <Button asChild variant="outline" className="mt-6">
            <Link href="/">Back to site</Link>
          </Button>
        </>
      ) : (
        <>
          <p className="mt-6 font-mono text-sm text-muted-foreground">Sign in required</p>
          <h1 className="mt-2 font-display text-2xl font-bold tracking-tight">Competition Admin</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Sign in with an authorized staff account to continue.
          </p>
          <Button asChild className="mt-6">
            <Link href="/login">Sign in</Link>
          </Button>
        </>
      )}
    </div>
  )
}
