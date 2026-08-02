import type { Metadata } from 'next'
import Link from 'next/link'

import { StaffShell, StaffDenied } from '@/components/staff/staff-shell'
import { StaffGate } from '@/components/staff/staff-gate'
import { resolveStaffAccess } from '@/lib/competition/staff-auth'
import { getActiveSeason } from '@/lib/competition/queries'
import { SEASON_STATE_LABEL } from '@/lib/competition/labels'

export const metadata: Metadata = { title: 'Seasons · Admin · 8 Ball Revival', robots: { index: false, follow: false } }

export default async function SeasonsStaffPage() {
  const access = await resolveStaffAccess()
  if (access.status !== 'ok') return <StaffGate access={access} />
  if (!access.actor.can('manage_competitions'))
    return <StaffDenied active="seasons" username={access.actor.username} label="Seasons" />

  const season = await getActiveSeason()

  return (
    <StaffShell active="seasons" username={access.actor.username} seasonName={season?.name}>
      <h1 className="font-display text-2xl font-bold tracking-tight">Seasons</h1>
      {season ? (
        <div className="mt-4 rounded-lg border border-border bg-card/40 p-4">
          <div className="flex items-center justify-between gap-3">
            <p className="font-medium">{season.name}</p>
            <span className="text-xs text-muted-foreground">{SEASON_STATE_LABEL[season.seasonStatus]}</span>
          </div>
          <div className="mt-3 flex flex-wrap gap-2 text-sm">
            <Link href="/staff/season" className="rounded-md border border-border px-3 py-1.5 hover:bg-muted">Settings</Link>
            <Link href="/staff/groups" className="rounded-md border border-border px-3 py-1.5 hover:bg-muted">Groups</Link>
            <Link href="/staff/standings" className="rounded-md border border-border px-3 py-1.5 hover:bg-muted">Standings</Link>
            <Link href="/staff/playoffs" className="rounded-md border border-border px-3 py-1.5 hover:bg-muted">Playoffs</Link>
          </div>
        </div>
      ) : (
        <p className="mt-4 text-sm text-muted-foreground">
          No season yet — create one from the Dashboard.
        </p>
      )}
      <p className="mt-4 max-w-prose text-sm text-muted-foreground">
        A full season list with create / archive / restore / delete arrives in a later phase.
      </p>
    </StaffShell>
  )
}
