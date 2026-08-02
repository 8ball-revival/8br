import type { Metadata } from 'next'
import Link from 'next/link'

import { Container } from '@/components/ui/container'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { PageHeader } from '@/components/page-header'
import { ClaimForm } from '@/components/account/claim-form'
import { pageMetadata } from '@/lib/site'

export const metadata: Metadata = pageMetadata({
  title: 'Claim your account',
  description: 'Claim your pre-created 8 Ball Revival account with your CueVerse login ID and one-time claim code.',
  path: '/claim-account',
  index: false,
})

export default function ClaimAccountPage() {
  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Home', href: '/' }, { label: 'Claim account' }]}
        title="Claim your account"
        description="If you competed in 8 Ball Revival, an account is already waiting for you — linked to your full history."
      />
      <Container className="py-10">
        <Card className="mx-auto max-w-md">
          <CardHeader>
            <CardTitle>Enter your claim details</CardTitle>
          </CardHeader>
          <CardContent>
            <ClaimForm />
            <p className="mt-4 border-t border-border pt-4 text-center text-sm text-muted-foreground">
              Already claimed? <Link href="/login" className="font-medium text-gold hover:text-gold-soft">Sign in</Link>
            </p>
          </CardContent>
        </Card>
      </Container>
    </>
  )
}
