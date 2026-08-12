import type { Metadata } from 'next'

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { StaffShell, StaffDenied } from '@/components/staff/staff-shell'
import { StaffGate } from '@/components/staff/staff-gate'
import { resolveStaffAccess } from '@/lib/competition/staff-auth'
import { getActiveSeason, getRecentAudit } from '@/lib/competition/queries'
import { formatDateTime } from '@/lib/format'

export const metadata: Metadata = { title: 'Audit log · Admin', robots: { index: false, follow: false } }

function summarize(v: unknown): string {
  if (v == null) return ''
  if (typeof v === 'object') {
    return Object.entries(v as Record<string, unknown>)
      .map(([k, val]) => `${k}: ${val}`)
      .join(', ')
  }
  return String(v)
}

export default async function StaffAuditPage() {
  const access = await resolveStaffAccess()
  if (access.status !== 'ok') return <StaffGate access={access} />
  if (!access.actor.can('view_audit'))
    return <StaffDenied active="audit" username={access.actor.username} label="the Audit Log" />
  const tournament = await getActiveSeason()
  const entries = await getRecentAudit(100)

  return (
    <StaffShell active="audit" username={access.actor.username} seasonName={tournament?.name}>
      <h1 className="font-display text-2xl font-bold tracking-tight">Audit log</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Every staff action — who, when, what changed, and any reason. Append-only.
      </p>

      <div className="mt-6 rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>When (UTC)</TableHead>
              <TableHead>Who</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Change</TableHead>
              <TableHead>Reason</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-muted-foreground">No activity yet.</TableCell>
              </TableRow>
            ) : (
              entries.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                    {formatDateTime(a.createdAt.toISOString())}
                  </TableCell>
                  <TableCell className="font-medium">{a.actorUsername}</TableCell>
                  <TableCell className="font-mono text-xs">{a.action}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {a.oldValue != null && <span>{summarize(a.oldValue)} → </span>}
                    {summarize(a.newValue)}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{a.reason ?? ''}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </StaffShell>
  )
}
