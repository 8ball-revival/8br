import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getPayload } from 'payload'
import config from '@payload-config'

import { Container } from '@/components/ui/container'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { isRecoveryEnabled, readRecoverySession } from '@/lib/recovery/auth'
import { isOwner, isAdmin } from '@/lib/auth/roles'
import { RecoveryLoginForm } from '@/components/recovery/recovery-login-form'
import { RecoveryConsole, type RecoveryAccount } from '@/components/recovery/recovery-console'

export const dynamic = 'force-dynamic' // never cache: re-check enablement + session per request

export const metadata: Metadata = {
  title: 'Recovery',
  robots: { index: false, follow: false },
}

/** Classify a Payload user doc into the recovery role label. */
function roleOf(roles: string[] | undefined): RecoveryAccount['role'] {
  if (isOwner(roles)) return 'owner'
  if (isAdmin(roles)) return 'admin'
  return 'member'
}

/**
 * Break-glass recovery console. Entirely inert (404) unless BOTH recovery env vars are set. It is
 * intentionally unlinked from all nav/sitemap/search — reachable only by direct URL with the
 * private operator credential.
 */
export default async function RecoveryPage() {
  if (!isRecoveryEnabled()) notFound()

  if (!(await readRecoverySession())) {
    return (
      <Container className="mx-auto max-w-sm py-16">
        <h1 className="font-display text-xl font-bold tracking-tight">Recovery</h1>
        <p className="mt-2 text-sm text-muted-foreground">Operator access only.</p>
        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="text-base">Unlock console</CardTitle>
          </CardHeader>
          <CardContent>
            <RecoveryLoginForm />
          </CardContent>
        </Card>
      </Container>
    )
  }

  const payload = await getPayload({ config: await config })
  // Owners + Admins are the accounts relevant to a transfer decision. Members are also offered as
  // targets so a compromised staff tier can be routed around entirely.
  const res = await payload.find({ collection: 'users', limit: 500, overrideAccess: true, sort: 'username' })
  const accounts: RecoveryAccount[] = res.docs.map((d) => {
    const doc = d as { id: number | string; username?: string; roles?: string[] }
    return { id: Number(doc.id), username: doc.username ?? `#${doc.id}`, role: roleOf(doc.roles) }
  })
  const currentOwner = accounts.find((a) => a.role === 'owner') ?? null
  const candidates = accounts.filter((a) => a.id !== currentOwner?.id)

  return (
    <Container className="mx-auto max-w-lg py-16">
      <p className="eyebrow text-primary">Break-glass</p>
      <h1 className="mt-2 font-display text-2xl font-bold tracking-tight">Recovery console</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Every action here is written to the audit log. Use only to restore control of the platform.
      </p>
      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base">Ownership transfer</CardTitle>
        </CardHeader>
        <CardContent>
          <RecoveryConsole currentOwner={currentOwner} candidates={candidates} />
        </CardContent>
      </Card>
    </Container>
  )
}
