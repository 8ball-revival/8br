import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import Link from 'next/link'
import { ArrowLeft, Trophy } from 'lucide-react'

import { Container } from '@/components/ui/container'
import { Badge } from '@/components/ui/badge'
import { PlayerAvatar } from '@/components/primitives'
import { Bracket } from '@/components/tournaments/bracket'
import { PlayoffDisclaimer } from '@/components/competition/playoff-disclaimer'
import { identityLines, identityText, fromNameHandle } from '@/lib/identity/display'
import { GroupCrosstable } from '@/components/tournaments/group-crosstable'
import { ViewToggle } from '@/components/tournaments/view-toggle'
import { canViewPlayoffs, redactPlayoffs, redactDraftGroups } from '@/lib/competition/playoff-visibility'
import { computeBracketShape, playoffRaceLength } from '@/lib/competition/match-format'
import { getTournament, tournamentBracket } from '@/lib/tournaments/service'
import { tournamentStore, loadTournamentContext } from '@/lib/tournaments/prime'
import { getTournamentWorkspace, type TournamentWorkspaceData } from '@/lib/tournaments/live'
import { TOURNAMENT_STATE_LABEL, getTournamentHistory, type TournamentHistoryEvent } from '@/lib/competition/tournament-lifecycle'
import { TournamentHistory } from '@/components/tournaments/tournament-history'
import { TournamentWinnerSummary, type PodiumIdentity } from '@/components/tournaments/tournament-winner-summary'
import { TournamentReportLoss } from '@/components/tournaments/tournament-report-loss'
import { resolveStaffAccess } from '@/lib/competition/staff-auth'
import { getCurrentUser } from '@/lib/account/auth'
import { getProfileByUserId } from '@/lib/players/service'
import { getUserRegistration } from '@/lib/competition/queries'
import { profileCompleteness } from '@/lib/competition/eligibility'
import { EntrantList } from '@/components/competition/entrant-list'
import { TournamentJoinPanel } from '@/components/tournaments/tournament-join-panel'
import { TournamentTeamRegister, type MyTeamView, type JoinableTeamView } from '@/components/tournaments/tournament-team-register'
import { getMyTeamMembership, listJoinableTeams } from '@/lib/competition/teams'
import { getMyFreeAgent } from '@/lib/competition/free-agents'
import { badgeByKey } from '@/lib/competition/flair'
import type { SignupIdentity } from '@/components/account/register-form'

// TournamentView pages always resolve the signed-in viewer (admin workspace vs public view) via headers/cookies,
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
  /** PICK-team only: the viewer's own team membership + the teams they could join. */
  membership: MyTeamView | null
  freeAgent: boolean
  joinableTeams: JoinableTeamView[]
  currentUserId: number | null
}

export async function generateMetadata({ params }: { params: Promise<{ number: string }> }): Promise<Metadata> {
  const { number } = await params
  const cup = getTournament(Number(number))
  const title = cup ? `${cup.name} — Tournament ${cup.number}` : `Tournament ${number}`
  return { title, alternates: { canonical: `/tournaments/${number}` } }
}

