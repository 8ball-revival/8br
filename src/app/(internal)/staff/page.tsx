import type { Metadata } from 'next'
import Link from 'next/link'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { StaffShell } from '@/components/staff/staff-shell'
import { StaffGate } from '@/components/staff/staff-gate'
import { CreateSeasonForm } from '@/components/staff/create-tournament-form'
import { resolveStaffAccess } from '@/lib/competition/staff-auth'
import { getActiveSeason, getDashboardSummary, getRecentAudit } from '@/lib/competition/queries'
import { SEASON_STATE_LABEL } from '@/lib/competition/labels'
import { formatDateTime } from '@/lib/format'

export const metadata: Metadata = { title: 'Admin · 8 Ball Revival', robots: { index: false, follow: false } }

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

  // Cups aren't part of the live-ops (comp_*) model yet — foundation value is 0.
  const activeCups = 0

  return (
    <StaffShell active="dashboard" username={access.actor.username} seasonName={tournament?.name}>
      <div className="flex items-center justify-between gap-4">
        <h1 className="font-display text-2xl font-bold tracking-tight">Dashboard</h1>
        {tournament && <Badge variant="gold">{SEASON_STATE_LABEL[tournament.status]}</Badge>}
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          label="Active tournament"
          value={tournament ? tournament.name : 'None'}
          hint={tournament ? SEASON_STATE_LABEL[tournament.status] : 'Create one below'}
        />
        <StatCard label="Pending registrations" value={String(summary?.registrations.PENDING ?? 0)} />
        <StatCard label="Approved entrants" value={String(summary?.registrations.APPROVED ?? 0)} />
        <StatCard label="Active cups" value={String(activeCups)} hint="Cup management arrives in a later phase" />
        <StatCard label="Matches awaiting results" value={String(summary?.matchesWaiting ?? 0)} />
        <StatCard label="Unverified results" value={String(summary?.unverified ?? 0)} />
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        {tournament ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Quick actions</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2 text-sm">
              <Link href="/staff/registrations" className="rounded-md border border-border px-3 py-1.5 hover:bg-muted">Review registrations</Link>
              <Link href="/staff/seasons" className="rounded-md border border-border px-3 py-1.5 hover:bg-muted">Seasons</Link>
              <Link href="/staff/matches" className="rounded-md border border-border px-3 py-1.5 hover:bg-muted">Enter results</Link>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">No active tournament</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Create a tournament to begin. The public site will show it as the current tournament and staff
                can then open registration, draw groups, and run matches.
              </p>
              <CreateSeasonForm />
            </CardContent>
          </Card>
        )}

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
            <Link href="/staff/audit" className="mt-3 inline-block text-sm text-gold hover:text-gold-soft">
              View full audit log →
            </Link>
          </CardContent>
        </Card>
      </div>
    </StaffShell>
  )
}
