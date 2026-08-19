'use client'

import { useActionState } from 'react'
import Link from 'next/link'
import { CheckCircle2, Lock, XCircle } from 'lucide-react'

import { joinTournamentAction, withdrawTournamentAction, type FormResult } from '@/lib/account/actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { RegistrationIdentitySummary } from '@/components/identity/registration-identity-summary'
import { ProfileCompletionNotice } from '@/components/identity/profile-completion-notice'
import type { SignupIdentity } from '@/components/account/register-form'

const initial: FormResult = {}

/**
 * Member-facing Join / Withdraw control for a LIVE individual cup. Uses the same shared
 * registration-identity path as Tournament signup: a signed-in member never re-enters identity —
 * we show "Registering as: Preferred Name (CueVerse ID)" from their linked profile, or a
 * completion notice when the profile is missing/incomplete.
 */
export function TournamentJoinPanel({
  number,
  isLoggedIn,
  registrationOpen,
  myStatus,
  identity,
  missing,
  requiresPassword = false,
}: {
  number: number
  isLoggedIn: boolean
  registrationOpen: boolean
  myStatus: 'PENDING' | 'APPROVED' | 'WITHDRAWN' | 'REJECTED' | null
  identity: SignupIdentity | null
  missing: string[]
  requiresPassword?: boolean
}) {
  const entered = myStatus === 'APPROVED' || myStatus === 'PENDING'

  return (
    <section className="mt-8 rounded-lg border border-border bg-card/40 p-5">
      <h2 className="eyebrow mb-3 text-brand">Join this Cup</h2>
      {!isLoggedIn ? (
        <div className="flex flex-wrap items-center gap-3">
          <Lock className="size-4 text-muted-foreground" aria-hidden />
          <p className="text-sm text-muted-foreground">Sign in to enter this Cup.</p>
          <Button asChild size="sm">
            <Link href={`/login?returnTo=${encodeURIComponent(`/cups/${number}`)}`}>Sign in</Link>
          </Button>
        </div>
      ) : entered ? (
        <EnteredState number={number} myStatus={myStatus} registrationOpen={registrationOpen} />
      ) : !identity || missing.length > 0 ? (
        <ProfileCompletionNotice missing={missing} />
      ) : registrationOpen ? (
        <JoinForm number={number} identity={identity} requiresPassword={requiresPassword} />
      ) : (
        <div className="flex items-center gap-3">
          <XCircle className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <p className="text-sm text-muted-foreground">Registration for this Cup is closed.</p>
        </div>
      )}
    </section>
  )
}

function JoinForm({ number, identity, requiresPassword }: { number: number; identity: SignupIdentity; requiresPassword: boolean }) {
  const [state, action, pending] = useActionState(joinTournamentAction, initial)

  if (state.ok) {
    return (
      <div className="flex items-start gap-3 rounded-md border border-success/40 bg-success/10 px-4 py-3 text-sm">
        <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" aria-hidden />
        <p className="font-medium text-foreground">
          {state.already ? 'You are already entered in this Cup.' : "You're entered in this Cup!"} You now appear on the entrant list.
        </p>
      </div>
    )
  }

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="number" value={number} />
      <RegistrationIdentitySummary
        preferredName={identity.preferredName}
        cueverseId={identity.cueverseId}
        discord={identity.discord}
        timeZone={identity.timeZone}
      />

      {requiresPassword && (
        <div className="space-y-1.5">
          <label htmlFor="joinPassword" className="text-sm font-medium text-foreground">Join password</label>
          <Input id="joinPassword" name="joinPassword" type="password" required autoComplete="off" placeholder="This is a private Cup" />
          <p className="text-xs text-muted-foreground">This Cup is private — ask the organizer for the password.</p>
        </div>
      )}

      <label className="flex items-start gap-3 text-sm">
        <input type="checkbox" name="rulesAck" required className="mt-0.5 size-4 rounded border-input accent-brand" />
        <span className="text-muted-foreground">I have read and agree to the Cup rules and format.</span>
      </label>

      {state.error && (
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {state.error}
        </p>
      )}

      <Button type="submit" disabled={pending}>
        {pending ? 'Joining…' : 'Join Cup'}
      </Button>
    </form>
  )
}

function EnteredState({
  number,
  myStatus,
  registrationOpen,
}: {
  number: number
  myStatus: 'PENDING' | 'APPROVED' | 'WITHDRAWN' | 'REJECTED' | null
  registrationOpen: boolean
}) {
  const [state, action, pending] = useActionState(withdrawTournamentAction, initial)

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-3 text-sm">
        <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" aria-hidden />
        <p className="font-medium text-foreground">
          {myStatus === 'APPROVED' ? "You're entered in this Cup." : 'Your entry is pending approval.'} You appear on the entrant list.
        </p>
      </div>
      {registrationOpen && !state.ok && (
        <form action={action}>
          <input type="hidden" name="number" value={number} />
          <Button type="submit" variant="outline" size="sm" disabled={pending}>
            {pending ? 'Withdrawing…' : 'Withdraw from Cup'}
          </Button>
          {state.error && <p role="alert" className="mt-2 text-sm text-destructive">{state.error}</p>}
        </form>
      )}
      {state.ok && <p className="text-sm text-muted-foreground">You have withdrawn from this Cup.</p>}
    </div>
  )
}
