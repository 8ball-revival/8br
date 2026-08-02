import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowLeft, Trophy } from 'lucide-react'

import { Container } from '@/components/ui/container'
import { Badge } from '@/components/ui/badge'
import { PlayerAvatar } from '@/components/home/primitives'
import { Bracket } from '@/components/cups/bracket'
import { TeamTies } from '@/components/cups/team-ties'
import { CupWorkspace } from '@/components/cups/cup-workspace'
import { ConvertLegacyBanner } from '@/components/cups/convert-legacy-banner'
import { getCup, getCups, cupBracket } from '@/lib/cups/service'
import { cupStore, loadCupContext } from '@/lib/cups/prime'
import { getCupWorkspace, type CupWorkspaceData } from '@/lib/cups/live'
import { resolveStaffAccess } from '@/lib/competition/staff-auth'

// Live cups may be created after the build snapshot, so render unknown numbers on demand
// (the page 404s below if neither the snapshot nor the DB has the cup).
export const dynamicParams = true

export function generateStaticParams() {
  return getCups().map((c) => ({ number: String(c.number) }))
}

export async function generateMetadata({ params }: { params: Promise<{ number: string }> }): Promise<Metadata> {
  const { number } = await params
  const cup = getCup(Number(number))
  const title = cup ? `${cup.name} — Cup ${cup.number}` : `Cup ${number}`
  return { title, alternates: { canonical: `/cups/${number}` } }
}

function CupHeader({
  name,
  number,
  badge,
  statusLabel,
  live,
  year,
}: {
  name: string
  number: number | null
  badge: string | null
  statusLabel: string
  live: boolean
  year?: number | null
}) {
  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <span className="eyebrow text-muted-foreground">Cup {number}</span>
        {badge && <Badge variant="gold">{badge}</Badge>}
        {live ? <Badge variant="destructive">{statusLabel}</Badge> : <Badge variant="muted">{statusLabel}</Badge>}
        {year && <span className="tabular text-sm text-muted-foreground">{year}</span>}
      </div>
      <h1 className="mt-2 font-display text-3xl font-bold tracking-tight sm:text-4xl">{name}</h1>
    </>
  )
}

/** Public (member) view of a LIVE cup: published bracket + team rosters. */
function PublicLiveCup({ data }: { data: CupWorkspaceData }) {
  return (
    <>
      {data.isTeam && data.teams.filter((t) => !t.withdrawn).length > 0 && (
        <section className="mt-8">
          <h2 className="eyebrow mb-4 text-foreground">Teams</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {data.teams.filter((t) => !t.withdrawn).map((t) => (
              <div key={t.id} className="rounded-lg border border-border bg-card/40 p-3">
                <p className="text-sm font-semibold text-foreground">{t.name}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{t.members.map((m) => m.name).join(' + ') || 'Roster TBD'}</p>
              </div>
            ))}
          </div>
        </section>
      )}
      <section className="mt-8">
        <h2 className="eyebrow mb-4 text-foreground">Bracket</h2>
        {data.hasPublishedBracket && data.bracketRounds.length > 0 ? (
          <Bracket rounds={data.bracketRounds} />
        ) : (
          <p className="text-sm text-muted-foreground">The bracket has not been published yet.</p>
        )}
      </section>
    </>
  )
}

