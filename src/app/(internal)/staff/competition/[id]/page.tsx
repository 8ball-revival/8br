import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { StaffShell, StaffDenied } from '@/components/staff/staff-shell'
import { StaffGate } from '@/components/staff/staff-gate'
import { ActionButton } from '@/components/staff/action-button'
import { resolveStaffAccess } from '@/lib/competition/staff-auth'
import { prisma } from '@/lib/prisma'
import { getDashboardSummary } from '@/lib/competition/queries'
import {
  setRegistrationStateAction,
  publishGroupsAction,
  unpublishGroupsAction,
  completeCompetitionAction,
  archiveCompetitionAction,
  unarchiveCompetitionAction,
} from '@/lib/competition/actions'
import { SEASON_STATE_LABEL, REGISTRATION_STATE_LABEL, STAGE_STATE_LABEL } from '@/lib/competition/labels'

export const metadata: Metadata = { title: 'Competition Dashboard · Admin', robots: { index: false, follow: false } }

/**
 * The unified Competition Dashboard — the management hub for a single live
 * competition (currently Seasons; the `comp_*` model is Season-only, so Cups are not
 * yet live competitions). Reuses the existing registration, group, publication,
 * results, and standings services; renders only the sections the format needs.
 */
export default async function CompetitionDashboard({ params }: { params: Promise<{ id: string }> }) {
  const access = await resolveStaffAccess()
  if (access.status !== 'ok') return <StaffGate access={access} />
  if (!access.actor.can('manage_competitions'))
    return <StaffDenied active="seasons" username={access.actor.username} label="the Competition Dashboard" />

  const seasonId = Number((await params).id)
  if (!Number.isFinite(seasonId)) notFound()
  const season = await prisma.season.findUnique({ where: { id: seasonId } })
  if (!season) notFound()

  const [summary, groupCount, publishedGroups, playoffCount, publishedPlayoff, activeEntrants] = await Promise.all([
    getDashboardSummary(seasonId),
    prisma.seasonGroup.count({ where: { seasonId } }),
    prisma.seasonGroup.count({ where: { seasonId, published: true } }),
    prisma.playoffMatch.count({ where: { seasonId } }),
    prisma.playoffMatch.count({ where: { seasonId, published: true } }),
    prisma.registration.count({ where: { seasonId, status: 'APPROVED' } }),
  ])

  const regOpen = season.registrationStatus === 'OPEN'
  const groupsState = publishedGroups > 0 ? 'Published' : groupCount > 0 ? 'Draft' : 'Not created'
  const playoffState = publishedPlayoff > 0 ? 'Published' : playoffCount > 0 ? 'Draft' : 'Not created'

  return (
    <StaffShell active="seasons" username={access.actor.username} seasonName={season.name}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-bold tracking-tight">{season.name}</h1>
        <div className="flex flex-wrap gap-2">
          <Badge variant="gold">{SEASON_STATE_LABEL[season.seasonStatus]}</Badge>
          <Badge variant={regOpen ? 'success' : 'muted'}>{REGISTRATION_STATE_LABEL[season.registrationStatus]}</Badge>
          {season.archivedAt && <Badge variant="muted">Archived</Badge>}
        </div>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">Competition management hub. Sections reflect the current state and reuse the live-ops services.</p>

      <div className="mt-6 grid gap-5 lg:grid-cols-2">
        {/* Registration */}
        <Card>
          <CardHeader><CardTitle className="text-base">Registration</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p>Status: <span className="font-medium">{REGISTRATION_STATE_LABEL[season.registrationStatus]}</span></p>
            <div className="flex flex-wrap gap-2">
              {!regOpen && (
                <ActionButton
                  action={setRegistrationStateAction}
                  fields={{ seasonId, next: 'OPEN' }}
                  label={season.registrationStatus === 'CLOSED' ? 'Reopen Registration' : 'Open Registration'}
                  confirm="Change registration status?"
                />
              )}
              {regOpen && (
                <ActionButton
                  action={setRegistrationStateAction}
                  fields={{ seasonId, next: 'CLOSED' }}
                  label="Close Registration"
                  variant="outline"
                  confirm="Close registration? New registrations and member self-withdrawals will be blocked."
                />
              )}
            </div>
          </CardContent>
        </Card>

        {/* Entrants */}
        <Card>
          <CardHeader><CardTitle className="text-base">Entrants</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p><span className="font-display text-2xl font-bold">{activeEntrants}</span> active registration(s)</p>
            <Button asChild size="sm" variant="secondary"><Link href="/staff/registrations">View / manage entrants</Link></Button>
          </CardContent>
        </Card>

        {/* Groups */}
        <Card>
          <CardHeader><CardTitle className="text-base">Groups</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p>Status: <Badge variant={publishedGroups > 0 ? 'success' : 'muted'}>{groupsState}</Badge> · {groupCount} group(s)</p>
            <div className="flex flex-wrap gap-2">
              <Button asChild size="sm"><Link href="/staff/groups">Create / Edit Groups</Link></Button>
              {groupCount > 0 && publishedGroups === 0 && (
                <ActionButton action={publishGroupsAction} fields={{ seasonId }} label="Publish" confirm="Publish groups? Empty groups and double-assigned players are blocked." />
              )}
              {publishedGroups > 0 && (
                <ActionButton action={unpublishGroupsAction} fields={{ seasonId }} label="Unpublish" variant="outline" confirm="Unpublish groups? Hidden from the public site (only before results exist)." />
              )}
            </div>
          </CardContent>
        </Card>

        {/* Playoffs */}
        <Card>
          <CardHeader><CardTitle className="text-base">Playoffs</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p>Status: <Badge variant={publishedPlayoff > 0 ? 'success' : 'muted'}>{playoffState}</Badge></p>
            <Button asChild size="sm"><Link href="/staff/playoffs">Create / Edit Bracket</Link></Button>
          </CardContent>
        </Card>

        {/* Results */}
        <Card>
          <CardHeader><CardTitle className="text-base">Results</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p>{summary.matchesWaiting} awaiting result · {summary.unverified} unverified · {summary.disputes} disputed</p>
            <div className="flex flex-wrap gap-2">
              <Button asChild size="sm" variant="secondary"><Link href="/staff/matches">Group results</Link></Button>
              <Button asChild size="sm" variant="secondary"><Link href="/staff/playoffs">Playoff results</Link></Button>
            </div>
            <p className="text-xs text-muted-foreground">Enter, edit, undo, or forfeit results — each edit recalculates standings, rankings, and player stats and is audit-logged.</p>
          </CardContent>
        </Card>

        {/* Standings */}
        <Card>
          <CardHeader><CardTitle className="text-base">Standings</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p>Group stage: {STAGE_STATE_LABEL[season.groupsStatus]}</p>
            <Button asChild size="sm" variant="secondary"><Link href="/staff/standings">View standings</Link></Button>
          </CardContent>
        </Card>
      </div>

      {/* Competition actions */}
      <Card className="mt-6">
        <CardHeader><CardTitle className="text-base">Competition Actions</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2 text-sm">
          <Button asChild size="sm" variant="outline"><Link href="/staff/season">Competition settings</Link></Button>
          {season.seasonStatus !== 'COMPLETED' && (
            <ActionButton
              action={completeCompetitionAction}
              fields={{ seasonId }}
              label="Complete Competition"
              variant="secondary"
              confirm="Mark this competition complete? It stops being the active in-progress season. You can revert from Competition settings."
            />
          )}
          {season.archivedAt ? (
            <ActionButton
              action={unarchiveCompetitionAction}
              fields={{ seasonId }}
              label="Restore from Archive"
              variant="outline"
              confirm="Restore this competition from the archive?"
            />
          ) : (
            <ActionButton
              action={archiveCompetitionAction}
              fields={{ seasonId }}
              label="Archive Competition"
              variant="destructive"
              confirm="Archive this competition? It moves to read-only history. This can be undone."
            />
          )}
          <Button asChild size="sm" variant="ghost"><Link href="/groups">View public groups</Link></Button>
          <Button asChild size="sm" variant="ghost"><Link href="/playoffs">View public playoffs</Link></Button>
        </CardContent>
      </Card>
    </StaffShell>
  )
}
