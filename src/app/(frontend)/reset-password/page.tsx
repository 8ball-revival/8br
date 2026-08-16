import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'

import { Container } from '@/components/ui/container'
import { Card, CardContent } from '@/components/ui/card'
import { ResetPasswordForm } from '@/components/account/reset-password-form'
import { getCurrentUser } from '@/lib/account/auth'
import { pageMetadata } from '@/lib/site'

export const dynamic = 'force-dynamic' // auth/user-specific — must render per-request (reads headers/cookies)

export const metadata: Metadata = pageMetadata({
  title: 'Reset Password',
  description: 'Choose a new password for your 8 Ball Registry account.',
  path: '/reset-password',
  index: false,
})

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>
}) {
  const user = await getCurrentUser()
  if (user) redirect('/account')

  const { token } = await searchParams

  return (
    <Container className="flex min-h-[calc(100vh-16rem)] flex-col items-center justify-center py-16">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <p className="eyebrow text-brand">8 Ball Registry</p>
          <h1 className="mt-2 font-display text-3xl font-bold tracking-tight">Reset your password</h1>
          <p className="mt-2 text-sm text-muted-foreground">Choose a new password for your account.</p>
        </div>
        <Card>
          <CardContent className="pt-6">
            {token ? (
              <ResetPasswordForm token={token} />
            ) : (
              <div className="space-y-4 text-center">
                <p className="text-sm text-muted-foreground">
                  This reset link is missing or invalid. Request a new one from the sign-in page.
                </p>
                <Link href="/login" className="inline-block text-sm font-medium text-brand hover:text-brand-soft">
                  Back to sign in
                </Link>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </Container>
  )
}
