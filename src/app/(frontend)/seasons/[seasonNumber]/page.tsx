import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { Settings2 } from 'lucide-react'

import { getSeasonView } from '@/lib/seasons/service'
import { getSeasonGroupSetup, getSeasonGroupStage } from '@/lib/seasons/views'
import { loadSeasonSeeding, seasonPlayoffRounds, seasonChampion } from '@/lib/seasons/playoffs'
import {
  getSeasonBrowseData, seasonNeighbours, seasonPlayoffParticipants, hasPublicPlayoffBracket,
  getSeasonGlance,
} from '@/lib/seasons/browse'
import { searchSeasonEntrantsAction } from '@/lib/seasons/actions'
import { SeasonControls } from '@/components/seasons/season-controls'
import { SeasonGroupsView, GroupsStillInProgress } from '@/components/seasons/season-presentation'
import { SeasonMasthead } from '@/components/seasons/season-masthead'
import { SeasonRegistration } from '@/components/seasons/season-registration'
import { SeasonGroupSetup } from '@/components/seasons/season-group-setup'
import { SeasonGroupStage } from '@/components/seasons/season-group-stage'
import { SeasonPlayoffs } from '@/components/seasons/season-playoffs'
import { PlayoffDisclaimer } from '@/components/competition/playoff-disclaimer'
import { EnterPlayoffsButton } from '@/components/seasons/enter-playoffs-button'
import { Bracket } from '@/components/tournaments/bracket'
import { resolveStaffAccess } from '@/lib/competition/staff-auth'
import { getCurrentUser } from '@/lib/account/auth'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ seasonNumber: string }> }): Promise<Metadata> {
  const { seasonNumber } = await params
  const view = await getSeasonView(Number(seasonNumber))
  return view ? { title: view.title, description: view.description ?? '8BR Season Championship.' } : { title: 'Season' }
}

/**
 * A Season, presented full width.
 *
 * The public view — controls, header, champion, and either the group matrices or the playoff
 * bracket — is driven entirely by rows in the registry. A Season is visible from the moment it is
 * created, and its groups and results appear publicly as they are entered; there is no separate
 * draft/publish switch. Admin management is unchanged and sits beneath.
 *
 * Groups/Playoffs lives in the URL (`?view=`) so the chosen view survives a refresh or a shared
 * link, and the Competition filter travels the same way so the arrows keep their scope.
 */
