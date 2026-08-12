import type { Metadata } from 'next'
import Link from 'next/link'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { StaffShell } from '@/components/staff/staff-shell'
import { StaffGate } from '@/components/staff/staff-gate'
import { resolveStaffAccess } from '@/lib/competition/staff-auth'
import { getActiveSeason, getDashboardSummary, getRecentAudit } from '@/lib/competition/queries'
import { SEASON_STATE_LABEL } from '@/lib/competition/labels'
import { formatDateTime } from '@/lib/format'

export const metadata: Metadata = { title: 'Admin · World Cue Championships', robots: { index: false, follow: false } }

function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-border bg-card/40 p-4">
      <p className="eyebrow text-muted-foreground">{label}</p>
      <p className="mt-1 font-display text-2xl font-bold tracking-tight">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

export default async function StaffDashboardPage() {
  const access = await resolveStaffAccess()
  if (access.status !== 'ok') return <StaffGate access={access} />

  const tournament = await getActiveSeason()
  const summary = tournament ? await getDashboardSummary(tournament.id) : null
  const audit = await getRecentAudit(8)

  return (
    <StaffShell active="dashboard" username={access.actor.username} seasonName={tournament?.name}>
      <div className="flex items-center justify-between gap-4">
        <h1 className="font-display text-2xl font-bold tracking-tight">Dashboard</h1>
        {tournament && <Badge variant="default">{SEASON_STATE_LABEL[tournament.status]}</Badge>}
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          label="Latest tournament"
          value={tournament ? tournament.name : 'None'}
          hint={tournament ? SEASON_STATE_LABEL[tournament.status] : 'Create one from Tournaments'}
        />
        <StatCard label="Pending registrations" value={String(summary?.registrations.PENDING ?? 0)} />
        <StatCard label="Approved entrants" value={String(summary?.registrations.APPROVED ?? 0)} />
        <StatCard label="Matches awaiting results" value={String(summary?.matchesWaiting ?? 0)} />
        <StatCard label="Unverified results" value={String(summary?.unverified ?? 0)} />
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Manage tournaments</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Tournaments are created and run from the Tournaments area. Open it to create a new
              tournament, open registration, generate the bracket, and record results.
            </p>
            <div className="flex flex-wrap gap-2 text-sm">
              <Link href="/tournaments" className="rounded-md bg-primary px-3 py-1.5 font-medium text-primary-foreground hover:bg-primary/90">
                Go to Tournaments
              </Link>
              <Link href="/staff/members" className="rounded-md border border-border px-3 py-1.5 hover:bg-muted">Members</Link>
              <Link href="/staff/audit" className="rounded-md border border-border px-3 py-1.5 hover:bg-muted">Audit log</Link>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent staff activity</CardTitle>
          </CardHeader>
          <CardContent>
            {audit.length === 0 ? (
              <p className="text-sm text-muted-foreground">No activity yet.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {audit.map((a) => (
                  <li key={a.id} className="flex items-baseline justify-between gap-3">
                    <span>
                      <span className="font-medium">{a.actorUsername}</span>{' '}
                      <span className="text-muted-foreground">{a.action}</span>
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">{formatDateTime(a.createdAt.toISOString())}</span>
                  </li>
                ))}
              </ul>
            )}
            <Link href="/staff/audit" className="mt-3 inline-block text-sm text-primary hover:underline">
              View full audit log →
            </Link>
          </CardContent>
        </Card>
      </div>
    </StaffShell>
  )
}
