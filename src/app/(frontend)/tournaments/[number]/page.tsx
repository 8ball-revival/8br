import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import Link from 'next/link'
import { ArrowLeft, Trophy } from 'lucide-react'

import { Container } from '@/components/ui/container'
import { Badge } from '@/components/ui/badge'
import { PlayerAvatar } from '@/components/primitives'
import { Bracket } from '@/components/tournaments/bracket'
import { CupWorkspace } from '@/components/tournaments/tournament-workspace'
import { getCup, cupBracket } from '@/lib/tournaments/service'
import { cupStore, loadCupContext } from '@/lib/tournaments/prime'
import { getCupWorkspace, type CupWorkspaceData } from '@/lib/tournaments/live'
import { CUP_STATE_LABEL, getCupHistory, type CupHistoryEvent } from '@/lib/competition/tournament-lifecycle'
import { CupHistory } from '@/components/tournaments/tournament-history'
import { CupWinnerSummary, type PodiumIdentity } from '@/components/tournaments/tournament-winner-summary'
import { CupReportLoss } from '@/components/tournaments/tournament-report-loss'
import { resolveStaffAccess } from '@/lib/competition/staff-auth'
import { getCurrentUser } from '@/lib/account/auth'
import { getProfileByUserId } from '@/lib/players/service'
import { getUserRegistration } from '@/lib/competition/queries'
import { profileCompleteness } from '@/lib/competition/eligibility'
import { EntrantList } from '@/components/competition/entrant-list'
import { CupJoinPanel } from '@/components/tournaments/tournament-join-panel'
import type { SignupIdentity } from '@/components/account/register-form'

// Cup pages always resolve the signed-in viewer (admin workspace vs public view) via headers/cookies,
// so they must render per-request. force-dynamic replaces the old generateStaticParams/dynamicParams
// (which conflicted with the auth read and caused DYNAMIC_SERVER_USAGE 500s).
export const dynamic = 'force-dynamic'

/** The signed-in viewer's context for the member Join / entrant panel on a live cup. */
interface MemberCtx {
  number: number
  isLoggedIn: boolean
  myStatus: 'PENDING' | 'APPROVED' | 'WITHDRAWN' | 'REJECTED' | null
  identity: SignupIdentity | null
  missing: string[]
  /** The viewer's registration id in this tournament (to locate their own active match for self-report). */
  myRegistrationId: number | null
}

export async function generateMetadata({ params }: { params: Promise<{ number: string }> }): Promise<Metadata> {
  const { number } = await params
  const cup = getCup(Number(number))
  const title = cup ? `${cup.name} — Tournament ${cup.number}` : `Cup ${number}`
  return { title, alternates: { canonical: `/tournaments/${number}` } }
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
        <span className="eyebrow text-muted-foreground">Tournament {number}</span>
        {badge && <Badge variant="default">{badge}</Badge>}
        {live ? <Badge variant="destructive">{statusLabel}</Badge> : <Badge variant="muted">{statusLabel}</Badge>}
        {year && <span className="tabular text-sm text-muted-foreground">{year}</span>}
      </div>
      <h1 className="mt-2 font-display text-3xl font-bold tracking-tight sm:text-4xl">{name}</h1>
    </>
  )
}

/** Resolve a registrationId to its current public identity from the tournament's entrant list. */
function entrantIdentity(data: CupWorkspaceData, regId: number | null, fallbackName: string | null): PodiumIdentity | null {
  if (regId == null && !fallbackName) return null
  const e = regId != null ? data.entrants.find((x) => x.registrationId === regId) : undefined
  return {
    name: e?.name ?? fallbackName ?? 'Unknown',
    cueverseId: e?.handle ?? null,
    slug: e?.slug ?? null,
  }
}

/**
 * Champion / runner-up / final score for a COMPLETED cup, resolved from the stored playoff rows
 * (registration ids → current identities). Returns null if the Final has no confirmed winner, and
 * never fabricates a runner-up or score that isn't recorded.
 */
function resolvePodium(data: CupWorkspaceData): { champion: PodiumIdentity; runnerUp: PodiumIdentity | null; finalScore: string | null } | null {
  if (data.matches.length === 0) return null
  const maxRound = Math.max(...data.matches.map((m) => m.round))
  const finals = data.matches.filter((m) => m.round === maxRound).sort((a, b) => a.slot - b.slot)
  const finalMatch = finals.find((m) => m.winnerRegistrationId != null) ?? null
  if (!finalMatch || finalMatch.winnerRegistrationId == null) return null
  const champIsHome = finalMatch.winnerRegistrationId === finalMatch.homeRegistrationId
  const champId = champIsHome ? finalMatch.homeRegistrationId : finalMatch.awayRegistrationId
  const runnerId = champIsHome ? finalMatch.awayRegistrationId : finalMatch.homeRegistrationId
  const champion = entrantIdentity(data, champId, champIsHome ? finalMatch.homeUsername : finalMatch.awayUsername)
  if (!champion) return null
  const runnerUp = entrantIdentity(data, runnerId, champIsHome ? finalMatch.awayUsername : finalMatch.homeUsername)
  const champGames = champIsHome ? finalMatch.homeGames : finalMatch.awayGames
  const loseGames = champIsHome ? finalMatch.awayGames : finalMatch.homeGames
  const finalScore = champGames != null && loseGames != null ? `${champGames}–${loseGames}` : null
  return { champion, runnerUp, finalScore }
}

