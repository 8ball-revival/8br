import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'

import { Container } from '@/components/ui/container'
import { CreateTournamentForm } from '@/components/tournaments/create-tournament-form'
import { resolveStaffAccess } from '@/lib/competition/staff-auth'
import { listCompetitionOptions } from '@/lib/competition/competition-options'

export const dynamic = 'force-dynamic' // auth-gated, per-request

export const metadata: Metadata = {
  title: 'Create Tournament',
  alternates: { canonical: '/tournaments/new' },
  robots: { index: false },
}

/**
 * Create a Tournament, in the Tournaments section.
 *
 * This route briefly redirected into Creator, on the reasoning that one create flow is better than
 * two. The conclusion was right and the direction was wrong: Creator's business is Seasons and their
 * historical reconstruction, and a Tournament administrator was being sent out of the section they
 * were working in to reach the only thing it is for. The single flow lives here now, and the Creator
 * URL redirects into it.
 *
 * The gate is the capability, not "is staff" — an editor is staff and has no business creating a
 * competition. The form's own server action re-checks it; this only decides whether the page renders.
 */
export default async function NewTournamentPage() {
  const access = await resolveStaffAccess()
  if (!(access.status === 'ok' && access.actor.can('manage_competitions'))) redirect('/tournaments')

  // Loaded server-side from the canonical Competition table so the selector can never offer a
  // Competition that does not exist, and never needs a name hardcoded into the client.
  const competitions = await listCompetitionOptions()

  return (
    <Container className="py-10">
      <Link href="/tournaments" className="mb-6 inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground">
        <ArrowLeft className="size-4" /> Tournaments
      </Link>
      <h1 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">Create Tournament</h1>
      <p className="mt-1 mb-8 text-sm text-muted-foreground">
        One screen. Fields appear only when they apply — no calendar or time-slot steps unless you
        schedule for later.
      </p>
      <CreateTournamentForm competitions={competitions} />
    </Container>
  )
}
