import type { Metadata } from 'next'
import { AdminShell, AdminDenied } from '@/components/staff/admin-shell'
import { StaffGate } from '@/components/staff/staff-gate'
import { ActivityLogView } from '@/components/staff/activity-log-view'
import { resolveStaffAccess } from '@/lib/competition/staff-auth'
import { getActivityLog, type ActivityFilters, type ActivityCategory, type Severity } from '@/lib/staff/activity-log'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Activity Log · Admin', robots: { index: false, follow: false } }

type SP = { [k: string]: string | string[] | undefined }
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? ''

export default async function ActivityLogPage({ searchParams }: { searchParams: Promise<SP> }) {
  const access = await resolveStaffAccess()
  if (access.status !== 'ok') return <StaffGate access={access} />
  if (!access.actor.can('view_audit')) return <AdminDenied actor={access.actor} active="audit" label="the Activity Log" />

  const sp = await searchParams
  const filters: ActivityFilters = {
    search: one(sp.search) || undefined,
    from: one(sp.from) || undefined,
    to: one(sp.to) || undefined,
    actor: one(sp.actor) || undefined,
    target: one(sp.target) || undefined,
    category: (one(sp.category) as ActivityCategory) || '',
    severity: (one(sp.severity) as Severity) || '',
    includeAutomated: one(sp.automated) === '1',
  }
  const page = Math.max(1, Number(one(sp.page)) || 1)
  const data = await getActivityLog(filters, page, 25)

  return (
    <AdminShell actor={access.actor} active="audit">
      <h1 className="font-display text-2xl font-bold tracking-tight">Activity Log</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Immutable record of every staff and security action — who, when, what changed, and any reason.
        Human admin actions show by default; toggle to include automated System &amp; QA events.
        {access.actor.isHeadAdmin ? ' As Head Admin you may export the complete log.' : ' You may export the operational (human) subset.'}
      </p>
      <div className="mt-6">
        <ActivityLogView rows={data.rows} total={data.total} page={data.page} pageSize={data.pageSize} filters={filters} canExportFull={access.actor.isHeadAdmin} />
      </div>
    </AdminShell>
  )
}
