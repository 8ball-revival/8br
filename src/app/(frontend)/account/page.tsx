import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { CheckCircle2, TrendingUp, TrendingDown, CalendarClock, ExternalLink } from 'lucide-react'

import { Container } from '@/components/ui/container'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { PageHeader } from '@/components/page-header'
import { RegisterForm } from '@/components/account/register-form'
import { WithdrawButton } from '@/components/account/withdraw-button'
import { SignOutButton } from '@/components/account/sign-out-button'
import { getCurrentUser, getSeason2Registration } from '@/lib/account/auth'
import { getPublicSeason, isRegistrationOpen, registrationDeadlineLabel } from '@/lib/competition/public'
import { getProfileByUserId } from '@/lib/players/service'
import { getCareerStatById } from '@/lib/stats/career-stats'
import { getPlayerRankingProfile } from '@/lib/stats/rankings'
import { cupStore, loadCupContext } from '@/lib/cups/prime'
import { slugForCanonicalId } from '@/lib/preview-players'
import { cn } from '@/lib/utils'
import { formatDate } from '@/lib/format'
import { pageMetadata } from '@/lib/site'
import type { MatchResult } from '@/lib/stats/rating-engine'

const DEFAULT_ELIGIBILITY = 'Open to all registered 8 Ball Revival account holders.'

export const metadata: Metadata = pageMetadata({
  title: 'Your Account',
  description: 'Your 8 Ball Revival account, competitive dashboard, and Season 2 registration.',
  path: '/account',
  index: false,
})

