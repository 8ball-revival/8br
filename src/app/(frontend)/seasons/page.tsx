import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowRight } from 'lucide-react'

import { Container } from '@/components/ui/container'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { PageHeader } from '@/components/page-header'
import { SectionHeader } from '@/components/section-header'
import { getPublicSeason, registrationDeadlineLabel, isRegistrationOpen } from '@/lib/competition/public'
import { REGISTRATION_STATE_LABEL, STAGE_STATE_LABEL } from '@/lib/competition/labels'
import { pageMetadata } from '@/lib/site'

export const metadata: Metadata = pageMetadata({
  title: '8 Ball Revival Seasons',
  description: '8 Ball Revival Season 2 is underway — explore the current season and the completed first season.',
  path: '/seasons',
})

export default async function SeasonsPage() {
  const season = await getPublicSeason()
  const open = isRegistrationOpen(season)
  const seasonName = season?.name ?? '8 Ball Revival Season 2'
  const formatSummary = season?.formatSummary ?? 'Group stage into single-elimination playoffs'
  const regStatusLabel = season ? REGISTRATION_STATE_LABEL[season.registrationStatus] : 'Registration not yet open'
  const groupsLabel = season ? STAGE_STATE_LABEL[season.groupsStatus] : 'Pending'
  const playoffsLabel = season ? STAGE_STATE_LABEL[season.playoffsStatus] : 'Pending'
  const deadlineLabel = registrationDeadlineLabel(season)

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Home', href: '/' }, { label: 'Seasons' }]}
        title="Seasons"
        description="8 Ball Revival Season 2 is the current competition. 8 Ball Revival Season 1 is complete. Earlier 8BRCAM records are preserved separately in the archive."
      />

      {/* Current season */}
      <section className="py-12">
        <Container>
          <SectionHeader eyebrow="Current" title="Current Season" />
          <Card className="overflow-hidden">
            <div className="bg-grid relative border-b border-border bg-card/40 p-8">
              <div className="relative flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h3 className="font-display text-3xl font-bold tracking-tight">{seasonName}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">{formatSummary}</p>
                </div>
                <Badge variant={open ? 'gold' : 'muted'}>
                  {regStatusLabel}
                </Badge>
              </div>
            </div>
            <CardContent className="grid gap-6 p-8 sm:grid-cols-3">
              <Stat label="Registration" value={regStatusLabel} hint={deadlineLabel} />
              <Stat label="Group stage" value={groupsLabel} hint="Drawn after registration closes" />
              <Stat label="Playoffs" value={playoffsLabel} hint="After the group stage" />
              <div className="col-span-full flex flex-wrap gap-3">
                <Button asChild>
                  <Link href="/register">
                    {open ? 'Register for Season 2' : 'Registration status'} <ArrowRight className="size-4" />
                  </Link>
                </Button>
                <Button asChild variant="outline">
                  <Link href="/groups">Groups</Link>
                </Button>
                <Button asChild variant="outline">
                  <Link href="/playoffs">Playoffs</Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        </Container>
      </section>

      {/* Completed seasons */}
      <section className="border-t border-border bg-card/20 py-12">
        <Container>
          <SectionHeader eyebrow="Completed" title="Completed Seasons" />
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            <Link href="/seasons/ego-season-1" className="group block">
              <Card className="h-full transition-colors group-hover:border-gold/40">
                <CardHeader>
                  <div className="flex items-center justify-between gap-2">
                    <Badge variant="outline">Completed</Badge>
                    <Badge variant="muted">Pending verification</Badge>
                  </div>
                  <CardTitle className="mt-2 text-xl transition-colors group-hover:text-gold">
                    8 Ball Revival Season 1
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm text-muted-foreground">
                  <p>Originally 8B Retro Season 1.</p>
                  <p className="inline-flex items-center gap-1.5 font-medium text-gold">
                    View season <ArrowRight className="size-4" aria-hidden />
                  </p>
                </CardContent>
              </Card>
            </Link>
          </div>
          <p className="mt-6 text-sm text-muted-foreground">
            Looking for earlier competitions? The full 8BRCAM history is preserved in the{' '}
            <Link href="/competitions" className="font-medium text-gold hover:text-gold-soft">
              archive
            </Link>
            .
          </p>
        </Container>
      </section>
    </>
  )
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <p className="eyebrow text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold">{value}</p>
      {hint && <p className="text-sm text-muted-foreground">{hint}</p>}
    </div>
  )
}