export default async function SeasonPage({
  params, searchParams,
}: {
  params: Promise<{ seasonNumber: string }>
  searchParams: Promise<{ view?: string; competition?: string }>
}) {
  const { seasonNumber } = await params
  const sp = await searchParams
  const number = Number(seasonNumber)
  if (!Number.isFinite(number)) notFound()
  const view = await getSeasonView(number)
  if (!view) notFound()

  // Groups is the default whenever no view is supplied, or an unrecognised one is.
  const activeView: 'groups' | 'playoffs' = sp.view === 'playoffs' ? 'playoffs' : 'groups'
  const competition = sp.competition ?? null

  const access = await resolveStaffAccess()
  const canManage = access.status === 'ok' && access.actor.can('manage_registrations')
  const canManageComp = access.status === 'ok' && access.actor.can('manage_competitions')
  const user = await getCurrentUser()
  const registered = user
    ? !!(await prisma.seasonEntrant.findFirst({ where: { seasonId: view.id, status: { not: 'WITHDRAWN' }, userId: Number(user.id) }, select: { id: true } }))
    : false

  const state = view.lifecycleState
  const [browse, neighbours, groups, qualified, bracketPublic, glance] = await Promise.all([
    getSeasonBrowseData(competition),
    seasonNeighbours(number, competition),
    getSeasonGroupStage(view.id),
    seasonPlayoffParticipants(view.id),
    hasPublicPlayoffBracket(view.id, state),
    getSeasonGlance(view.id, view.format.groupStageGames),
  ])

  // The masthead's "View Playoffs" switches the same toggle the control bar drives, so it is built
  // from the URL already on screen rather than a second source of truth.
  const playoffsParams = new URLSearchParams()
  if (competition) playoffsParams.set('competition', competition)
  playoffsParams.set('view', 'playoffs')
  const playoffsHref = `/seasons/${number}?${playoffsParams.toString()}`

  // Admins keep editing the group tables through the existing stage component; everyone else gets
  // the read-only matrix. Rendering both would show the same group twice.
  const adminEditsGroups = canManageComp && (state === 'GROUP_STAGE_LIVE' || state === 'GROUPS_CLOSED')

  return (
    <div className="w-full">
      <SeasonControls
        competitions={browse.competitions}
        seasons={browse.seasons}
        years={browse.years}
        current={{ number, year: view.year }}
        competitionSlug={competition}
        view={activeView}
        neighbours={neighbours}
        searchPlayers={async (q: string) => {
          'use server'
          return searchSeasonEntrantsAction(view.id, q)
        }}
      />

      {/* Full bleed: only small responsive gutters, no centred cap, so the masthead and the tables
          below it use the whole viewport. */}
      <div className="w-full max-w-none px-3 pb-16 pt-4 sm:px-5">
        <SeasonMasthead
          competitionName={view.competition.name}
          competitionShortName={view.competition.shortName}
          number={number}
          year={view.year}
          subtitle={view.subtitle}
          state={state}
          glance={glance}
          playoffsHref={playoffsHref}
          champion={
            // A champion is shown ONLY for a closed Season with a recorded winner. Anything earlier
            // would be presenting a provisional leader as the champion.
            state === 'COMPLETED' && (view.championHandle || view.championName)
              ? {
                  cueverseId: view.championHandle,
                  preferredName: view.championName,
                  runnerUpCueverseId: view.runnerUpHandle,
                  runnerUpName: view.runnerUpName,
                  finalScore: view.finalScore,
                }
              : null
          }
        />

        {canManage && (
          <div className="mt-3 flex justify-end">
            <Link
              href={`/seasons/${number}/settings`}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              <Settings2 className="size-4" /> Settings
            </Link>
          </div>
        )}

        {view.description && <p className="mt-4 max-w-3xl text-sm text-muted-foreground">{view.description}</p>}

        <div className="mt-6">
          {activeView === 'groups' ? (
            adminEditsGroups ? (
              <SeasonGroupStage
                seasonId={view.id}
                groups={groups}
                groupStageGames={view.format.groupStageGames}
                canManage={canManage && state === 'GROUP_STAGE_LIVE'}
                canClose={canManageComp && state === 'GROUP_STAGE_LIVE'}
                canReopen={canManageComp && state === 'GROUPS_CLOSED'}
              />
            ) : (
              <SeasonGroupsView
                groups={groups}
                groupStageGames={view.format.groupStageGames}
                qualified={qualified}
                state={state}
              />
            )
          ) : (
            <PlayoffsView
              seasonId={view.id}
              state={state}
              bracketPublic={bracketPublic}
              canManage={canManage}
              canManageComp={canManageComp}
            />
          )}
        </div>

        <AdminSurfaces
          view={view}
          number={number}
          state={state}
          canManage={canManage}
          canManageComp={canManageComp}
          isLoggedIn={!!user}
          registered={registered}
        />
      </div>
    </div>
  )
}

/**
 * The Playoffs view.
 *
 * A live Season routes through `SeasonPlayoffs`, which carries the admin score entry and the Close
 * Season control — so switching to this tab costs an admin nothing. A closed Season renders the
 * finished bracket read-only. With no public bracket the toggle still works and says so plainly.
 */
