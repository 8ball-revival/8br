import type { Metadata } from 'next'
import Link from 'next/link'
import {
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  ListOrdered,
  ScrollText,
  Trophy,
  Users,
} from 'lucide-react'

import { Container } from '@/components/ui/container'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { HeroBanner } from '@/components/hero-banner'
import { SectionHeader } from '@/components/section-header'
import { getPublicSeason, isRegistrationOpen, registrationDeadlineLabel } from '@/lib/competition/public'
import { REGISTRATION_STATE_LABEL } from '@/lib/competition/labels'
import { getSeason2RegisteredCount } from '@/lib/account/auth'
import { absoluteUrl } from '@/lib/site'

const DEFAULT_FORMAT = 'Group stage into single-elimination playoffs'
const DEFAULT_ELIGIBILITY = 'Open to all registered 8 Ball Revival account holders.'

const DESCRIPTION = 'The next chapter of competitive online 8-ball. Formerly known as 8BRCAM.'

export const metadata: Metadata = {
  title: { absolute: '8 Ball Revival | Formerly 8BRCAM' },
  description: DESCRIPTION,
  alternates: { canonical: '/' },
  openGraph: {
    title: '8 Ball Revival | Formerly 8BRCAM',
    description: DESCRIPTION,
    url: absoluteUrl('/'),
    siteName: '8 Ball Revival',
    type: 'website',
  },
  twitter: { card: 'summary_large_image', title: '8 Ball Revival', description: DESCRIPTION },
}

