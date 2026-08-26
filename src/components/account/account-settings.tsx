'use client'

import { useActionState } from 'react'
import { CheckCircle2 } from 'lucide-react'

import { updateMyProfileAction, changeMyEmailAction, changeMyPasswordAction, type FormResult } from '@/lib/account/actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { TimeZoneField } from '@/components/identity/time-zone'

const initial: FormResult = {}

/**
 * My Account settings — self-service editing of the public profile (Preferred Name,
 * Discord, Time Zone), the private email, and the password. CueVerse ID is edited via its
 * own form (rendered separately) and is intentionally not here. Email is private.
 */
export function AccountSettings({
  profile,
  email,
}: {
  profile: { preferredName: string; discord: string | null; timeZone: string | null } | null
  email: string
}) {
  return (
    <div className="space-y-6">
      {profile && <ProfileForm profile={profile} />}
      <EmailForm email={email} />
      <PasswordForm />
    </div>
  )
}

function Ok({ children }: { children: React.ReactNode }) {
  return (
    <p className="inline-flex items-center gap-1.5 text-sm text-success">
      <CheckCircle2 className="size-4" aria-hidden /> {children}
    </p>
  )
}
function Err({ children }: { children: React.ReactNode }) {
  return <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{children}</p>
}
function Label({ htmlFor, children }: { htmlFor: string; children: React.ReactNode }) {
  return <label htmlFor={htmlFor} className="text-sm font-medium">{children}</label>
}

function ProfileForm({ profile }: { profile: { preferredName: string; discord: string | null; timeZone: string | null } }) {
  const [state, action, pending] = useActionState(updateMyProfileAction, initial)
  return (
    <form action={action} className="space-y-3 rounded-none border border-border bg-card/40 p-4">
      <div>
        <h3 className="eyebrow text-brand">Optional Profile Information</h3>
        <p className="mt-1 text-xs text-muted-foreground">All optional — leave any field blank. None are required to sign up or to enter a competition.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="pn">Preferred Name</Label>
          <Input id="pn" name="preferredName" defaultValue={profile.preferredName} maxLength={40} placeholder="e.g. Neo" />
          <p className="text-xs text-muted-foreground">Optional public community name. When blank, your CueVerse ID is shown.</p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="dc">Discord Username</Label>
          <Input id="dc" name="discord" defaultValue={profile.discord ?? ''} maxLength={64} placeholder="your_discord" />
          <p className="text-xs text-muted-foreground">Optional contact information.</p>
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="timeZone">Time Zone</Label>
        <TimeZoneField defaultValue={profile.timeZone ?? ''} required={false} />
        <p className="text-xs text-muted-foreground">Optional. Shown on your public profile — enter it however you like (e.g. MST).</p>
      </div>
      {state.error && <Err>{state.error}</Err>}
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" disabled={pending}>{pending ? 'Saving…' : 'Save profile'}</Button>
        {state.ok && <Ok>Saved.</Ok>}
      </div>
    </form>
  )
}

function EmailForm({ email }: { email: string }) {
  const [state, action, pending] = useActionState(changeMyEmailAction, initial)
  return (
    <form action={action} className="space-y-3 rounded-none border border-border bg-card/40 p-4">
      <h3 className="eyebrow text-brand">Email <span className="text-muted-foreground">· private</span></h3>
      <div className="space-y-1.5">
        <Label htmlFor="em">Email</Label>
        <Input id="em" name="email" type="email" defaultValue={email} required autoComplete="email" />
        <p className="text-xs text-muted-foreground">Never shown publicly. Used for recovery and notifications only.</p>
      </div>
      {state.error && <Err>{state.error}</Err>}
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" variant="outline" disabled={pending}>{pending ? 'Saving…' : 'Update email'}</Button>
        {state.ok && <Ok>Email updated.</Ok>}
      </div>
    </form>
  )
}

function PasswordForm() {
  const [state, action, pending] = useActionState(changeMyPasswordAction, initial)
  return (
    <form action={action} className="space-y-3 rounded-none border border-border bg-card/40 p-4">
      <h3 className="eyebrow text-brand">Password</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="pw">New password</Label>
          <Input id="pw" name="password" type="password" required autoComplete="new-password" minLength={8} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pw2">Confirm password</Label>
          <Input id="pw2" name="confirmPassword" type="password" required autoComplete="new-password" minLength={8} />
        </div>
      </div>
      {state.error && <Err>{state.error}</Err>}
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" variant="outline" disabled={pending}>{pending ? 'Saving…' : 'Change password'}</Button>
        {state.ok && <Ok>Password changed.</Ok>}
      </div>
    </form>
  )
}
