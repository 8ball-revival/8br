import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { CheckCircle2 } from 'lucide-react'

import { Container } from '@/components/ui/container'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { PageHeader } from '@/components/page-header'
import { RegisterForm } from '@/components/account/register-form'
import { SignOutButton } from '@/components/account/sign-out-button'
import { getCurrentUser, getSeason2Registration } from '@/lib/account/auth'
import { getPublicSeason, isRegistrationOpen, registrationDeadlineLabel } from '@/lib/competition/public'
import { formatDate } from '@/lib/format'
import { pageMetadata } from '@/lib/site'

const DEFAULT_ELIGIBILITY = 'Open to all registered 8 Ball Revival account holders.'

export const metadata: Metadata = pageMetadata({
  title: 'Your Account',
  description: 'Your 8 Ball Revival account and Season 2 registration status.',
  path: '/account',
  index: false,
})

export default async function AccountPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login')

  const registration = await getSeason2Registration(user.id)
  const season = await getPublicSeason()
  const open = isRegistrationOpen(season)
  const deadlineLabel = registrationDeadlineLabel(season)
  const eligibilitySummary = season?.eligibilitySummary ?? DEFAULT_ELIGIBILITY
  const isApproved = registration.status === 'APPROVED'

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Home', href: '/' }, { label: 'Account' }]}
        title="Your Account"
        actions={<SignOutButton />}
      />

      <Container className="grid items-start gap-8 py-12 lg:grid-cols-2">
        {/* Account details (below the registration status on mobile) */}
        <Card className="order-2 lg:order-1">
          <CardHeader>
            <CardTitle>Account details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <Row label="User ID" value={user.username} />
            <Row label="Email" value={user.email} hint="Private — never shown publicly." />
            {user.createdAt && <Row label="Member since" value={formatDate(user.createdAt)} />}
          </CardContent>
        </Card>

        {/* Season 2 registration — the primary information, first on mobile */}
        <Card
          className={
            'order-1 lg:order-2 ' +
            (registration.registered
              ? 'border-success/40'
              : open
                ? 'border-gold/40'
                : '')
          }
        >
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <CardTitle>8 Ball Revival Season 2</CardTitle>
              <Badge variant={isApproved ? 'success' : registration.registered ? 'gold' : open ? 'gold' : 'muted'}>
                {isApproved
                  ? 'Registered'
                  : registration.registered
                    ? 'Pending approval'
                    : open
                      ? 'Registration open'
                      : 'Registration closed'}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            {registration.registered ? (
              <div className="flex items-start gap-3">
                <CheckCircle2
                  className={'mt-0.5 size-5 shrink-0 ' + (isApproved ? 'text-success' : 'text-gold')}
                  aria-hidden
                />
                <div>
                  <p className="font-medium text-foreground">
                    {isApproved ? "You're entered into Season 2." : 'Your entry is pending staff approval.'}
                  </p>
                  {registration.registeredAt && (
                    <p className="mt-1 text-muted-foreground">
                      Registered {formatDate(registration.registeredAt)}.
                    </p>
                  )}
                  <p className="mt-1 text-muted-foreground">
                    {isApproved
                      ? 'Group assignments will appear on the '
                      : 'Once approved, your group assignment will appear on the '}
                    <Link href="/groups" className="font-medium text-gold hover:text-gold-soft">
                      Groups
                    </Link>{' '}
                    page once drawn.
                  </p>
                </div>
              </div>
            ) : open ? (
              <>
                <p className="text-muted-foreground">
                  You have an account but haven&apos;t entered Season 2 yet. {eligibilitySummary}
                </p>
                <RegisterForm />
              </>
            ) : (
              <p className="text-muted-foreground">
                Season 2 registration is closed. {deadlineLabel}.
              </p>
            )}

            <div className="border-t border-border pt-4">
              <Button asChild variant="ghost" size="sm">
                <Link href="/rules">Rules &amp; format</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </Container>
    </>
  )
}

function Row({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-border pb-3 last:border-0 last:pb-0">
      <span className="eyebrow text-muted-foreground">{label}</span>
      <span className="font-medium text-foreground">{value}</span>
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </div>
  )
}
