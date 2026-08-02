import type { Metadata } from 'next'
import Link from 'next/link'
import { CheckCircle2, Lock, XCircle } from 'lucide-react'

import { Container } from '@/components/ui/container'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { PageHeader } from '@/components/page-header'
import { CreateAccountForm } from '@/components/account/create-account-form'
import { RegisterForm } from '@/components/account/register-form'
import { getCurrentUser, getSeason2Registration } from '@/lib/account/auth'
import { getProfileByUserId } from '@/lib/players/service'
import { getPublicSeason, isRegistrationOpen, registrationDeadlineLabel } from '@/lib/competition/public'
import { REGISTRATION_STATE_LABEL } from '@/lib/competition/labels'
import { pageMetadata } from '@/lib/site'

const DEFAULT_FORMAT = 'Group stage into single-elimination playoffs'
const DEFAULT_ELIGIBILITY = 'Open to all registered 8 Ball Revival account holders.'

export const metadata: Metadata = pageMetadata({
  title: 'Register for 8 Ball Revival Season 2',
  description: 'Create your 8 Ball Revival account and enter 8 Ball Revival Season 2 — the group stage and playoffs await.',
  path: '/register',
})

export default async function RegisterPage() {
  const user = await getCurrentUser()
  const season = await getPublicSeason()
  const open = isRegistrationOpen(season)
  const regStatusLabel = season ? REGISTRATION_STATE_LABEL[season.registrationStatus] : 'Registration not yet open'
  const deadlineLabel = registrationDeadlineLabel(season)
  const formatSummary = season?.formatSummary ?? DEFAULT_FORMAT
  const eligibilitySummary = season?.eligibilitySummary ?? DEFAULT_ELIGIBILITY
  const registration = user ? await getSeason2Registration(user.id) : null
  const profile = user ? await getProfileByUserId(Number(user.id)) : null
  const formProfile = profile ? { primaryName: profile.primaryName, cueverseId: profile.cueverseId } : null

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Home', href: '/' }, { label: 'Register' }]}
        title="Register for 8 Ball Revival Season 2"
        description="Season 2 registration is separate from creating an account. Create an account (or sign in), then confirm your entry."
        actions={
          <Badge variant={open ? 'gold' : 'muted'}>
            {regStatusLabel}
          </Badge>
        }
      />

      <Container className="grid items-start gap-8 py-12 lg:grid-cols-[1.1fr_0.9fr]">
        {/* Left: what you're registering for (below the action on mobile) */}
        <div className="order-2 space-y-6 lg:order-1">
          <section>
            <p className="eyebrow text-gold">The competition</p>
            <h2 className="mt-2 font-display text-2xl font-bold tracking-tight">
              Claim your place in Season 2
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              8 Ball Revival Season 2 runs a full group stage into a single-elimination playoff bracket. Register
              once, then follow your group, standings, and the road to the title.
            </p>
            <dl className="mt-6 space-y-4 text-sm">
              <Detail term="Format">{formatSummary}</Detail>
              <Detail term="Eligibility">{eligibilitySummary}</Detail>
              <Detail term="Deadline">{deadlineLabel}</Detail>
              <Detail term="Rules">
                <Link href="/rules" className="font-medium text-gold hover:text-gold-soft">
                  Read the full rules &amp; format
                </Link>
              </Detail>
            </dl>
          </section>
        </div>

        {/* Right: the action, depending on auth + registration + open state */}
        <div className="order-1 lg:order-2">
          {!user ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-2xl">Create your account</CardTitle>
                <CardDescription>
                  You need an 8 Ball Revival account to register for Season 2. It takes a User ID, an email, and a
                  password — no email verification required.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <CreateAccountForm />
              </CardContent>
            </Card>
          ) : registration?.registered ? (
            <Card>
              <CardContent className="flex items-start gap-3 p-6">
                <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" aria-hidden />
                <div>
                  <p className="font-medium">
                    {registration?.status === 'APPROVED'
                      ? "You're confirmed for 8 Ball Revival Season 2."
                      : 'Your Season 2 registration is pending approval.'}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {registration?.status === 'APPROVED'
                      ? 'Group assignments will appear once the group stage is drawn.'
                      : '8 Ball Revival staff will review your entry. You will be seeded into a group once approved.'}
                  </p>
                  <Button asChild variant="secondary" size="sm" className="mt-4">
                    <Link href="/account">Go to your account</Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : !open ? (
            <Card>
              <CardContent className="flex items-start gap-3 p-6">
                <XCircle className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
                <div>
                  <p className="font-medium">Registration is closed.</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Season 2 registration is not open right now. {deadlineLabel}.
                  </p>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle className="text-2xl">Confirm your entry</CardTitle>
                <CardDescription>
                  Signed in as <span className="font-medium text-foreground">{user.username}</span>.
                  Confirm to enter 8 Ball Revival Season 2.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <RegisterForm profile={formProfile} />
              </CardContent>
            </Card>
          )}

          {!user && (
            <p className="mt-4 flex items-center justify-center gap-1.5 text-sm text-muted-foreground">
              <Lock className="size-3.5" aria-hidden />
              Already have an account?{' '}
              <Link href="/login" className="font-medium text-gold hover:text-gold-soft">
                Sign in
              </Link>
            </p>
          )}
        </div>
      </Container>
    </>
  )
}

function Detail({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div className="border-l-2 border-border pl-4">
      <dt className="eyebrow text-muted-foreground">{term}</dt>
      <dd className="mt-1 text-foreground">{children}</dd>
    </div>
  )
}
