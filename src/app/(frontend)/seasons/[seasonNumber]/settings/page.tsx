import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import Link from 'next/link'

import { Container } from '@/components/ui/container'
import { SectionHeader } from '@/components/section-header'
import { getSeasonView } from '@/lib/seasons/service'
import { SEASON_STATE_LABEL } from '@/lib/seasons/lifecycle'
import { resolveStaffAccess } from '@/lib/competition/staff-auth'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Season Settings', robots: { index: false } }

export default async function SeasonSettingsPage({ params }: { params: Promise<{ seasonNumber: string }> }) {
  const { seasonNumber } = await params
  const view = await getSeasonView(Number(seasonNumber))
  if (!view) notFound()
  const access = await resolveStaffAccess()
  if (access.status !== 'ok' || !access.actor.can('manage_competitions')) notFound()

  const editableNow = view.lifecycleState === 'REGISTRATION_OPEN' || view.lifecycleState === 'REGISTRATION_SCHEDULED'

  return (
    <Container className="py-10">
      <Link href={`/seasons/${view.number}`} className="text-sm text-muted-foreground hover:text-foreground">← {view.title}</Link>
      <SectionHeader eyebrow="Season Settings" title={view.title} description={view.subtitle ?? undefined} />

      <div className="max-w-2xl space-y-4">
        <dl className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border bg-surface">
          <Row k="Status" v={SEASON_STATE_LABEL[view.lifecycleState]} />
          <Row k="Lounge" v={view.lounge} />
          <Row k="Registration access" v={view.accessMode === 'PASSWORD' ? 'Password required' : 'Open to all'} />
          <Row k="Group-stage games" v={String(view.format.groupStageGames)} />
          <Row k="Early playoff · Race To" v={String(view.format.earlyRaceTo)} />
          <Row k="Semifinal · Race To" v={String(view.format.semifinalRaceTo)} />
          <Row k="Final · Race To" v={String(view.format.finalRaceTo)} />
          <Row k="Entrants" v={String(view.entrantsCount)} />
        </dl>
        <p className="text-xs text-muted-foreground">
          Editable Season Settings (name/subtitle, description, match format, access, schedule, artwork,
          Export Season Data) and the Danger Zone are lifecycle-aware and land in a later build.
          {editableNow ? ' Registration access and schedule are still editable at this phase.' : ' Registration is closed, so access and schedule are locked.'}
        </p>
      </div>
    </Container>
  )
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-3 px-5 py-3 text-sm">
      <dt className="text-muted-foreground">{k}</dt>
      <dd className="font-semibold text-foreground">{v}</dd>
    </div>
  )
}
