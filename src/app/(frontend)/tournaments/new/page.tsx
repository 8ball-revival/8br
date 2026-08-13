import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'

import { Container } from '@/components/ui/container'
import { CreateTournamentForm } from '@/components/tournaments/create-tournament-form'
import { resolveStaffAccess } from '@/lib/competition/staff-auth'

export const dynamic = 'force-dynamic' // auth-gated, per-request

export const metadata: Metadata = {
  title: 'Create Tournament',
  alternates: { canonical: '/tournaments/new' },
  robots: { index: false },
}

export default async function NewTournamentPage() {
  // Server-side authorization: only staff who can manage competitions may create tournaments.
  // (No experience thresholds or format-approval gates — every such admin gets all four formats.)
  const access = await resolveStaffAccess()
  if (!(access.status === 'ok' && access.actor.can('manage_competitions'))) redirect('/tournaments')

  return (
    <Container className="py-10">
      <Link href="/tournaments" className="mb-6 inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground">
        <ArrowLeft className="size-4" /> Tournaments
      </Link>
      <h1 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">Create Tournament</h1>
      <p className="mt-1 mb-8 text-sm text-muted-foreground">
        One screen. Fields appear only when they apply — no calendar or time-slot steps unless you schedule for later.
      </p>
      <CreateTournamentForm />
    </Container>
  )
}
