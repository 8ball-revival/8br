import type { Metadata } from 'next'
import Link from 'next/link'

import { AdminShell, AdminDenied } from '@/components/staff/admin-shell'
import { StaffGate } from '@/components/staff/staff-gate'
import { Badge } from '@/components/ui/badge'
import { PublicPlayerIdentity } from '@/components/identity/public-player-identity'
import { PenaltyRemoveButton } from '@/components/staff/penalty-remove-button'
import { resolveStaffAccess } from '@/lib/competition/staff-auth'
import { listPenalties, type PenaltyFilter } from '@/lib/staff/members'

export const metadata: Metadata = { title: 'Penalties · Admin · 8 Ball Registry', robots: { index: false, follow: false } }

const FILTERS: PenaltyFilter[] = ['ALL', 'ACTIVE', 'EXPIRED', 'REMOVED', 'TIMEOUT', 'BAN']

type SP = { searchParams: Promise<{ filter?: string }> }

export default async function PenaltiesPage({ searchParams }: SP) {
  const access = await resolveStaffAccess()
  if (access.status !== 'ok') return <StaffGate access={access} />
  if (!access.actor.can('moderate_members')) return <AdminDenied actor={access.actor} active="penalties" label="Penalties" />

  const { filter = 'ALL' } = await searchParams
  const f = (FILTERS as string[]).includes(filter) ? (filter as PenaltyFilter) : 'ALL'
  const penalties = await listPenalties(f)

  return (
    <AdminShell actor={access.actor} active="penalties">
      <h1 className="font-display text-2xl font-bold tracking-tight">Penalties</h1>
      <p className="mt-1 text-sm text-muted-foreground">Audit/history of every Timeout and Ban. Removals are recorded in place — nothing is deleted. Open a member to moderate, or remove an active penalty here.</p>

      <div className="mt-5 flex flex-wrap gap-1.5">
        {FILTERS.map((x) => (
          <Link key={x} href={`/staff/penalties?filter=${x}`} className={`rounded-md border px-3 py-1.5 text-sm ${x === f ? 'border-brand bg-brand/10 text-brand' : 'border-border text-muted-foreground hover:bg-muted'}`}>
            {x === 'ALL' ? 'All' : x.charAt(0) + x.slice(1).toLowerCase()}
          </Link>
        ))}
      </div>

      <div className="mt-5 space-y-2">
        {penalties.map((p) => {
          return (
            <div key={p.id} className="rounded-lg border border-border bg-card/40 p-4 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Link href={`/staff/members/${p.userId}`} className="font-medium hover:text-brand">
                  {p.preferredName ? <PublicPlayerIdentity preferredName={p.preferredName} cueverseId={p.cueverseId} muted /> : `@${p.username}`}
                </Link>
                <div className="flex items-center gap-2">
                  <Badge variant={p.type === 'BAN' ? 'destructive' : 'outline'} className={p.type === 'TIMEOUT' ? 'border-warning/40 text-warning' : ''}>{p.type === 'BAN' ? 'Ban' : 'Timeout'}</Badge>
                  <Badge variant={p.state === 'active' ? 'success' : 'muted'}>{p.state}</Badge>
                </div>
              </div>
              <p className="mt-2 text-muted-foreground">{p.reason}</p>
              <div className="mt-2 grid gap-x-6 gap-y-1 text-xs text-muted-foreground sm:grid-cols-2 lg:grid-cols-3">
                <span>Applied by <span className="text-foreground">{p.appliedByUsername}</span></span>
                <span>Start: {new Date(p.startAt).toLocaleString()}</span>
                <span>Ends: {p.endAt ? new Date(p.endAt).toLocaleString() : p.type === 'BAN' ? 'Permanent' : '—'}</span>
                
                {p.removedAt && <span>Removed by <span className="text-foreground">{p.removedByUsername}</span>: {p.removedReason}</span>}
                {p.affectedCompetitions.length > 0 && <span>Affected: {p.affectedCompetitions.join(', ')}</span>}
              </div>
              {p.state === 'active' && (
                <div className="mt-3">
                  <PenaltyRemoveButton penaltyId={p.id} userId={p.userId} type={p.type} />
                </div>
              )}
            </div>
          )
        })}
        {penalties.length === 0 && <p className="rounded-lg border border-dashed border-border bg-card/30 px-4 py-10 text-center text-sm text-muted-foreground">No penalties match this filter.</p>}
      </div>
    </AdminShell>
  )
}
