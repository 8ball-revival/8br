import type { Metadata } from 'next'
import { redirect } from 'next/navigation'

import { Container } from '@/components/ui/container'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ownerExists } from '@/lib/account/actions'
import { SetupForm } from '@/components/account/setup-form'

export const dynamic = 'force-dynamic' // must re-check owner existence on every request

export const metadata: Metadata = {
  title: 'Set up World Cue Championships',
  robots: { index: false, follow: false },
}

/**
 * First-run setup. Renders ONLY while no account exists; once an owner is created this
 * page permanently redirects away (it self-disables — no lingering public setup route).
 */
export default async function SetupPage() {
  if (await ownerExists()) redirect('/login')
  const secretRequired = Boolean(process.env.SETUP_SECRET)

  return (
    <Container className="mx-auto max-w-md py-16">
      <p className="eyebrow text-primary">World Cue Championships</p>
      <h1 className="mt-2 font-display text-2xl font-bold tracking-tight">First-run setup</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Create the first administrator (Owner) account. This page is available only until the owner
        account exists, after which it disables itself.
      </p>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base">Create the owner account</CardTitle>
        </CardHeader>
        <CardContent>
          <SetupForm secretRequired={secretRequired} />
        </CardContent>
      </Card>
    </Container>
  )
}