/** The viewer's own unresolved, playable (non-bye) match in an in-progress cup, if any. */
function findMyActiveMatch(data: CupWorkspaceData, myRegId: number | null): { matchId: number; opponentName: string; matchLabel: string } | null {
  if (myRegId == null) return null
  const m = data.matches.find(
    (x) => x.winnerRegistrationId == null && x.homeRegistrationId != null && x.awayRegistrationId != null && (x.homeRegistrationId === myRegId || x.awayRegistrationId === myRegId),
  )
  if (!m) return null
  const iAmHome = m.homeRegistrationId === myRegId
  const oppId = iAmHome ? m.awayRegistrationId : m.homeRegistrationId
  const opp = entrantIdentity(data, oppId, iAmHome ? m.awayUsername : m.homeUsername)
  return { matchId: m.id, opponentName: opp?.name ?? 'your opponent', matchLabel: m.label ?? `Round ${m.round}` }
}

/**
 * Public (member) view of a LIVE cup — driven entirely by the explicit lifecycle state:
 *  DRAFT               → not publicly joinable
 *  REGISTRATION_OPEN   → entrant list + join/withdraw controls
 *  REGISTRATION_CLOSED → entrant list + "Registration Closed"; join/withdraw hidden
 *  BRACKET_GENERATED   → bracket is the primary focus + "Awaiting Tournament Start"; entrants/join/report hidden
 *  IN_PROGRESS         → bracket primary + player self-report control; entrants/join hidden
 *  COMPLETED           → winner summary + read-only bracket; CANCELLED → cancelled notice
 */
function PublicLiveCup({ data, member, history }: { data: CupWorkspaceData; member: MemberCtx; history: CupHistoryEvent[] }) {
  const state = data.tournament.lifecycleState
  const activeEntrants = data.entrants.filter((e) => !e.withdrawn)
  const inRegistration = state === 'REGISTRATION_OPEN' || state === 'REGISTRATION_CLOSED'
  const bracketPrimary = state === 'BRACKET_GENERATED' || state === 'IN_PROGRESS' || state === 'COMPLETED'
  const podium = state === 'COMPLETED' ? resolvePodium(data) : null
  const myMatch = state === 'IN_PROGRESS' ? findMyActiveMatch(data, member.myRegistrationId) : null
  const completedAt = history.find((e) => e.kind === 'tournament_completed')?.at ?? null
  const completedDate = completedAt ? completedAt.slice(0, 10) : null

  if (state === 'DRAFT') {
    return (
      <p className="mt-8 rounded-lg border border-dashed border-border bg-card/30 px-4 py-10 text-center text-sm text-muted-foreground">
        This cup isn&apos;t open for registration yet. Check back soon.
      </p>
    )
  }
  if (state === 'CANCELLED') {
    return (
      <p className="mt-8 rounded-lg border border-dashed border-border bg-card/30 px-4 py-10 text-center text-sm text-muted-foreground">
        This cup was cancelled.
      </p>
    )
  }

  return (
    <>
      {/* Completed: prominent winner summary above the read-only bracket. */}
      {podium && (
        <CupWinnerSummary
          cupName={data.tournament.name}
          champion={podium.champion}
          runnerUp={podium.runnerUp}
          finalScore={podium.finalScore}
          completedAt={completedDate}
        />
      )}

      {/* Bracket-generated: the bracket is visible but the tournament has NOT begun. */}
      {state === 'BRACKET_GENERATED' && (
        <div className="mt-6 rounded-lg border border-sky-500/30 bg-sky-500/[0.06] px-4 py-3">
          <Badge variant="muted">Awaiting Tournament Start</Badge>
          <span className="ml-2 text-sm text-muted-foreground">
            The bracket has been generated and is under review. The tournament hasn&apos;t started yet — results can&apos;t be reported until it begins.
          </span>
        </div>
      )}

      {/* In progress: the viewer's own match self-report control (loss only). */}
      {myMatch && (
        <div className="mt-6">
          <CupReportLoss matchId={myMatch.matchId} opponentName={myMatch.opponentName} matchLabel={myMatch.matchLabel} raceLength={data.tournament.raceLength} />
        </div>
      )}

      {/* Bracket is the primary focus once generated, underway, or complete. */}
      {bracketPrimary && (
        <section className="mt-8">
          <h2 className="eyebrow mb-4 text-foreground">Bracket</h2>
          {data.bracketRounds.length > 0 ? (
            <Bracket rounds={data.bracketRounds} />
          ) : (
            <p className="text-sm text-muted-foreground">The bracket is being prepared.</p>
          )}
        </section>
      )}

      {/* Registration phases: entrant list + (open only) join/withdraw. */}
      {inRegistration && (
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

          {!data.isTeam && (
            <div className="mt-8">
              {state === 'REGISTRATION_CLOSED' && (
                <div className="mb-3">
                  <Badge variant="muted">Registration Closed</Badge>
                  <span className="ml-2 text-xs text-muted-foreground">The field is set — waiting for the bracket to be generated.</span>
                </div>
              )}
              {activeEntrants.length > 0 ? (
                <EntrantList entrants={activeEntrants.map((e) => ({ name: e.name, cueverseId: e.handle, slug: e.slug }))} label="Entrants" />
              ) : (
                <p className="text-sm text-muted-foreground">No entrants yet{state === 'REGISTRATION_OPEN' ? ' — be the first to join.' : '.'}</p>
              )}
            </div>
          )}

          {!data.isTeam && (
            <CupJoinPanel
              number={member.number}
              isLoggedIn={member.isLoggedIn}
              registrationOpen={state === 'REGISTRATION_OPEN'}
              myStatus={member.myStatus}
              identity={member.identity}
              missing={member.missing}
            />
          )}
        </>
      )}

      {/* Chronological tournament history (public, non-sensitive events only). */}
      {history.length > 0 && (
        <section className="mt-10">
          <h2 className="eyebrow mb-4 text-foreground">History</h2>
          <CupHistory events={history} />
        </section>
      )}
    </>
  )
}

