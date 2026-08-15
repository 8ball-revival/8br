import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { Container } from '@/components/ui/container'
import { getCurrentUser } from '@/lib/account/auth'
import { needsPermanentPassword } from '@/lib/staff/password-reset'
import { SetPasswordForm } from '@/components/account/set-password-form'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Set a permanent password', robots: { index: false } }

export default async function SetPasswordPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login?returnTo=/account/set-password')
  if (!(await needsPermanentPassword(Number(user.id)))) redirect('/account')

  return (
    <Container className="max-w-md py-16">
      <div className="rounded-xl border border-brand/40 bg-card/60 p-6" style={{ boxShadow: '0 0 0 1px rgba(200,16,46,0.35), 0 0 30px -10px rgba(200,16,46,0.4)' }}>
        <p className="eyebrow text-brand">Security</p>
        <h1 className="mt-1 font-display text-2xl font-bold">Set a permanent password</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          An administrator issued you a temporary access code. Choose a permanent password now to finish
          securing your account — your temporary code stops working once you do.
        </p>
        <SetPasswordForm />
      </div>
    </Container>
  )
}