function TournamentHeader({
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
function entrantIdentity(data: TournamentWorkspaceData, regId: number | null, fallbackName: string | null): PodiumIdentity | null {
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
function resolvePodium(data: TournamentWorkspaceData): { champion: PodiumIdentity; runnerUp: PodiumIdentity | null; finalScore: string | null } | null {
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
function findMyActiveMatch(data: TournamentWorkspaceData, myRegId: number | null): { matchId: number; opponentName: string; matchLabel: string; raceLength: number } | null {
  if (myRegId == null) return null
  const m = data.matches.find(
    (x) => x.winnerRegistrationId == null && x.homeRegistrationId != null && x.awayRegistrationId != null && (x.homeRegistrationId === myRegId || x.awayRegistrationId === myRegId),
  )
  if (!m) return null
  const iAmHome = m.homeRegistrationId === myRegId
  const oppId = iAmHome ? m.awayRegistrationId : m.homeRegistrationId
  const opp = entrantIdentity(data, oppId, iAmHome ? m.awayUsername : m.homeUsername)
  // Group Stage + Playoffs playoff matches use a hard-coded per-stage race length; other formats use
  // the tournament's configured race length.
  const raceLength = data.tournament.tournamentFormat === 'GROUPS_PLAYOFFS'
    ? playoffRaceLength({ round: m.round, section: m.section }, computeBracketShape(data.matches))
    : data.tournament.raceLength
  return { matchId: m.id, opponentName: opp?.name ?? 'your opponent', matchLabel: m.label ?? `Round ${m.round}`, raceLength }
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
/** Read-only group-stage view for members: a head-to-head crosstable per group (see GroupCrosstable).
 *  `heading` is suppressed when the groups sit under the Groups|Playoffs toggle (the tab already labels it). */
function GroupStagePublic({ data, heading = true }: { data: TournamentWorkspaceData; heading?: boolean }) {
  // Draft groups are private: members only learn that registration is closed and groups are being set up.
  if (!data.groupsPublished || data.groups.length === 0) {
    return (
      <div className={heading ? 'mt-8' : ''}>
        {heading && <h2 className="eyebrow mb-4 text-foreground">Group Stage</h2>}
        <div className="rounded-lg border border-border bg-card/40 p-6 text-center">
          <p className="text-sm font-medium text-foreground">Registration is closed — the groups are being prepared.</p>
          <p className="mt-1 text-sm text-muted-foreground">Group assignments will appear here once they&apos;re published.</p>
        </div>
      </div>
    )
  }
  return (
    <div className={heading ? 'mt-8' : ''}>
      {heading && <h2 className="eyebrow mb-4 text-foreground">Group Stage</h2>}
      <div className="space-y-6">
        {data.groups.map((g) => (
          <GroupCrosstable key={g.id} group={g} qualifiersPerGroup={data.tournament.qualifiersPerGroup} />
        ))}
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        Each cell is the row player&apos;s result against the column player (their games first). Hover or focus a score to
        highlight the matchup; click it for details. Names link to profiles; the Discord icon opens a DM.
      </p>
    </div>
  )
}

function PublicLiveTournament({ data, member, history, view, playoffsPublished }: { data: TournamentWorkspaceData; member: MemberCtx; history: TournamentHistoryEvent[]; view: 'groups' | 'playoffs'; playoffsPublished: boolean }) {
  const state = data.tournament.lifecycleState
  const activeEntrants = data.entrants.filter((e) => !e.withdrawn)
  const inRegistration = state === 'REGISTRATION_OPEN' || state === 'REGISTRATION_CLOSED'
  const podium = state === 'COMPLETED' ? resolvePodium(data) : null
  const myMatch = state === 'IN_PROGRESS' ? findMyActiveMatch(data, member.myRegistrationId) : null
  const completedAt = history.find((e) => e.kind === 'tournament_completed')?.at ?? null
  const completedDate = completedAt ? completedAt.slice(0, 10) : null

  // `data.bracketRounds` is already redacted server-side to [] for viewers not allowed to see the
  // bracket, so `bracketVisible` doubles as "this viewer may see the playoffs".
  const isGroups = data.isGroupStage
  const hasGroups = data.groups.length > 0
  const bracketVisible = data.bracketRounds.length > 0
  const showToggle = isGroups && hasGroups && playoffsPublished && bracketVisible
  const effectiveView: 'groups' | 'playoffs' = showToggle ? view : 'groups'

  if (state === 'DRAFT') {
    return (
      <p className="mt-8 rounded-lg border border-dashed border-border bg-card/30 px-4 py-10 text-center text-sm text-muted-foreground">
        This tournament isn&apos;t open for registration yet. Check back soon.
      </p>
    )
  }
  if (state === 'CANCELLED') {
    return (
      <p className="mt-8 rounded-lg border border-dashed border-border bg-card/30 px-4 py-10 text-center text-sm text-muted-foreground">
        This tournament was cancelled.
      </p>
    )
  }

  return (
    <>
      {/* Completed: prominent winner summary above the read-only bracket. */}
      {podium && (
        <TournamentWinnerSummary
          cupName={data.tournament.name}
          champion={podium.champion}
          runnerUp={podium.runnerUp}
          finalScore={podium.finalScore}
          completedAt={completedDate}
        />
      )}

      {/* GROUP STAGE + PLAYOFFS: groups are public throughout; the playoff bracket is hidden until it
          is PUBLISHED. Once published, a Groups | Playoffs toggle appears (Playoffs is the default).
          Playoff data is redacted server-side for viewers who may not see it → bracketVisible is false. */}
      {isGroups && hasGroups && (
        <section className="mt-8">
          {showToggle && <div className="mb-5"><ViewToggle number={member.number} active={effectiveView} /></div>}
          {effectiveView === 'playoffs' && bracketVisible ? (
            <div id="panel-playoffs" role={showToggle ? 'tabpanel' : undefined} aria-labelledby={showToggle ? 'tab-playoffs' : undefined}>
              {state === 'BRACKET_GENERATED' && (
                <p className="mb-4 text-sm text-muted-foreground"><Badge variant="muted">Awaiting Start</Badge> <span className="ml-1">The bracket is published; play begins soon.</span></p>
              )}
              {myMatch && <div className="mb-6"><TournamentReportLoss matchId={myMatch.matchId} opponentName={myMatch.opponentName} matchLabel={myMatch.matchLabel} raceLength={myMatch.raceLength} /></div>}
              <Bracket rounds={data.bracketRounds} fluid />
              <PlayoffDisclaimer kind="tournament" id={data.tournament.id} value={data.tournament.playoffDisclaimer} canManage={false} />
            </div>
          ) : (
            <div id="panel-groups" role={showToggle ? 'tabpanel' : undefined} aria-labelledby={showToggle ? 'tab-groups' : undefined}>
              <GroupStagePublic data={data} heading={!showToggle} />
            </div>
          )}
        </section>
      )}

      {/* NON-group formats: the bracket shows only once it is visible (published) to this viewer. */}
      {!isGroups && bracketVisible && (
        <>
          {state === 'BRACKET_GENERATED' && (
            <div className="mt-6 rounded-lg border border-sky-500/30 bg-sky-500/[0.06] px-4 py-3">
              <Badge variant="muted">Awaiting Tournament Start</Badge>
              <span className="ml-2 text-sm text-muted-foreground">The bracket is published and under review — results can&apos;t be reported until play begins.</span>
            </div>
          )}
          {myMatch && (
            <div className="mt-6">
              <TournamentReportLoss matchId={myMatch.matchId} opponentName={myMatch.opponentName} matchLabel={myMatch.matchLabel} raceLength={myMatch.raceLength} />
            </div>
          )}
          <section className="mt-8">
            <h2 className="eyebrow mb-4 text-foreground">Bracket</h2>
            <Bracket rounds={data.bracketRounds} />
            <PlayoffDisclaimer kind="tournament" id={data.tournament.id} value={data.tournament.playoffDisclaimer} canManage={false} />
          </section>
        </>
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

          {/* Individual entrant list — for 1v1 tournaments and for RANDOM-draw teams (players register
              solo and are shown as a flat list; the teams are drawn later at registration close). */}
          {(!data.isTeam || data.isRandomTeam) && (
            <div className="mt-8">
              {state === 'REGISTRATION_CLOSED' && (
                <div className="mb-3">
                  <Badge variant="muted">Registration Closed</Badge>
                  <span className="ml-2 text-xs text-muted-foreground">
                    {data.isRandomTeam ? 'The field is set — waiting for the random teams to be drawn.' : 'The field is set — waiting for the bracket to be generated.'}
                  </span>
                </div>
              )}
              {activeEntrants.length > 0 ? (
                <EntrantList entrants={activeEntrants.map((e) => ({ name: e.name, cueverseId: e.handle, slug: e.slug, rating: e.rating }))} label="Entrants" />
              ) : (
                <p className="text-sm text-muted-foreground">No entrants yet{state === 'REGISTRATION_OPEN' ? ' — be the first to join.' : '.'}</p>
              )}
            </div>
          )}

          {/* Individual 1v1 AND random-draw teams register individually (teams are drawn later). */}
          {(!data.isTeam || data.tournament.teamFormation === 'RANDOM') && (
            <TournamentJoinPanel
              number={member.number}
              isLoggedIn={member.isLoggedIn}
              registrationOpen={state === 'REGISTRATION_OPEN'}
              myStatus={member.myStatus}
              identity={member.identity}
              missing={member.missing}
              requiresPassword={data.tournament.requiresJoinPassword}
            />
          )}

          {/* Pick-your-own team tournaments use the create-then-join flow. */}
          {data.isTeam && data.tournament.teamFormation === 'PICK' && (
            <TournamentTeamRegister
              number={member.number}
              isLoggedIn={member.isLoggedIn}
              registrationOpen={state === 'REGISTRATION_OPEN'}
              identity={member.identity}
              missing={member.missing}
              membership={member.membership}
              freeAgent={member.freeAgent}
              joinableTeams={member.joinableTeams}
              currentUserId={member.currentUserId}
              requiresPassword={data.tournament.requiresJoinPassword}
            />
          )}
        </>
      )}

      {/* Chronological tournament history (public, non-sensitive events only). */}
      {history.length > 0 && (
        <section className="mt-10">
          <h2 className="eyebrow mb-4 text-foreground">History</h2>
          <TournamentHistory events={history} />
        </section>
      )}
    </>
  )
}

export default async function TournamentDetailPage({ params, searchParams }: { params: Promise<{ number: string }>; searchParams: Promise<{ view?: string }> }) {
  tournamentStore.enterWith(await loadTournamentContext()) // resolve the live TournamentView revision before rendering the tournament
  const { number } = await params
  const num = Number(number)
  const sp = await searchParams

  const access = await resolveStaffAccess()
  const isStaffOk = access.status === 'ok'
  const canManage = isStaffOk && access.actor.can('manage_competitions')

  const ws = await getTournamentWorkspace(num)
  const cup = getTournament(num)
  if (!ws && !cup) return null // dynamicParams=true → unknown numbers 404 here

  const backLink = (
    <Link href="/tournaments" className="mb-6 inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground">
      <ArrowLeft className="size-4" /> Tournaments
    </Link>
  )

  // ---- LIVE editable cup: the TournamentView page IS the management interface ----
  if (ws && ws.isEditable) {
    // Header status reflects the explicit lifecycle state; "live" (red) only while active.
    const statusLabel = TOURNAMENT_STATE_LABEL[ws.tournament.lifecycleState as keyof typeof TOURNAMENT_STATE_LABEL] ?? ws.tournament.lifecycleState
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
        membership: user && ws.isTeam && ws.tournament.teamFormation === 'PICK' ? await getMyTeamMembership(Number(user.id), ws.tournament.id) : null,
        freeAgent: user && ws.isTeam && ws.tournament.teamFormation === 'PICK' ? !!(await getMyFreeAgent(Number(user.id), ws.tournament.id)) : false,
        joinableTeams: ws.isTeam && ws.tournament.teamFormation === 'PICK' ? await listJoinableTeams(ws.tournament.id) : [],
        currentUserId: user ? Number(user.id) : null,
      }
      const history = await getTournamentHistory(ws.tournament.id, { admin: false })

      // Playoff visibility: the public may see the bracket ONLY once it is published. Strip all
      // playoff/bracket data server-side for viewers who can't see it (never sent to the client), and
      // resolve the selected view — default Playoffs after publication, and ?view=playoffs safely falls
      // back to Groups before publication so nothing is exposed via the URL.
      const playoffsPublished = ws.hasPublishedBracket
      const canView = canViewPlayoffs({ isStaff: false, playoffsPublished }) // non-staff path
      // Non-staff never see draft group assignments — only that groups are being prepared.
      const publicData = redactDraftGroups(redactPlayoffs(ws, canView))
      const requested = sp?.view === 'groups' ? 'groups' : sp?.view === 'playoffs' ? 'playoffs' : null
      let view: 'groups' | 'playoffs' = requested ?? (canView ? 'playoffs' : 'groups')
      if (view === 'playoffs' && !canView) view = 'groups'

      publicView = <PublicLiveTournament data={publicData} member={member} history={history} view={view} playoffsPublished={playoffsPublished} />
    }

    const badge = badgeByKey(ws.tournament.badge)
    // Full-width tournament view (no max-width, ~24–40px side gutters) so group tables can use nearly
    // the whole page and expand on large monitors. The global nav keeps its own width (SiteHeader).
    return (
      <div className="mx-auto w-full px-6 py-10 sm:px-8 lg:px-10">
        {backLink}
        <div className="flex items-center gap-2">
          {badge && <span className="text-2xl" aria-hidden>{badge.emoji}</span>}
          <div className="flex-1">
            <TournamentHeader name={ws.tournament.name} number={ws.tournament.number} badge={ws.tournament.formatBadge} statusLabel={statusLabel} live={live} />
          </div>
        </div>
        {ws.tournament.description && (
          <p className="mt-3 max-w-2xl whitespace-pre-wrap text-sm text-muted-foreground">{ws.tournament.description}</p>
        )}
        {/*
          The workspace has moved to Creator.
          This page used to BE the management interface for anybody with the capability: rosters,
          groups, brackets, score entry and Settings all rendered here, on a public URL, behind a
          flag on a component. Management lives at /creator/tournaments/[id] now, and everybody —
          Owner included — sees the same public view here.
        */}
        {publicView}
        {canManage && (
          <p className="mt-6 rounded-lg border border-border bg-card/40 px-4 py-3 text-sm text-muted-foreground">
            Managing this Tournament happens in{' '}
            <a href={`/creator/tournaments/${ws.tournament.id}/setup`} className="font-semibold text-brand hover:underline">
              Creator
            </a>.
          </p>
        )}
      </div>
    )
  }

  // ---- Historical / imported cup: existing snapshot render (+ admin workspace for Settings/unlock) ----
  if (!cup) return null
  const live = cup.status === 'live'
  const isDoubleElim = !!cup.winnersBracket?.length
  const rounds = isDoubleElim ? null : tournamentBracket(cup)
  const shellOnly = !cup.bracket?.length

  return (
    <Container className="py-10">
      {backLink}
      <TournamentHeader
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
              {identityLines(fromNameHandle(cup.champion)).primary}
              {cup.finalScore && <span className="ml-2 tabular text-xs font-normal text-muted-foreground">{cup.finalScore}</span>}
            </p>
            {identityLines(fromNameHandle(cup.champion)).secondary && (
              <p className="text-xs text-muted-foreground">{identityLines(fromNameHandle(cup.champion)).secondary}</p>
            )}
          </div>
          <span className="eyebrow ml-2 text-[0.55rem] text-brand">Champion</span>
        </div>
      )}

      {!live && (cup.runnerUp || cup.thirdPlace) && (
        <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm">
          {cup.runnerUp && (
            <p className="text-muted-foreground">
              <span className="font-medium text-foreground">Runner-up:</span> {identityText(fromNameHandle(cup.runnerUp))}
            </p>
          )}
          {cup.thirdPlace && (
            <p className="text-muted-foreground">
              <span className="font-medium text-foreground">Third:</span> {identityText(fromNameHandle(cup.thirdPlace))}
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
        <p className="mt-6 rounded-lg border border-border bg-card/40 px-4 py-3 text-sm text-muted-foreground">
          Correcting this Tournament happens in{' '}
          <a href={`/creator/tournaments/${ws.tournament.id}/setup`} className="font-semibold text-brand hover:underline">
            Creator
          </a>.
        </p>
      )}
    </Container>
  )
}
