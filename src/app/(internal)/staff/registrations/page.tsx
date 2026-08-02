import type { Metadata } from 'next'
import Link from 'next/link'
import type { RegistrationStatus } from '@prisma/client'

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { StaffShell, StaffDenied } from '@/components/staff/staff-shell'
import { StaffGate } from '@/components/staff/staff-gate'
import { ActionButton } from '@/components/staff/action-button'
import { setRegistrationStatusAction } from '@/lib/competition/actions'
import { resolveStaffAccess } from '@/lib/competition/staff-auth'
import { getActiveSeason, listRegistrations } from '@/lib/competition/queries'
import { REGISTRATION_STATUS_LABEL } from '@/lib/competition/labels'
import { formatDate } from '@/lib/format'

export const metadata: Metadata = { title: 'Registrations · Admin', robots: { index: false, follow: false } }

const STATUSES: (RegistrationStatus | 'ALL')[] = ['ALL', 'PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN']
const STATUS_VARIANT: Record<RegistrationStatus, 'gold' | 'success' | 'destructive' | 'muted'> = {
  PENDING: 'gold',
  APPROVED: 'success',
  REJECTED: 'destructive',
  WITHDRAWN: 'muted',
}

type SP = { searchParams: Promise<{ q?: string; status?: string }> }

export default async function StaffRegistrationsPage({ searchParams }: SP) {
  const access = await resolveStaffAccess()
  if (access.status !== 'ok') return <StaffGate access={access} />
  if (!access.actor.can('manage_registrations'))
    return <StaffDenied active="registrations" username={access.actor.username} label="Registrations" />
  const season = await getActiveSeason()
  const { q = '', status = 'ALL' } = await searchParams

  const all = season ? await listRegistrations(season.id) : []
  const query = q.trim().toLowerCase()
  const rows = all.filter(
    (r) =>
      (status === 'ALL' || r.status === status) &&
      (query === '' || r.username.toLowerCase().includes(query)),
  )

  return (
    <StaffShell active="registrations" username={access.actor.username} seasonName={season?.name}>
      <h1 className="font-display text-2xl font-bold tracking-tight">Registrations</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Approve players into the season, reject, withdraw, or restore. History is never deleted.
      </p>

      {/* Filters */}
      <div className="mt-6 flex flex-wrap items-center gap-2">
        {STATUSES.map((s) => (
          <Link
            key={s}
            href={`/staff/registrations?status=${s}${query ? `&q=${encodeURIComponent(q)}` : ''}`}
            className={
              'rounded-md px-3 py-1.5 text-sm font-medium ' +
              (status === s ? 'bg-gold/10 text-gold' : 'text-muted-foreground hover:bg-muted')
            }
          >
            {s === 'ALL' ? 'All' : REGISTRATION_STATUS_LABEL[s as RegistrationStatus]}
          </Link>
        ))}
        <form action="/staff/registrations" method="get" className="ml-auto flex gap-2">
          <input type="hidden" name="status" value={status} />
          <Input name="q" defaultValue={q} placeholder="Search User ID…" className="w-52" />
          <Button type="submit" variant="outline" size="sm">Search</Button>
        </form>
      </div>

      <div className="mt-4 rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>User ID</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Registered</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell className="text-muted-foreground" colSpan={4}>
                  {season ? 'No registrations match.' : 'No active season.'}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.username}</TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[r.status]}>{REGISTRATION_STATUS_LABEL[r.status]}</Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{formatDate(r.createdAt.toISOString())}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap justify-end gap-2">
                      {/* Activate: approve a pending entry or restore a withdrawn/rejected one. */}
                      {r.status !== 'APPROVED' && (
                        <ActionButton
                          action={setRegistrationStatusAction}
                          fields={{ registrationId: r.id, status: 'APPROVED' }}
                          label={r.status === 'PENDING' ? 'Approve' : 'Restore'}
                          variant="secondary"
                        />
                      )}
                      {/* Remove from the public list. */}
                      {r.status === 'APPROVED' && (
                        <ActionButton action={setRegistrationStatusAction} fields={{ registrationId: r.id, status: 'WITHDRAWN' }} label="Withdraw" variant="outline" confirm="Withdraw this player?" />
                      )}
                      {/* Reject an active or pending entry. */}
                      {(r.status === 'APPROVED' || r.status === 'PENDING') && (
                        <ActionButton
                          action={setRegistrationStatusAction}
                          fields={{ registrationId: r.id, status: 'REJECTED' }}
                          label="Reject"
                          variant="outline"
                          confirm={r.status === 'APPROVED' ? 'Reject this player?' : undefined}
                        />
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </StaffShell>
  )
}