export default async function CupDetailPage({ params }: { params: Promise<{ number: string }> }) {
  cupStore.enterWith(await loadCupContext()) // resolve the live Cup revision before rendering the cup
  const { number } = await params
  const num = Number(number)

  const access = await resolveStaffAccess()
  const isStaffOk = access.status === 'ok'
  const canManage = isStaffOk && access.actor.can('manage_competitions')
  const canEditResults = isStaffOk && access.actor.can('edit_results')
  const isOwner = isStaffOk && access.actor.isOwner

  const ws = await getCupWorkspace(num)
  const cup = getCup(num)
  if (!ws && !cup) return null // dynamicParams=true → unknown numbers 404 here

  const backLink = (
    <Link href="/cups" className="mb-6 inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground">
      <ArrowLeft className="size-4" /> Cups
    </Link>
  )

  // ---- LIVE editable cup: the Cup page IS the management interface ----
  if (ws && ws.isEditable) {
    const live = ws.season.cupStatus !== 'completed'
    const statusLabel = ws.season.seasonStatus === 'COMPLETED' ? 'Completed' : live ? 'Live' : 'Completed'
    return (
      <Container className="py-10">
        {backLink}
        <CupHeader name={ws.season.name} number={ws.season.cupNumber} badge={ws.season.formatBadge} statusLabel={statusLabel} live={live} />
        {canManage ? (
          <CupWorkspace data={ws} canManage={canManage} canEditResults={canEditResults} isOwner={isOwner} />
        ) : (
          <PublicLiveCup data={ws} />
        )}
      </Container>
    )
  }

  // ---- Historical / imported cup: existing snapshot render (+ admin workspace for Settings/unlock) ----
  if (!cup) return null
  const live = cup.status === 'live'
  const isDoubleElim = !!cup.winnersBracket?.length
  const rounds = isDoubleElim ? null : cupBracket(cup)
  const shellOnly = !cup.bracket?.length

  return (
    <Container className="py-10">
      {backLink}
      <CupHeader
        name={cup.name}
        number={cup.number}
        badge={cup.format}
        statusLabel={live ? `Live · ${cup.currentRound ?? 'In progress'}` : 'Completed'}
        live={live}
        year={cup.year}
      />

      {cup.champion && !live && (
        <div className="mt-4 inline-flex items-center gap-2.5 rounded-lg border border-gold/25 bg-gold/[0.06] px-4 py-2.5">
          <Trophy className="size-5 text-gold" aria-hidden />
          <PlayerAvatar name={cup.champion.name} size="sm" />
          <div>
            <p className="text-sm font-semibold text-foreground">
              {cup.champion.name}
              {cup.finalScore && <span className="ml-2 tabular text-xs font-normal text-muted-foreground">{cup.finalScore}</span>}
            </p>
            {cup.champion.handle && <p className="text-xs text-muted-foreground">{cup.champion.handle}</p>}
          </div>
          <span className="eyebrow ml-2 text-[0.55rem] text-gold">Champion</span>
        </div>
      )}

      {!live && (cup.runnerUp || cup.thirdPlace) && (
        <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm">
          {cup.runnerUp && (
            <p className="text-muted-foreground">
              <span className="font-medium text-foreground">Runner-up:</span> {cup.runnerUp.name}
              {cup.runnerUp.handle && cup.runnerUp.handle !== cup.runnerUp.name && <span className="ml-1 text-xs">({cup.runnerUp.handle})</span>}
            </p>
          )}
          {cup.thirdPlace && (
            <p className="text-muted-foreground">
              <span className="font-medium text-foreground">Third:</span> {cup.thirdPlace.name}
              {cup.thirdPlace.handle && cup.thirdPlace.handle !== cup.thirdPlace.name && <span className="ml-1 text-xs">({cup.thirdPlace.handle})</span>}
            </p>
          )}
        </div>
      )}

      {isDoubleElim ? (
        <>
          <section className="mt-8">
            <h2 className="eyebrow mb-4 text-foreground">Winners Bracket</h2>
            <Bracket rounds={cup.winnersBracket!} />
          </section>
          <section className="mt-8">
            <h2 className="eyebrow mb-4 text-foreground">Losers Bracket</h2>
            <Bracket rounds={cup.losersBracket ?? []} />
          </section>
          {cup.grandFinal && cup.grandFinal.length > 0 && (
            <section className="mt-8">
              <h2 className="eyebrow mb-4 text-foreground">Grand Final</h2>
              <Bracket rounds={cup.grandFinal} />
            </section>
          )}
        </>
      ) : (
        <section className="mt-8">
          <h2 className="eyebrow mb-4 text-foreground">Bracket</h2>
          {rounds ? (
            <>
              <Bracket rounds={rounds} currentRound={cup.currentRound} />
              {shellOnly && (
                <p className="mt-3 text-xs text-muted-foreground">
                  Bracket layout ({cup.entrants} entrants) — matchups and scores will populate as results are added.
                </p>
              )}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              Bracket not on record yet{cup.champion ? ` — ${cup.name} was won by ${cup.champion.name}.` : '.'}
            </p>
          )}
        </section>
      )}

      {cup.teamTies && cup.teamTies.length > 0 && (
        <section className="mt-10">
          <h2 className="eyebrow mb-4 text-foreground">Match Results</h2>
          <TeamTies ties={cup.teamTies} />
        </section>
      )}

      {canManage && ws && ws.isLegacyConvertible && (
        <ConvertLegacyBanner seasonId={ws.season.id} />
      )}
      {canManage && ws && !ws.isLegacyConvertible && (
        <CupWorkspace data={ws} canManage={canManage} canEditResults={canEditResults} isOwner={isOwner} />
      )}
    </Container>
  )
}
