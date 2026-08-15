import type { Metadata } from 'next'
import { AdminShell, AdminDenied } from '@/components/staff/admin-shell'
import { StaffGate } from '@/components/staff/staff-gate'
import { StaffManagementPanel } from '@/components/staff/staff-management-panel'
import { resolveStaffAccess } from '@/lib/competition/staff-auth'
import { getStaffRoster } from '@/lib/staff/staff-roster'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Staff Management · Admin', robots: { index: false, follow: false } }

export default async function StaffManagementPage() {
  const access = await resolveStaffAccess()
  if (access.status !== 'ok') return <StaffGate access={access} />
  const canManage = access.actor.canManageAdmins()
  if (!access.actor.can('manage_staff') && !access.actor.isHeadAdmin) {
    return <AdminDenied actor={access.actor} active="staff" label="Staff Management" />
  }

  const roster = await getStaffRoster()

  return (
    <AdminShell actor={access.actor} active="staff">
      <h1 className="font-display text-2xl font-bold tracking-tight">Staff Management</h1>
      <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
        Promote Members to Admin and demote Admins to Members. All role changes are authorized
        server-side and recorded in the Activity Log. Only the Head Admin may change staff roles.
      </p>
      <div className="mt-6">
        <StaffManagementPanel roster={roster} canManage={canManage} />
      </div>
    </AdminShell>
  )
}
