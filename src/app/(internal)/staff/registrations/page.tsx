import type { Metadata } from 'next'
import Link from 'next/link'

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { StaffShell, StaffDenied } from '@/components/staff/staff-shell'
import { StaffGate } from '@/components/staff/staff-gate'
import { ActionButton } from '@/components/staff/action-button'
import { AddEntrantControl, BulkImportEntrants } from '@/components/staff/entrant-tools'
import { removeEntrantAction, restoreEntrantAction } from '@/lib/competition/actions'
import { resolveStaffAccess } from '@/lib/competition/staff-auth'
import { getActiveSeason, getEntrants } from '@/lib/competition/queries'

export const metadata: Metadata = { title: 'Entrants · Admin', robots: { index: false, follow: false } }

const STATUSES = ['ALL', 'ACTIVE', 'REMOVED'] as const

type SP = { searchParams: Promise<{ q?: string; status?: string }> }

export default async function StaffRegistrationsPage({ searchParams }: SP) {
  const access = await resolveStaffAccess()
  if (access.status !== 'ok') return <StaffGate access={access} />
  if (!access.actor.can('manage_registrations'))
    return <StaffDenied active="registrations" username={access.actor.username} label="Entrants" />
  const canManage = access.actor.can('manage_competitions')
  const season = await getActiveSeason()
  const { q = '', status = 'ALL' } = await searchParams

  const all = season ? await getEntrants(season.id) : []
  const query = q.trim().toLowerCase()
  const rows = all.filter((r) => {
    const active = r.status === 'APPROVED' || r.status === 'PENDING'
    const statusOk = status === 'ALL' || (status === 'ACTIVE' ? active : !active)
    const qOk = query === '' || r.displayName.toLowerCase().includes(query) || (r.cueverseId ?? '').toLowerCase().includes(query)
    return statusOk && qOk
  })
  const activeCount = all.filter((r) => r.status === 'APPROVED' || r.status === 'PENDING').length

  return (
    <StaffShell active="registrations" username={access.actor.username} seasonName={season?.name}>
      <h1 className="font-display text-2xl font-bold tracking-tight">Entrants</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {activeCount} active entrant(s). Tournament entry is independent of website accounts — add players from
        their profile directly. If a player later creates an account, link it on the Players page and they adopt
        this entry and their history.
      </p>

      {season && canManage && (
        <Card className="mt-6">
          <CardHeader><CardTitle className="text-base">Add entrants</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <AddEntrantControl seasonId={season.id} />
            <BulkImportEntrants seasonId={season.id} />
          </CardContent>
        </Card>
      )}

      {/* Filters */}
      <div className="mt-6 flex flex-wrap items-center gap-2">
        {STATUSES.map((s) => (
          <Link
            key={s}
            href={`/staff/registrations?status=${s}${query ? `&q=${encodeURIComponent(q)}` : ''}`}
            className={'rounded-md px-3 py-1.5 text-sm font-medium ' + (status === s ? 'bg-gold/10 text-gold' : 'text-muted-foreground hover:bg-muted')}
          >
            {s === 'ALL' ? 'All' : s === 'ACTIVE' ? 'Active' : 'Removed'}
          </Link>
        ))}
      </div>

      <div className="mt-4 rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Player</TableHead>
              <TableHead>CueVerse ID</TableHead>
              <TableHead>Source</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell className="text-muted-foreground" colSpan={5}>{season ? 'No entrants match.' : 'No active season.'}</TableCell>
              </TableRow>
            ) : (
              rows.map((r) => {
                const active = r.status === 'APPROVED' || r.status === 'PENDING'
                return (
                  <TableRow key={r.registrationId}>
                    <TableCell className="font-medium">{r.displayName}</TableCell>
                    <TableCell className="text-muted-foreground">{r.cueverseId ?? '—'}</TableCell>
                    <TableCell>
                      {r.hasAccount ? <Badge variant="success">Account</Badge> : <Badge variant="muted">{r.addedByAdmin ? 'Admin-added' : 'Profile'}</Badge>}
                      {r.inGroup && <Badge variant="gold" className="ml-1">In group</Badge>}
                    </TableCell>
                    <TableCell><Badge variant={active ? 'success' : 'muted'}>{active ? 'Active' : 'Removed'}</Badge></TableCell>
                    <TableCell>
                      {canManage && (
                        <div className="flex flex-wrap justify-end gap-2">
                          {active ? (
                            <ActionButton
                              action={removeEntrantAction}
                              fields={{ seasonId: season!.id, registrationId: r.registrationId }}
                              label="Remove"
                              variant="outline"
                              confirm={`Remove ${r.displayName} from the entrant list? This can be undone (Restore).`}
                            />
                          ) : (
                            <ActionButton action={restoreEntrantAction} fields={{ seasonId: season!.id, registrationId: r.registrationId }} label="Restore" variant="secondary" />
                          )}
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>
    </StaffShell>
  )
}
