import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'

import { Container } from '@/components/ui/container'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { CreateAccountForm } from '@/components/account/create-account-form'
import { getCurrentUser } from '@/lib/account/auth'
import { getRegistrationMode } from '@/lib/account/registration-settings'
import { safeReturnTo } from '@/lib/account/return-to'
import { pageMetadata } from '@/lib/site'

export const dynamic = 'force-dynamic' // auth-dependent

export const metadata: Metadata = pageMetadata({
  title: 'Create your account',
  description: 'Create a 8 Ball Registry account to enter Cups.',
  path: '/register',
  index: false,
})

export default async function RegisterPage({ searchParams }: { searchParams: Promise<{ returnTo?: string }> }) {
  const { returnTo: rawReturnTo } = await searchParams
  const returnTo = safeReturnTo(rawReturnTo)
  const user = await getCurrentUser()
  if (user) redirect(returnTo)

  // Only the mode crosses into the page. The code never enters the component tree, so it cannot
  // appear in the HTML, the server-rendered props or the RSC payload.
  const requireCode = (await getRegistrationMode()) === 'PRIVATE'

  return (
    <Container className="mx-auto max-w-md py-16">
      <p className="eyebrow text-primary">8 Ball Registry</p>
      <h1 className="mt-2 font-display text-2xl font-bold tracking-tight">Create your account</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Your CueVerse ID is your public identity and your login. You can enter any open Cup
        from its page once you&apos;re signed in.
      </p>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base">Sign up</CardTitle>
        </CardHeader>
        <CardContent>
          <CreateAccountForm returnTo={returnTo} requireCode={requireCode} />
        </CardContent>
      </Card>

      <p className="mt-4 text-center text-sm text-muted-foreground">
        Already have an account?{' '}
        <Link href={returnTo !== '/account' ? `/login?returnTo=${encodeURIComponent(returnTo)}` : '/login'} className="font-medium text-brand hover:text-brand-soft">
          Sign in
        </Link>
      </p>
    </Container>
  )
}
