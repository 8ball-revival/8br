import type { Metadata } from 'next'

import { StaffShell, StaffDenied } from '@/components/staff/staff-shell'
import { StaffGate } from '@/components/staff/staff-gate'
import { resolveStaffAccess } from '@/lib/competition/staff-auth'

export const metadata: Metadata = { title: 'Cups · Admin · 8 Ball Revival', robots: { index: false, follow: false } }

export default async function CupsStaffPage() {
  const access = await resolveStaffAccess()
  if (access.status !== 'ok') return <StaffGate access={access} />
  if (!access.actor.can('manage_competitions'))
    return <StaffDenied active="cups" username={access.actor.username} label="Cups" />

  return (
    <StaffShell active="cups" username={access.actor.username}>
      <h1 className="font-display text-2xl font-bold tracking-tight">Cups</h1>
      <p className="mt-2 text-sm text-muted-foreground">No active cups.</p>
      <p className="mt-2 max-w-prose text-sm text-muted-foreground">
        Cup management (variety competitions and bracket formats) is built in a later phase.
      </p>
    </StaffShell>
  )
}
