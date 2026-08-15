import type { Metadata } from 'next'
import { StaffShell } from '@/components/staff/staff-shell'
import { StaffGate } from '@/components/staff/staff-gate'
import { StaffDenied } from '@/components/staff/staff-shell'
import { ResetPasswordPanel } from '@/components/staff/reset-password-panel'
import { resolveStaffAccess } from '@/lib/competition/staff-auth'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Reset Player Password · Admin', robots: { index: false, follow: false } }

export default async function ResetPasswordAdminPage() {
  const access = await resolveStaffAccess()
  if (access.status !== 'ok') return <StaffGate access={access} />
  if (!access.actor.can('moderate_members')) return <StaffDenied active="reset" username={access.actor.username} label="Reset Player Password" />

  return (
    <StaffShell active="reset" username={access.actor.username}>
      <h1 className="font-display text-2xl font-bold tracking-tight">Reset Player Password</h1>
      <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
        Generate a one-time temporary code for a player. It is shown once, signs them out of all
        sessions, and forces them to set a permanent password on next sign-in.
        {access.actor.isHeadAdmin
          ? ' As Head Admin you may reset Members and Admins.'
          : ' You may reset Members only — Admin resets require the Head Admin.'}
      </p>
      <div className="mt-6">
        <ResetPasswordPanel />
      </div>
    </StaffShell>
  )
}
