import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'

import { Container } from '@/components/ui/container'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/page-header'
import { SignOutButton } from '@/components/account/sign-out-button'
import { getCurrentUser } from '@/lib/account/auth'
import { getProfileByUserId, cueverseCooldownState } from '@/lib/players/service'
import { formatIdentityLabel } from '@/lib/identity/public-identity'
import { CueverseIdForm } from '@/components/account/cueverse-id-form'
import { AccountSettings } from '@/components/account/account-settings'
import { formatDate } from '@/lib/format'
import { pageMetadata } from '@/lib/site'

export const dynamic = 'force-dynamic' // auth/user-specific — must render per-request (reads headers/cookies)

export const metadata: Metadata = pageMetadata({
  title: 'Your Account',
  description: 'Manage your 8 Ball Registry account and competitive identity.',
  path: '/account',
  index: false,
})

export default async function AccountPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login')

  const profile = await getProfileByUserId(Number(user.id))

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Home', href: '/' }, { label: 'Account' }]}
        title={profile ? `Welcome, ${profile.primaryName}` : 'Your Account'}
        description={profile?.cueverseId ? `Playing as ${profile.cueverseId}` : undefined}
        actions={<SignOutButton />}
      />

      <Container className="grid items-start gap-8 py-10 lg:grid-cols-2">
        {/* Account details */}
        <Card>
          <CardHeader>
            <CardTitle>Account details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <Row label="CueVerse ID" value={profile?.cueverseId ?? user.cueverseId ?? user.username} hint="Your public identity and login name — sign in with this or your email." />
            <Row label="Email" value={user.email} hint="Private — never shown publicly." />
            {user.createdAt && <Row label="Member since" value={formatDate(user.createdAt)} />}
            <Row
              label="Public identity"
              value={profile ? formatIdentityLabel(profile.primaryName, profile.cueverseId) : (user.cueverseId ?? user.username)}
              hint={profile ? 'Shown across the site as Preferred Name (CueVerse ID).' : undefined}
            />
            {profile && (
              <div className="border-t border-border pt-4">
                <CueverseIdForm
                  current={profile.cueverseId}
                  canChange={cueverseCooldownState(profile.cueverseIdChangedAt).canChange}
                />
              </div>
            )}
            <div className="border-t border-border pt-4">
              <AccountSettings
                profile={
                  profile
                    ? {
                        preferredName:
                          profile.cueverseId && profile.primaryName.toLowerCase() === profile.cueverseId.toLowerCase()
                            ? ''
                            : profile.primaryName,
                        discord: profile.discord,
                        timeZone: profile.timeZone,
                      }
                    : null
                }
                email={user.email}
              />
            </div>
          </CardContent>
        </Card>

        {/* Compete */}
        <Card>
          <CardHeader>
            <CardTitle>Compete</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <p className="text-muted-foreground">
              Tournaments are where you register and play. Browse open tournaments and enter directly from
              a tournament&apos;s page.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button asChild><Link href="/tournaments">Browse tournaments</Link></Button>
              <Button asChild variant="ghost"><Link href="/rankings">Rankings</Link></Button>
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
