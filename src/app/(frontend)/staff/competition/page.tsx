import type { Metadata } from 'next'
import { AdminShell, AdminDenied } from '@/components/staff/admin-shell'
import { StaffGate } from '@/components/staff/staff-gate'
import { CompetitionOversightView } from '@/components/staff/competition-oversight-view'
import { resolveStaffAccess } from '@/lib/competition/staff-auth'
import { getCompetitions } from '@/lib/staff/oversight'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Competition Oversight · Admin', robots: { index: false, follow: false } }

export default async function CompetitionOversightPage() {
  const access = await resolveStaffAccess()
  if (access.status !== 'ok') return <StaffGate access={access} />
  if (!access.actor.can('manage_competitions')) return <AdminDenied actor={access.actor} active="competition" label="Competition Oversight" />
  const rows = await getCompetitions()
  return (
    <AdminShell actor={access.actor} active="competition">
      <h1 className="font-display text-2xl font-bold tracking-tight">Competition Oversight</h1>
      <p className="mt-1 text-sm text-muted-foreground">Every Season and Tournament at a glance — phase, registration, entrants, and unresolved work. Filter, then open the workspace to manage.</p>
      <div className="mt-6"><CompetitionOversightView rows={rows} /></div>
    </AdminShell>
  )
}
