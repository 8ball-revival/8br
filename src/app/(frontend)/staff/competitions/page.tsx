import type { Metadata } from 'next'

import { AdminShell, AdminDenied } from '@/components/staff/admin-shell'
import { StaffGate } from '@/components/staff/staff-gate'
import { CompetitionManager } from '@/components/competitions/competition-manager'
import { resolveStaffAccess } from '@/lib/competition/staff-auth'
import { listCompetitionsForAdmin } from '@/lib/competitions/service'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = {
  title: 'Competitions · Admin',
  robots: { index: false, follow: false },
}

/**
 * Competition administration — ADMIN/OWNER only.
 *
 * The page gate below decides what renders; it is NOT the security boundary. Every mutation the
 * manager performs calls a server action that independently re-checks `manage_competitions`, so a
 * direct action invocation by a member is rejected regardless of what the UI showed.
 */
export default async function CompetitionsAdminPage() {
  const access = await resolveStaffAccess()
  if (access.status !== 'ok') return <StaffGate access={access} />
  if (!access.actor.can('manage_competitions')) {
    return <AdminDenied actor={access.actor} active="competitions" label="Competitions" />
  }

  const competitions = await listCompetitionsForAdmin()

  return (
    <AdminShell actor={access.actor} active="competitions">
      <p className="mb-5 max-w-2xl text-sm text-muted-foreground">
        Competitions group Seasons together (for example 8BRCAM). Every Season belongs to exactly
        one. Upload an icon to replace the initials badge; a Competition that already owns Seasons
        cannot be deleted — deactivate it instead, which hides it from new-Season selectors without
        touching its history.
      </p>
      <CompetitionManager initial={competitions} />
    </AdminShell>
  )
}
