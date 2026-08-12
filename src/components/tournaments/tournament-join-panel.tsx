'use client'

import { useActionState } from 'react'
import Link from 'next/link'
import { CheckCircle2, Lock, XCircle } from 'lucide-react'

import { joinCupAction, withdrawCupAction, type FormResult } from '@/lib/account/actions'
import { Button } from '@/components/ui/button'
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
export function CupJoinPanel({
  cupNumber,
  isLoggedIn,
  registrationOpen,
  myStatus,
  identity,
  missing,
}: {
  cupNumber: number
  isLoggedIn: boolean
  registrationOpen: boolean
  myStatus: 'PENDING' | 'APPROVED' | 'WITHDRAWN' | 'REJECTED' | null
  identity: SignupIdentity | null
  missing: string[]
}) {
  const entered = myStatus === 'APPROVED' || myStatus === 'PENDING'

  return (
    <section className="mt-8 rounded-lg border border-border bg-card/40 p-5">
      <h2 className="eyebrow mb-3 text-gold">Join this cup</h2>
      {!isLoggedIn ? (
        <div className="flex flex-wrap items-center gap-3">
          <Lock className="size-4 text-muted-foreground" aria-hidden />
          <p className="text-sm text-muted-foreground">Sign in to enter this cup.</p>
          <Button asChild size="sm">
            <Link href="/login">Sign in</Link>
          </Button>
        </div>
      ) : entered ? (
        <EnteredState cupNumber={cupNumber} myStatus={myStatus} registrationOpen={registrationOpen} />
      ) : !identity || missing.length > 0 ? (
        <ProfileCompletionNotice missing={missing} />
      ) : registrationOpen ? (
        <JoinForm cupNumber={cupNumber} identity={identity} />
      ) : (
        <div className="flex items-center gap-3">
          <XCircle className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <p className="text-sm text-muted-foreground">Registration for this cup is closed.</p>
        </div>
      )}
    </section>
  )
}

function JoinForm({ cupNumber, identity }: { cupNumber: number; identity: SignupIdentity }) {
  const [state, action, pending] = useActionState(joinCupAction, initial)

  if (state.ok) {
    return (
      <div className="flex items-start gap-3 rounded-md border border-success/40 bg-success/10 px-4 py-3 text-sm">
        <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" aria-hidden />
        <p className="font-medium text-foreground">
          {state.already ? 'You are already entered in this cup.' : "You're entered in this cup!"} You now appear on the entrant list.
        </p>
      </div>
    )
  }

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="cupNumber" value={cupNumber} />
      <RegistrationIdentitySummary
        preferredName={identity.preferredName}
        cueverseId={identity.cueverseId}
        discord={identity.discord}
        timeZone={identity.timeZone}
      />

      <label className="flex items-start gap-3 text-sm">
        <input type="checkbox" name="rulesAck" required className="mt-0.5 size-4 rounded border-input accent-gold" />
        <span className="text-muted-foreground">I have read and agree to the cup rules and format.</span>
      </label>

      {state.error && (
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {state.error}
        </p>
      )}

      <Button type="submit" disabled={pending}>
        {pending ? 'Joining…' : 'Join cup'}
      </Button>
    </form>
  )
}

function EnteredState({
  cupNumber,
  myStatus,
  registrationOpen,
}: {
  cupNumber: number
  myStatus: 'PENDING' | 'APPROVED' | 'WITHDRAWN' | 'REJECTED' | null
  registrationOpen: boolean
}) {
  const [state, action, pending] = useActionState(withdrawCupAction, initial)

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-3 text-sm">
        <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" aria-hidden />
        <p className="font-medium text-foreground">
          {myStatus === 'APPROVED' ? "You're entered in this cup." : 'Your entry is pending approval.'} You appear on the entrant list.
        </p>
      </div>
      {registrationOpen && !state.ok && (
        <form action={action}>
          <input type="hidden" name="cupNumber" value={cupNumber} />
          <Button type="submit" variant="outline" size="sm" disabled={pending}>
            {pending ? 'Withdrawing…' : 'Withdraw from cup'}
          </Button>
          {state.error && <p role="alert" className="mt-2 text-sm text-destructive">{state.error}</p>}
        </form>
      )}
      {state.ok && <p className="text-sm text-muted-foreground">You have withdrawn from this cup.</p>}
    </div>
  )
}
