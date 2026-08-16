import type { Metadata } from 'next'
import Link from 'next/link'
import { AdminShell, AdminDenied } from '@/components/staff/admin-shell'
import { StaffGate } from '@/components/staff/staff-gate'
import { resolveStaffAccess } from '@/lib/competition/staff-auth'
import { getSecuritySummary, type SecurityRow } from '@/lib/staff/oversight'
import { formatDateTime } from '@/lib/format'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Security · Admin', robots: { index: false, follow: false } }

function List({ title, rows, tone }: { title: string; rows: SecurityRow[]; tone?: 'danger' | 'warn' }) {
  return (
    <section className="rounded-lg border border-border bg-card/40 p-4">
      <p className={`eyebrow ${tone === 'danger' ? 'text-destructive' : tone === 'warn' ? 'text-[var(--gold)]' : 'text-brand'}`}>{title} ({rows.length})</p>
      {rows.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">None.</p> : (
        <ul className="mt-2 divide-y divide-border text-sm">
          {rows.map((r) => (
            <li key={r.userId} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span className="min-w-0"><span className="font-medium text-foreground">{r.cueverseId ? `@${r.cueverseId}` : `User ${r.userId}`}</span> <span className="text-xs text-muted-foreground">#{r.userId} · {r.detail}</span></span>
              <Link href="/staff/members" className="text-xs text-brand hover:underline">Review →</Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export default async function SecurityPage() {
  const access = await resolveStaffAccess()
  if (access.status !== 'ok') return <StaffGate access={access} />
  if (!access.actor.can('view_audit')) return <AdminDenied actor={access.actor} active="security" label="Security" />
  const isHead = access.actor.isHeadAdmin
  const s = await getSecuritySummary()

  return (
    <AdminShell actor={access.actor} active="security">
      <h1 className="font-display text-2xl font-bold tracking-tight">Security &amp; Account Status</h1>
      <p className="mt-1 text-sm text-muted-foreground">Operational account-security signals. Sensitive controls are Head-Admin only. No password hashes, tokens, cookies, or secrets are shown.</p>
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <List title="Awaiting forced password change" rows={s.forcedChange} tone="warn" />
        <List title="Expired / dead temporary resets" rows={s.expiredResets} tone="warn" />
        <List title="Suspended (timed out)" rows={s.suspended} tone="warn" />
        <List title="Banned" rows={s.banned} tone="danger" />
        <List title="Login-locked accounts" rows={s.lockedAccounts} tone="warn" />
        <List title="Active staff accounts" rows={s.activeStaff} />
      </div>
      {isHead && (
        <section className="mt-4 rounded-lg border border-border bg-card/40 p-4">
          <p className="eyebrow text-brand">Recent password resets</p>
          {s.recentResets.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">None.</p> : (
            <ul className="mt-2 divide-y divide-border text-sm">
              {s.recentResets.map((r, i) => (
                <li key={i} className="flex items-center justify-between gap-2 py-1.5"><span><span className="font-medium">{r.actor}</span> reset {r.targetId ? `#${r.targetId}` : 'an account'}</span><span className="text-xs text-muted-foreground">{formatDateTime(r.at)}</span></li>
              ))}
            </ul>
          )}
        </section>
      )}
      <p className="mt-4 text-xs text-muted-foreground">Elevated (staff) accounts: {s.elevatedCount}. Safe actions (Force Sign Out, Reset Member Password) are available from Player Management and Reset Player Password.</p>
    </AdminShell>
  )
}
