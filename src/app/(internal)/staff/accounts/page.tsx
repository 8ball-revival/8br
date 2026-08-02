import type { Metadata } from 'next'

import { StaffShell, StaffDenied } from '@/components/staff/staff-shell'
import { StaffGate } from '@/components/staff/staff-gate'
import { AccountProvisioning } from '@/components/staff/account-provisioning'
import { resolveStaffAccess } from '@/lib/competition/staff-auth'
import { listProvisionedAccounts } from '@/lib/accounts/provisioning'

export const metadata: Metadata = { title: 'Accounts · Admin · 8 Ball Revival', robots: { index: false, follow: false } }

export default async function StaffAccountsPage() {
  const access = await resolveStaffAccess()
  if (access.status !== 'ok') return <StaffGate access={access} />
  if (!access.actor.can('manage_players'))
    return <StaffDenied active="accounts" username={access.actor.username} label="Accounts" />

  const accounts = await listProvisionedAccounts()

  return (
    <StaffShell active="accounts" username={access.actor.username}>
      <h1 className="font-display text-2xl font-bold tracking-tight">Account provisioning</h1>
      <p className="mt-2 max-w-prose text-sm text-muted-foreground">
        Generate pre-created, unclaimed accounts for players from the seed competitions, hand out one-time claim codes, and
        manage claim status. Player history stays attached to each profile.
      </p>
      <div className="mt-6">
        <AccountProvisioning accounts={accounts} />
      </div>
    </StaffShell>
  )
}