export default async function HomePage() {
  const season = await getPublicSeason()
  const open = isRegistrationOpen(season)
  const registeredCount = await getSeason2RegisteredCount()
  const regStatusLabel = season ? REGISTRATION_STATE_LABEL[season.registrationStatus] : 'Registration not yet open'
  const deadlineLabel = registrationDeadlineLabel(season)
  const formatSummary = season?.formatSummary ?? DEFAULT_FORMAT
  const eligibilitySummary = season?.eligibilitySummary ?? DEFAULT_ELIGIBILITY

  const steps = [
    {
      icon: ClipboardList,
      title: 'Register',
      body: 'Create an 8 Ball Revival account and confirm your entry into Season 2 while registration is open.',
    },
    {
      icon: Users,
      title: 'Group stage',
      body: 'Registered players are drawn into groups and play a round of matches to qualify.',
    },
    {
      icon: Trophy,
      title: 'Playoffs',
      body: 'The top finishers advance to a single-elimination bracket to decide the champion.',
    },
  ]

  return (
    <>
      {/* Hero — 8 Ball Revival */}
      <HeroBanner
        eyebrow={
          open ? (
            <span className="inline-flex items-center gap-2">
              <span className="relative flex size-2">
                <span className="absolute inline-flex size-2 rounded-full bg-success/70" aria-hidden />
                <span className="relative inline-flex size-2 rounded-full bg-success" aria-hidden />
              </span>
              Season 2 · Registration Open
            </span>
          ) : (
            'Competitive online 8-ball'
          )
        }
        title={
          <>
            8 Ball <span className="text-gold-gradient">Revival</span>
          </>
        }
        subtitle={
          <>
            <span className="block">Formerly known as 8BRCAM.</span>
            <span className="mt-4 block">
              The next chapter of competitive online 8-ball. Preserving over two decades of competitive
              history while building the future of the game.
            </span>
          </>
        }
        actions={
          <>
            <Button asChild size="xl">
              <Link href="/register">
                Register for Season 2 <ArrowRight className="size-4" />
              </Link>
            </Button>
            <Button asChild size="xl" variant="outline">
              <Link href="/seasons/ego-season-1">View Season 1</Link>
            </Button>
          </>
        }
      />

      {/* Registration status (honest — real count, no fabricated deadline) */}
      <section className="border-b border-border bg-card/20">
        <Container className="grid gap-4 py-8 sm:grid-cols-3">
          <StatusTile
            label="Registration"
            value={regStatusLabel}
            hint={deadlineLabel}
            tone={open ? 'gold' : 'muted'}
          />
          <StatusTile
            label="Registered players"
            value={registeredCount.toLocaleString('en-US')}
            hint={registeredCount === 0 ? 'Be the first to register' : 'and counting'}
          />
          <StatusTile label="Format" value="Groups → Playoffs" hint={formatSummary} />
        </Container>
      </section>

      {/* How Season 2 works */}
      <section className="py-16">
        <Container>
          <SectionHeader eyebrow="How it works" title="How Season 2 works" />
          <div className="grid gap-5 md:grid-cols-3">
            {steps.map((s, i) => (
              <Card key={s.title} className="h-full">
                <CardHeader>
                  <div className="flex items-center gap-3">
                    <span className="flex size-9 items-center justify-center rounded-full bg-gold/10 text-gold">
                      <s.icon className="size-5" aria-hidden />
                    </span>
                    <span className="eyebrow text-muted-foreground">Step {i + 1}</span>
                  </div>
                  <CardTitle className="mt-2 text-lg">{s.title}</CardTitle>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground">{s.body}</CardContent>
              </Card>
            ))}
          </div>
        </Container>
      </section>

      {/* Group stage + playoff status (honest pending) */}
      <section className="border-t border-border bg-card/20 py-16">
        <Container className="grid gap-8 lg:grid-cols-2">
          <StageCard
            icon={ListOrdered}
            eyebrow="Group stage"
            title="Groups have not been formed yet"
            body="Once registration closes, players will be drawn into groups and standings will appear here."
            href="/groups"
            cta="Go to Groups"
          />
          <StageCard
            icon={Trophy}
            eyebrow="Playoffs"
            title="The playoff bracket is not set yet"
            body="The bracket will be published here after the group stage concludes."
            href="/playoffs"
            cta="Go to Playoffs"
          />
        </Container>
      </section>

      {/* Season 1 spotlight (real, completed archive) */}
      <section className="py-16">
        <Container>
          <SectionHeader
            eyebrow="Completed"
            title="8 Ball Revival Season 1"
            actionHref="/seasons/ego-season-1"
            actionLabel="View Season 1"
          />
          <Card>
            <CardContent className="flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" aria-hidden />
                <div>
                  <p className="font-medium">8 Ball Revival Season 1 is complete.</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    8 Ball Revival continues the competitive legacy previously known as 8BRCAM. Season 1
                    results are being verified from source — see the season page for everything on record.
                  </p>
                </div>
              </div>
              <Button asChild variant="secondary" className="shrink-0">
                <Link href="/seasons/ego-season-1">
                  Explore Season 1 <ArrowRight className="size-4" />
                </Link>
              </Button>
            </CardContent>
          </Card>
        </Container>
      </section>

      {/* Rules summary */}
      <section className="border-t border-border bg-card/20 py-16">
        <Container>
          <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <ScrollText className="mt-0.5 size-6 shrink-0 text-gold" aria-hidden />
              <div>
                <h2 className="font-display text-xl font-bold tracking-tight">Know the rules</h2>
                <p className="mt-1 max-w-xl text-sm text-muted-foreground">
                  {eligibilitySummary} Review the full match rules and format before you
                  register.
                </p>
              </div>
            </div>
            <Button asChild variant="outline" className="shrink-0">
              <Link href="/rules">Read the rules</Link>
            </Button>
          </div>
        </Container>
      </section>

      {/* CTA */}
      <section className="py-20">
        <Container>
          <div className="relative overflow-hidden rounded-2xl border border-gold/20 bg-card/40 p-10 text-center sm:p-16">
            <div
              className="absolute inset-0 bg-gradient-to-br from-gold/10 via-transparent to-transparent"
              aria-hidden
            />
            <div className="relative mx-auto max-w-2xl">
              <CalendarClock className="mx-auto mb-4 size-7 text-gold" aria-hidden />
              <h2 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">
                {open ? 'Season 2 registration is open' : '8 Ball Revival Season 2'}
              </h2>
              <p className="mt-3 text-muted-foreground">
                {open
                  ? 'Create your account, confirm your entry, and be ready when the group stage begins.'
                  : deadlineLabel + '.'}
              </p>
              <div className="mt-7 flex flex-wrap justify-center gap-3">
                <Button asChild size="xl">
                  <Link href="/register">{open ? 'Register for Season 2' : 'Registration status'}</Link>
                </Button>
                <Button asChild size="xl" variant="outline">
                  <Link href="/seasons">View all seasons</Link>
                </Button>
              </div>
            </div>
          </div>
        </Container>
      </section>
    </>
  )
}

function StatusTile({
  label,
  value,
  hint,
  tone = 'default',
}: {
  label: string
  value: string
  hint?: string
  tone?: 'default' | 'gold' | 'muted'
}) {
  return (
    <div className="rounded-lg border border-border bg-card/40 p-5">
      <p className="eyebrow text-muted-foreground">{label}</p>
      <p
        className={
          'mt-1 font-display text-xl font-bold tracking-tight ' +
          (tone === 'gold' ? 'text-gold' : '')
        }
      >
        {value}
      </p>
      {hint && <p className="mt-1 text-sm text-muted-foreground">{hint}</p>}
    </div>
  )
}

function StageCard({
  icon: Icon,
  eyebrow,
  title,
  body,
  href,
  cta,
}: {
  icon: typeof Trophy
  eyebrow: string
  title: string
  body: string
  href: string
  cta: string
}) {
  return (
    <Card className="h-full">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Icon className="size-5 text-gold" aria-hidden />
          <span className="eyebrow text-muted-foreground">{eyebrow}</span>
          <Badge variant="muted" className="ml-auto">
            Pending
          </Badge>
        </div>
        <CardTitle className="mt-2 text-lg">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">{body}</p>
        <Button asChild variant="ghost" size="sm">
          <Link href={href}>
            {cta} <ArrowRight className="size-4" />
          </Link>
        </Button>
      </CardContent>
    </Card>
  )
}
