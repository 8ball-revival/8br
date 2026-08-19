import type { Metadata } from 'next'
import { execSync } from 'node:child_process'
import { AdminShell, AdminDenied } from '@/components/staff/admin-shell'
import { StaffGate } from '@/components/staff/staff-gate'
import { ExportButtons } from '@/components/staff/export-buttons'
import { resolveStaffAccess } from '@/lib/competition/staff-auth'
import { getSystemHealth } from '@/lib/staff/oversight'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Data & System Health · Admin', robots: { index: false, follow: false } }

function commitHash(): string {
  try { return execSync('git rev-parse --short HEAD', { cwd: process.cwd() }).toString().trim() } catch { return 'unknown' }
}
function Stat({ label, value, ok }: { label: string; value: string; ok?: boolean }) {
  return <div className="rounded-lg border border-border bg-card/40 p-4"><p className="eyebrow text-muted-foreground">{label}</p><p className={`mt-1 font-semibold ${ok === false ? 'text-destructive' : ok ? 'text-success' : 'text-foreground'}`}>{value}</p></div>
}

export default async function HealthPage() {
  const access = await resolveStaffAccess()
  if (access.status !== 'ok') return <StaffGate access={access} />
  if (!access.actor.isHeadAdmin && !access.actor.can('manage_staff')) return <AdminDenied actor={access.actor} active="health" label="Data & System Health" />
  const h = await getSystemHealth(commitHash())

  return (
    <AdminShell actor={access.actor} active="health">
      <h1 className="font-display text-2xl font-bold tracking-tight">Data &amp; System Health</h1>
      <p className="mt-1 text-sm text-muted-foreground">Operational status and safe data exports. No environment values or secrets are shown.</p>
      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Application" value={h.app} ok={h.app === 'ok'} />
        <Stat label="Local database" value={h.database} ok={h.database === 'connected'} />
        <Stat label="Media storage" value={h.media} />
        <Stat label="Email provider" value={h.email} />
        <Stat label="Version (commit)" value={h.commit} />
        <Stat label="Users" value={String(h.counts.users)} />
        <Stat label="Seasons / Cups" value={`${h.counts.seasons} / ${h.counts.tournaments}`} />
        <Stat label="Audit rows / Players" value={`${h.counts.auditRows} / ${h.counts.players}`} />
      </div>
      <div className="mt-4 space-y-1 rounded-lg border border-border bg-card/40 p-4 text-sm text-muted-foreground">
        <p><span className="font-semibold text-foreground">Migration:</span> {h.migrationStatus}</p>
        <p><span className="font-semibold text-foreground">Backups:</span> {h.backupNote}</p>
      </div>
      <h2 className="mt-8 font-display text-lg font-bold">Safe data exports</h2>
      <p className="mt-1 text-sm text-muted-foreground">CSV exports exclude password hashes, reset hashes, sessions, tokens, and secrets.</p>
      <div className="mt-3"><ExportButtons /></div>
    </AdminShell>
  )
}
