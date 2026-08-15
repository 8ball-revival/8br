import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { Diamond, Settings2 } from 'lucide-react'

import { Container } from '@/components/ui/container'
import { getSeasonView } from '@/lib/seasons/service'
import { getSeasonGroupSetup, getSeasonGroupStage } from '@/lib/seasons/views'
import { loadSeasonSeeding, seasonPlayoffRounds, seasonChampion } from '@/lib/seasons/playoffs'
import { SEASON_STATE_LABEL } from '@/lib/seasons/shared'
import { SeasonRegistration } from '@/components/seasons/season-registration'
import { SeasonGroupSetup } from '@/components/seasons/season-group-setup'
import { SeasonGroupStage } from '@/components/seasons/season-group-stage'
import { SeasonPlayoffs } from '@/components/seasons/season-playoffs'
import { EnterPlayoffsButton } from '@/components/seasons/enter-playoffs-button'
import { Bracket } from '@/components/tournaments/bracket'
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
  const canManageComp = access.status === 'ok' && access.actor.can('manage_competitions')
  const user = await getCurrentUser()
  const registered = user ? !!(await prisma.seasonEntrant.findFirst({ where: { seasonId: view.id, status: { not: 'WITHDRAWN' }, userId: Number(user.id) }, select: { id: true } })) : false

  const state = view.lifecycleState

  return (
    <Container className="py-10">
      <SeasonHeader view={view} canManage={canManage} number={number} />
      {view.description && <p className="mt-4 max-w-2xl text-sm text-muted-foreground">{view.description}</p>}

      {(state === 'REGISTRATION_OPEN' || state === 'REGISTRATION_SCHEDULED') && (
        <SeasonRegistration
          seasonId={view.id} seasonNumber={number}
          entrants={view.entrants.map((e) => ({ entrantId: e.entrantId, name: e.name, cueverseId: e.cueverseId, slug: e.slug, rating: e.rating }))}
          canManage={canManage} isOpen={state === 'REGISTRATION_OPEN'} isLoggedIn={!!user} alreadyRegistered={registered} requiresPassword={view.requiresJoinPassword}
        />
      )}

      {(state === 'REGISTRATION_CLOSED' || state === 'GROUP_SETUP') && (
        canManageComp
          ? <SeasonGroupSetup seasonId={view.id} view={await getSeasonGroupSetup(view.id)} />
          : <Info>Registration is closed with {view.entrantsCount} entrants. Groups are being set up — group play will appear here once published.</Info>
      )}

      {state === 'GROUP_STAGE_LIVE' && (
        <SeasonGroupStage seasonId={view.id} groups={await getSeasonGroupStage(view.id)} groupStageGames={view.format.groupStageGames} canManage={canManage} canClose={canManageComp} canReopen={false} />
      )}

      {state === 'GROUPS_CLOSED' && (
        <>
          {canManageComp && (
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <EnterPlayoffsButton seasonId={view.id} />
              <span className="text-sm text-muted-foreground">Groups are closed — advance to playoff selection, or reopen below to edit results.</span>
            </div>
          )}
          <SeasonGroupStage seasonId={view.id} groups={await getSeasonGroupStage(view.id)} groupStageGames={view.format.groupStageGames} canManage={false} canClose={false} canReopen={canManageComp} />
        </>
      )}

      {state === 'PLAYOFF_SETUP' && (
        canManageComp
          ? <SeasonPlayoffs seasonId={view.id} phase="setup" seeding={await loadSeasonSeeding(view.id)} rounds={await seasonPlayoffRounds(view.id)} doubleElim={await playoffTypeOf(view.id)} hasDraft={(await prisma.seasonPlayoffMatch.count({ where: { seasonId: view.id } })) > 0} canManage canClose={false} />
          : <><Info>Group stage complete — the playoff field is being finalized.</Info><SeasonGroupStage seasonId={view.id} groups={await getSeasonGroupStage(view.id)} groupStageGames={view.format.groupStageGames} canManage={false} canClose={false} canReopen={false} /></>
      )}

      {state === 'PLAYOFFS_LIVE' && (
        <SeasonPlayoffs seasonId={view.id} phase="live" seeding={[]} rounds={await seasonPlayoffRounds(view.id)} doubleElim={false} hasDraft canManage={canManage} canClose={canManageComp && !!(await seasonChampion(view.id))} />
      )}

      {state === 'COMPLETED' && <CompletedView view={view} rounds={await seasonPlayoffRounds(view.id)} groups={await getSeasonGroupStage(view.id)} />}
    </Container>
  )
}

async function playoffTypeOf(seasonId: number): Promise<boolean> {
  const s = await prisma.season.findUnique({ where: { id: seasonId }, select: { playoffDoubleElim: true } })
  return s?.playoffDoubleElim ?? false
}

function SeasonHeader({ view, canManage, number }: { view: Awaited<ReturnType<typeof getSeasonView>>; canManage: boolean; number: number }) {
  if (!view) return null
  return (
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
  )
}

function Info({ children }: { children: React.ReactNode }) {
  return <div className="mt-8 rounded-lg border border-border bg-card/40 p-6 text-sm text-muted-foreground">{children}</div>
}

function CompletedView({ view, rounds, groups }: { view: NonNullable<Awaited<ReturnType<typeof getSeasonView>>>; rounds: Awaited<ReturnType<typeof seasonPlayoffRounds>>; groups: Awaited<ReturnType<typeof getSeasonGroupStage>> }) {
  return (
    <div className="mt-8 space-y-8">
      <div className="rounded-xl border border-[#8a6d24] bg-[#0c0c0d] p-6 text-center">
        <p className="flex items-center justify-center gap-2 text-[0.65rem] font-bold uppercase tracking-[0.2em] text-[#d6ae42]"><Diamond className="size-4 fill-[#e6c463] text-[#e6c463] drop-shadow-[0_0_6px_rgba(230,196,99,0.9)]" /> Season Champion</p>
        <p className="mt-3 font-display text-4xl font-bold text-[#f5f1e6]">{view.championName ?? '—'}</p>
        {view.runnerUpName && <p className="mt-1 text-sm text-muted-foreground">def. {view.runnerUpName}{view.finalScore ? ` · ${view.finalScore}` : ''}</p>}
      </div>
      {rounds.length > 0 && <div><h2 className="mb-4 font-display text-lg font-bold text-foreground">Playoff Bracket</h2><div className="w-full"><Bracket rounds={rounds} fluid /></div></div>}
      {groups.length > 0 && (
        <div>
          <h2 className="mb-4 font-display text-lg font-bold text-foreground">Final Group Standings</h2>
          <SeasonGroupStage seasonId={view.id} groups={groups} groupStageGames={view.format.groupStageGames} canManage={false} canClose={false} canReopen={false} />
        </div>
      )}
    </div>
  )
}
