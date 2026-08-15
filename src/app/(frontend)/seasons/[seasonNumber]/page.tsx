import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { Diamond, Settings2 } from 'lucide-react'

import { Container } from '@/components/ui/container'
import { getSeasonView } from '@/lib/seasons/service'
import { SEASON_STATE_LABEL, isPreGroupPhase } from '@/lib/seasons/lifecycle'
import { SeasonRegistration } from '@/components/seasons/season-registration'
import { resolveStaffAccess } from '@/lib/competition/staff-auth'
import { getCurrentUser } from '@/lib/account/auth'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ seasonNumber: string }> }): Promise<Metadata> {
  const { seasonNumber } = await params
  const view = await getSeasonView(Number(seasonNumber))
  return view ? { title: view.title, description: view.description ?? 'WCC Season Championship.' } : { title: 'Season' }
}

export default async function SeasonPage({ params }: { params: Promise<{ seasonNumber: string }> }) {
  const { seasonNumber } = await params
  const number = Number(seasonNumber)
  if (!Number.isFinite(number)) notFound()
  const view = await getSeasonView(number)
  if (!view) notFound()

  const access = await resolveStaffAccess()
  const canManage = access.status === 'ok' && access.actor.can('manage_registrations')
  const user = await getCurrentUser()
  const registered = user
    ? !!(await prisma.seasonEntrant.findFirst({ where: { seasonId: view.id, status: { not: 'WITHDRAWN' }, userId: Number(user.id) }, select: { id: true } }))
    : false

  const isRegistrationPhase = view.lifecycleState === 'REGISTRATION_OPEN' || view.lifecycleState === 'REGISTRATION_SCHEDULED'

  return (
    <Container className="py-10">
      {/* Season header — prominent title + consistently-placed Settings button (every phase). */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <Link href="/seasons" className="text-sm text-muted-foreground hover:text-foreground">← Seasons</Link>
          <p className="mt-3 flex items-center gap-1.5 text-[0.6rem] font-bold uppercase tracking-[0.18em] text-[#d6ae42]">
            <Diamond className="size-3 fill-[#e6c463] text-[#e6c463] drop-shadow-[0_0_5px_rgba(230,196,99,0.8)]" aria-hidden /> Season Championship
          </p>
          <h1 className="mt-1.5 font-display text-3xl font-bold text-[#f5f1e6]">{view.subtitle?.trim() || view.title}</h1>
          {view.subtitle?.trim() && <p className="text-base font-semibold text-[#d6ae42]">{view.title}</p>}
          <div className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-[#8a6d24]/50 bg-[#d6ae42]/[0.06] px-2.5 py-1 text-xs font-semibold text-[#e6c463]">
            <span className="size-1.5 rounded-full bg-[#e6c463]" /> {SEASON_STATE_LABEL[view.lifecycleState]}
          </div>
        </div>
        {canManage && (
          <Link href={`/seasons/${number}/settings`} className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground">
            <Settings2 className="size-4" /> Settings
          </Link>
        )}
      </div>

      {view.description && <p className="mt-4 max-w-2xl text-sm text-muted-foreground">{view.description}</p>}

      {isRegistrationPhase ? (
        <SeasonRegistration
          seasonId={view.id}
          seasonNumber={number}
          entrants={view.entrants.map((e) => ({ entrantId: e.entrantId, name: e.name, cueverseId: e.cueverseId, slug: e.slug, rating: e.rating }))}
          canManage={canManage}
          isOpen={view.lifecycleState === 'REGISTRATION_OPEN'}
          isLoggedIn={!!user}
          alreadyRegistered={registered}
          requiresPassword={view.requiresJoinPassword}
        />
      ) : (
        <PhasePlaceholder state={view.lifecycleState} entrants={view.entrantsCount} preGroup={isPreGroupPhase(view.lifecycleState)} canManage={canManage} />
      )}
    </Container>
  )
}

/** Interim placeholder for phases whose full interface lands in a later build (Group Setup, Group
 *  Stage, Playoffs, Completed). Keeps the Season page coherent without exposing a broken UI. */
function PhasePlaceholder({ state, entrants, preGroup, canManage }: { state: string; entrants: number; preGroup: boolean; canManage: boolean }) {
  return (
    <div className="mt-8 rounded-lg border border-border bg-card/40 p-6">
      <p className="text-sm text-muted-foreground">
        This Season is in the <span className="font-semibold text-foreground">{SEASON_STATE_LABEL[state as keyof typeof SEASON_STATE_LABEL] ?? state}</span> phase.
        {' '}Registration is closed with <span className="font-semibold text-foreground">{entrants}</span> entrants and locked seeding ratings captured.
      </p>
      {canManage && preGroup && (
        <p className="mt-2 text-xs text-muted-foreground">The Group Setup interface is being built — the entrant field and rating snapshots are ready for it.</p>
      )}
    </div>
  )
}