export default async function AccountPage() {
  cupStore.enterWith(await loadCupContext()) // resolve the live Cup revision before cup-derived career/rankings
  const user = await getCurrentUser()
  if (!user) redirect('/login')

  const registration = await getSeason2Registration(user.id)
  const season = await getPublicSeason()
  const open = isRegistrationOpen(season)
  const deadlineLabel = registrationDeadlineLabel(season)
  const eligibilitySummary = season?.eligibilitySummary ?? DEFAULT_ELIGIBILITY
  const isApproved = registration.status === 'APPROVED'

  // Linked canonical player profile (historical identity), if staff has linked it.
  const profile = await getProfileByUserId(Number(user.id))
  const career = profile?.legacyPlayerId ? getCareerStatById(profile.legacyPlayerId) : null
  const ranking = profile?.legacyPlayerId ? getPlayerRankingProfile(profile.legacyPlayerId) : null
  const publicSlug = profile?.legacyPlayerId ? slugForCanonicalId(profile.legacyPlayerId) : null
  const formProfile = profile ? { primaryName: profile.primaryName, cueverseId: profile.cueverseId } : null

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Home', href: '/' }, { label: 'Account' }]}
        title={profile ? `Welcome, ${profile.primaryName}` : 'Your Account'}
        description={profile?.cueverseId ? `Playing as ${profile.cueverseId}` : undefined}
        actions={<SignOutButton />}
      />

      {/* Competitive dashboard (linked) */}
      {profile && (
        <Container className="pt-10">
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle>Competitive Dashboard</CardTitle>
                <div className="flex items-center gap-2">
                  {profile.discord && <Badge variant="muted">💬 {profile.discord}</Badge>}
                  {publicSlug && (
                    <Button asChild variant="outline" size="sm">
                      <Link href={`/players/${publicSlug}`}>
                        Full profile <ExternalLink className="ml-1 size-3.5" aria-hidden />
                      </Link>
                    </Button>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-6 text-sm">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
                <Metric label="Current rank" value={ranking?.inCurrentWindow ? ordinal(ranking.currentRank) : '—'} accent />
                <Metric label="Ranking score" value={ranking?.inCurrentWindow ? ranking.score ?? '—' : '—'} />
                <Metric label="All-time peak" value={ranking?.peakRating ?? '—'} sub={ranking?.bestYearEndRank ? `best ${ordinal(ranking.bestYearEndRank)}` : undefined} />
                <Metric label="Season titles" value={career?.seasonTitles ?? 0} accent={(career?.seasonTitles ?? 0) > 0} />
                <Metric label="Cup titles" value={career?.cupTitles ?? 0} accent={(career?.cupTitles ?? 0) > 0} />
                <Metric label="Playoff W–L" value={career ? `${career.playoffWins}–${career.playoffLosses}` : '—'} />
                <Metric label="Career W–L" value={career ? `${career.totalWins}–${career.totalLosses}` : '—'} sub={career ? `${career.totalWinPct}%` : undefined} />
              </div>

              {ranking?.inCurrentWindow && (
                <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                  <span className="inline-flex items-center gap-2 text-muted-foreground">
                    Recent form: <FormPips form={ranking.recentForm} />
                  </span>
                  <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                    Trend:{' '}
                    {ranking.trend > 0 ? (
                      <span className="inline-flex items-center gap-1 font-medium text-success"><TrendingUp className="size-4" />+{ranking.trend}</span>
                    ) : ranking.trend < 0 ? (
                      <span className="inline-flex items-center gap-1 font-medium text-destructive"><TrendingDown className="size-4" />{ranking.trend}</span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </span>
                </div>
              )}

              <div className="grid gap-6 lg:grid-cols-2">
                <div>
                  <h3 className="eyebrow mb-2 text-muted-foreground">Recent results</h3>
                  {ranking && ranking.scoreBreakdown.filter((l) => l.label !== 'Total').length > 0 ? (
                    <ul className="space-y-1">
                      {ranking.scoreBreakdown.filter((l) => l.label !== 'Total').slice(0, 6).map((l, i) => (
                        <li key={i} className="flex items-center justify-between gap-4">
                          <span className="truncate text-muted-foreground">{l.label}</span>
                          <span className={cn('tabular', l.points >= 0 ? 'text-success' : 'text-destructive')}>{l.points >= 0 ? '+' : ''}{l.points}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-muted-foreground">No results in the current window yet.</p>
                  )}
                </div>
                <div>
                  <h3 className="eyebrow mb-2 text-muted-foreground">Upcoming matches</h3>
                  <p className="inline-flex items-center gap-2 text-muted-foreground">
                    <CalendarClock className="size-4" aria-hidden />
                    None scheduled yet — appears once the group stage is drawn.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </Container>
      )}

      <Container className="grid items-start gap-8 py-10 lg:grid-cols-2">
        {/* Account details */}
        <Card className="order-2 lg:order-1">
          <CardHeader>
            <CardTitle>Account details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <Row label="User ID" value={user.username} />
            <Row label="Email" value={user.email} hint="Private — never shown publicly." />
            {user.createdAt && <Row label="Member since" value={formatDate(user.createdAt)} />}
            <Row label="Player profile" value={profile ? `${profile.primaryName}${profile.cueverseId ? ` (${profile.cueverseId})` : ''}` : 'Not linked yet'} />
          </CardContent>
        </Card>

        {/* Season 2 registration */}
        <Card className={'order-1 lg:order-2 ' + (registration.registered ? 'border-success/40' : open ? 'border-gold/40' : '')}>
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <CardTitle>8 Ball Revival Season 2</CardTitle>
              <Badge variant={isApproved ? 'success' : registration.registered ? 'gold' : open ? 'gold' : 'muted'}>
                {isApproved ? 'Registered' : registration.registered ? 'Pending approval' : open ? 'Registration open' : 'Registration closed'}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            {registration.registered ? (
              <div className="flex items-start gap-3">
                <CheckCircle2 className={'mt-0.5 size-5 shrink-0 ' + (isApproved ? 'text-success' : 'text-gold')} aria-hidden />
                <div>
                  <p className="font-medium text-foreground">
                    {isApproved ? "You're entered into Season 2." : 'Your entry is pending staff approval.'}
                  </p>
                  {registration.registeredAt && <p className="mt-1 text-muted-foreground">Registered {formatDate(registration.registeredAt)}.</p>}
                  <p className="mt-1 text-muted-foreground">
                    {isApproved ? 'Group assignments will appear on the ' : 'Once approved, your group assignment will appear on the '}
                    <Link href="/groups" className="font-medium text-gold hover:text-gold-soft">Groups</Link> page once drawn.
                  </p>
                </div>
              </div>
            ) : open ? (
              <>
                <p className="text-muted-foreground">You have an account but haven&apos;t entered Season 2 yet. {eligibilitySummary}</p>
                <RegisterForm profile={formProfile} />
              </>
            ) : (
              <p className="text-muted-foreground">Season 2 registration is closed. {deadlineLabel}.</p>
            )}
            {registration.registered && open && <WithdrawButton />}
            <div className="border-t border-border pt-4">
              <Button asChild variant="ghost" size="sm"><Link href="/rules">Rules &amp; format</Link></Button>
            </div>
          </CardContent>
        </Card>
      </Container>

      {/* Unlinked-profile notice */}
      {!profile && (
        <Container className="pb-12">
          <Card>
            <CardContent className="p-6 text-sm text-muted-foreground">
              <p className="font-medium text-foreground">Your historical player profile has not yet been linked by staff.</p>
              <p className="mt-1">
                You can still register, withdraw, and manage your account normally. Once staff link your account to your
                competitive identity, your full career history, rankings, and championships will appear here — nothing is
                fabricated in the meantime.
              </p>
            </CardContent>
          </Card>
        </Container>
      )}
    </>
  )
}

const ordinal = (n: number | null | undefined) => (n == null ? '—' : `#${n}`)

function FormPips({ form }: { form: MatchResult[] }) {
  if (!form.length) return <span className="text-muted-foreground/50">—</span>
  return (
    <span className="inline-flex gap-1">
      {form.map((r, i) => (
        <span key={i} className={cn('size-4 rounded-[3px] text-center text-[0.6rem] font-bold leading-4', r === 'W' && 'bg-success/20 text-success', r === 'L' && 'bg-destructive/20 text-destructive', r === 'D' && 'bg-muted-foreground/20 text-muted-foreground')}>{r}</span>
      ))}
    </span>
  )
}

function Metric({ label, value, accent, sub }: { label: string; value: React.ReactNode; accent?: boolean; sub?: string }) {
  return (
    <div className="rounded-lg border border-border bg-card/50 p-3">
      <div className={'tabular text-xl font-bold ' + (accent ? 'text-gold' : 'text-foreground')}>{value}</div>
      <div className="mt-0.5 text-[0.7rem] tracking-wide text-muted-foreground uppercase">{label}</div>
      {sub && <div className="text-[0.65rem] text-muted-foreground/70">{sub}</div>}
    </div>
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