export default async function CupDetailPage({ params }: { params: Promise<{ number: string }> }) {
  cupStore.enterWith(await loadCupContext()) // resolve the live Cup revision before rendering the tournament
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
    <Link href="/tournaments" className="mb-6 inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground">
      <ArrowLeft className="size-4" /> Tournaments
    </Link>
  )

  // ---- LIVE editable cup: the Cup page IS the management interface ----
  if (ws && ws.isEditable) {
    // Header status reflects the explicit lifecycle state; "live" (red) only while active.
    const statusLabel = CUP_STATE_LABEL[ws.tournament.lifecycleState as keyof typeof CUP_STATE_LABEL] ?? ws.tournament.lifecycleState
    const live = ws.tournament.lifecycleState !== 'COMPLETED' && ws.tournament.lifecycleState !== 'CANCELLED' && ws.tournament.lifecycleState !== 'DRAFT'

    // Member view context (only needed when the viewer is not managing): are they signed in,
    // already entered, and is their identity linked to a profile.
    let publicView: ReactNode = null
    if (!canManage) {
      const user = await getCurrentUser()
      const profile = user ? await getProfileByUserId(Number(user.id)) : null
      const myReg = user ? await getUserRegistration(ws.tournament.id, Number(user.id)) : null
      const member: MemberCtx = {
        number: num,
        isLoggedIn: !!user,
        myStatus: (myReg?.status as MemberCtx['myStatus']) ?? null,
        identity: profile
          ? { preferredName: profile.primaryName, cueverseId: profile.cueverseId, discord: profile.discord, timeZone: profile.timeZone }
          : null,
        missing: profile ? profileCompleteness(profile).missing : ['your player profile'],
        myRegistrationId: myReg?.id ?? null,
      }
      const history = await getCupHistory(ws.tournament.id, { admin: false })
      publicView = <PublicLiveCup data={ws} member={member} history={history} />
    }

    return (
      <Container className="py-10">
        {backLink}
        <CupHeader name={ws.tournament.name} number={ws.tournament.number} badge={ws.tournament.formatBadge} statusLabel={statusLabel} live={live} />
        {canManage ? (
          <CupWorkspace data={ws} canManage={canManage} canEditResults={canEditResults} isOwner={isOwner} history={await getCupHistory(ws.tournament.id, { admin: true })} />
        ) : (
          publicView
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
        <div className="mt-4 inline-flex items-center gap-2.5 rounded-lg border border-brand/25 bg-brand/[0.06] px-4 py-2.5">
          <Trophy className="size-5 text-brand" aria-hidden />
          <PlayerAvatar name={cup.champion.name} size="sm" />
          <div>
            <p className="text-sm font-semibold text-foreground">
              {cup.champion.name}
              {cup.finalScore && <span className="ml-2 tabular text-xs font-normal text-muted-foreground">{cup.finalScore}</span>}
            </p>
            {cup.champion.handle && <p className="text-xs text-muted-foreground">{cup.champion.handle}</p>}
          </div>
          <span className="eyebrow ml-2 text-[0.55rem] text-brand">Champion</span>
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

      {canManage && ws && (
        <CupWorkspace data={ws} canManage={canManage} canEditResults={canEditResults} isOwner={isOwner} history={await getCupHistory(ws.tournament.id, { admin: true })} />
      )}
    </Container>
  )
}
