import type { Metadata } from 'next'
import Link from 'next/link'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { StaffShell } from '@/components/staff/staff-shell'
import { StaffGate } from '@/components/staff/staff-gate'
import { CreateSeasonForm } from '@/components/staff/create-season-form'
import { resolveStaffAccess } from '@/lib/competition/staff-auth'
import { getActiveSeason, getDashboardSummary, getRecentAudit } from '@/lib/competition/queries'
import {
  SEASON_STATE_LABEL,
  REGISTRATION_STATE_LABEL,
  STAGE_STATE_LABEL,
} from '@/lib/competition/labels'
import { formatDateTime } from '@/lib/format'

export const metadata: Metadata = { title: 'Admin · 8 Ball Revival', robots: { index: false, follow: false } }

export default async function StaffDashboardPage() {
  const access = await resolveStaffAccess()
  if (access.status !== 'ok') return <StaffGate access={access} />

  const season = await getActiveSeason()
  if (!season) {
    return (
      <StaffShell active="dashboard" username={access.actor.username}>
        <h1 className="font-display text-2xl font-bold tracking-tight">Competition dashboard</h1>
        <Card className="mt-6 max-w-2xl">
          <CardHeader>
            <CardTitle>No active season</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Create a season to begin. The public site will show it as the current season and staff
              can then open registration, draw groups, and run matches.
            </p>
            <CreateSeasonForm />
          </CardContent>
        </Card>
      </StaffShell>
    )
  }

  const [summary, audit] = await Promise.all([getDashboardSummary(season.id), getRecentAudit(8)])
  const tiles = [
    { label: 'Season', value: SEASON_STATE_LABEL[season.seasonStatus] },
    { label: 'Registration', value: REGISTRATION_STATE_LABEL[season.registrationStatus] },
    { label: 'Approved players', value: String(summary.registrations.APPROVED ?? 0) },
    { label: 'Pending registrations', value: String(summary.registrations.PENDING ?? 0) },
    { label: 'Groups', value: `${summary.groups} · ${STAGE_STATE_LABEL[season.groupsStatus]}` },
    { label: 'Matches awaiting scores', value: String(summary.matchesWaiting) },
    { label: 'Unverified results', value: String(summary.unverified) },
    { label: 'Disputes', value: String(summary.disputes) },
    { label: 'Playoffs', value: `${summary.playoffMatches} · ${STAGE_STATE_LABEL[season.playoffsStatus]}` },
  ]

  return (
    <StaffShell active="dashboard" username={access.actor.username} seasonName={season.name}>
      <div className="flex items-center justify-between gap-4">
        <h1 className="font-display text-2xl font-bold tracking-tight">{season.name}</h1>
        <Badge variant="gold">{SEASON_STATE_LABEL[season.seasonStatus]}</Badge>
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-lg border border-border bg-card/40 p-4">
            <p className="eyebrow text-muted-foreground">{t.label}</p>
            <p className="mt-1 font-display text-xl font-bold tracking-tight">{t.value}</p>
          </div>
        ))}
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Quick actions</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2 text-sm">
            <Link href="/staff/season" className="rounded-md border border-border px-3 py-1.5 hover:bg-muted">Season settings</Link>
            <Link href="/staff/registrations" className="rounded-md border border-border px-3 py-1.5 hover:bg-muted">Review registrations</Link>
            <Link href="/staff/groups" className="rounded-md border border-border px-3 py-1.5 hover:bg-muted">Draw groups</Link>
            <Link href="/staff/matches" className="rounded-md border border-border px-3 py-1.5 hover:bg-muted">Enter results</Link>
            <Link href="/staff/playoffs" className="rounded-md border border-border px-3 py-1.5 hover:bg-muted">Playoffs</Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent admin activity</CardTitle>
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