async function PlayoffsView({
  seasonId, state, bracketPublic, canManage, canManageComp,
}: {
  seasonId: number
  state: string
  bracketPublic: boolean
  canManage: boolean
  canManageComp: boolean
}) {
  if (!bracketPublic) return <GroupsStillInProgress />
  const rounds = await seasonPlayoffRounds(seasonId)
  if (rounds.length === 0) return <GroupsStillInProgress />

  if (state === 'PLAYOFFS_LIVE') {
    return (
      <div className="season-bracket">
        <SeasonPlayoffs
          seasonId={seasonId}
          phase="live"
          seeding={[]}
          rounds={rounds}
          doubleElim={false}
          hasDraft
          canManage={canManage}
          canClose={canManageComp && !!(await seasonChampion(seasonId))}
          disclaimer={await playoffDisclaimerOf(seasonId)}
        />
      </div>
    )
  }

  return (
    <div className="season-bracket">
      <div className="w-full"><Bracket rounds={rounds} fluid /></div>
      <PlayoffDisclaimer kind="season" id={seasonId} value={await playoffDisclaimerOf(seasonId)} canManage={canManageComp} />
    </div>
  )
}

/**
 * Admin management, preserved exactly as it was and kept below the public presentation: entrant
 * registration, group setup, advancing to the playoffs, and playoff seeding.
 *
 * Phases whose management surface IS the public view (a live group stage, live playoffs) are absent
 * here — they render above instead, so an admin edits in place rather than in a duplicate table.
 */
async function AdminSurfaces({
  view, number, state, canManage, canManageComp, isLoggedIn, registered,
}: {
  view: NonNullable<Awaited<ReturnType<typeof getSeasonView>>>
  number: number
  state: string
  canManage: boolean
  canManageComp: boolean
  isLoggedIn: boolean
  registered: boolean
}) {
  if (state === 'REGISTRATION_OPEN' || state === 'REGISTRATION_SCHEDULED') {
    return (
      <SeasonRegistration
        seasonId={view.id}
        seasonNumber={number}
        entrants={view.entrants.map((e) => ({ entrantId: e.entrantId, name: e.name, cueverseId: e.cueverseId, slug: e.slug, rating: e.rating }))}
        canManage={canManage}
        isOpen={state === 'REGISTRATION_OPEN'}
        isLoggedIn={isLoggedIn}
        alreadyRegistered={registered}
        requiresPassword={view.requiresJoinPassword}
      />
    )
  }

  if (state === 'REGISTRATION_CLOSED' || state === 'GROUP_SETUP') {
    return canManageComp
      ? <SeasonGroupSetup seasonId={view.id} view={await getSeasonGroupSetup(view.id)} />
      : <Info>Registration is closed with {view.entrantsCount} entrants. Groups are being set up — they appear above as soon as they are published.</Info>
  }

  if (state === 'GROUPS_CLOSED' && canManageComp) {
    return (
      <div className="mt-8 flex flex-wrap items-center gap-3">
        <EnterPlayoffsButton seasonId={view.id} />
        <span className="text-sm text-muted-foreground">Groups are closed — advance to playoff selection, or reopen above to edit results.</span>
      </div>
    )
  }

  if (state === 'PLAYOFF_SETUP') {
    return canManageComp
      ? (
        <div className="season-bracket">
          <SeasonPlayoffs
            seasonId={view.id}
            phase="setup"
            seeding={await loadSeasonSeeding(view.id)}
            rounds={await seasonPlayoffRounds(view.id)}
            doubleElim={await playoffTypeOf(view.id)}
            hasDraft={(await prisma.seasonPlayoffMatch.count({ where: { seasonId: view.id } })) > 0}
            canManage
            canClose={false}
            disclaimer={await playoffDisclaimerOf(view.id)}
          />
        </div>
      )
      : <Info>Group stage complete — the playoff field is being finalized.</Info>
  }

  return null
}

async function playoffDisclaimerOf(seasonId: number): Promise<string | null> {
  const s = await prisma.season.findUnique({ where: { id: seasonId }, select: { playoffDisclaimer: true } })
  return s?.playoffDisclaimer ?? null
}

async function playoffTypeOf(seasonId: number): Promise<boolean> {
  const s = await prisma.season.findUnique({ where: { id: seasonId }, select: { playoffDoubleElim: true } })
  return s?.playoffDoubleElim ?? false
}

function Info({ children }: { children: React.ReactNode }) {
  return <div className="mt-8 rounded-lg border border-border bg-card/40 p-6 text-sm text-muted-foreground">{children}</div>
}
