import type { Metadata } from 'next'
import { redirect } from 'next/navigation'

import { Container } from '@/components/ui/container'
import { Card, CardContent } from '@/components/ui/card'
import { SignInForm } from '@/components/account/sign-in-form'
import { getCurrentUser } from '@/lib/account/auth'
import { pageMetadata } from '@/lib/site'

export const dynamic = 'force-dynamic' // auth/user-specific — must render per-request (reads headers/cookies)

export const metadata: Metadata = pageMetadata({
  title: 'Sign In',
  description: 'Sign in to your World Cue Championships account to manage your tournament registration.',
  path: '/login',
  index: false,
})

export default async function LoginPage() {
  const user = await getCurrentUser()
  if (user) redirect('/account')

  return (
    <Container className="flex min-h-[calc(100vh-16rem)] flex-col items-center justify-center py-16">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <p className="eyebrow text-brand">World Cue Championships</p>
          <h1 className="mt-2 font-display text-3xl font-bold tracking-tight">Welcome back</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Sign in to manage your World Cue Championships account and tournament registration.
          </p>
        </div>
        <Card>
          <CardContent className="pt-6">
            <SignInForm />
          </CardContent>
        </Card>
      </div>
    </Container>
  )
}
