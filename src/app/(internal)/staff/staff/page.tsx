import type { Metadata } from 'next'
import Link from 'next/link'

import { StaffShell, StaffDenied } from '@/components/staff/staff-shell'
import { StaffGate } from '@/components/staff/staff-gate'
import { resolveStaffAccess } from '@/lib/competition/staff-auth'

export const metadata: Metadata = { title: 'Staff · Admin · 8 Ball Revival', robots: { index: false, follow: false } }

export default async function StaffAdminPage() {
  const access = await resolveStaffAccess()
  if (access.status !== 'ok') return <StaffGate access={access} />
  // Only an Owner manages staff accounts and roles.
  if (!access.actor.can('manage_staff'))
    return <StaffDenied active="staff" username={access.actor.username} label="Staff" />

  return (
    <StaffShell active="staff" username={access.actor.username}>
      <h1 className="font-display text-2xl font-bold tracking-tight">Staff</h1>
      <p className="mt-2 max-w-prose text-sm text-muted-foreground">
        Staff accounts, roles, and permissions are the source of truth in the Payload CMS. Create
        accounts there and assign roles (Owner / Admin / Editor).
      </p>
      <Link
        href="/admin/collections/users"
        className="mt-4 inline-block rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted"
      >
        Open user management in CMS →
      </Link>
    </StaffShell>
  )
}
