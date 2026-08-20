import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

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
import { SeasonBracketPanel } from '@/components/seasons/season-bracket-panel'
import { resolveStaffAccess } from '@/lib/competition/staff-auth'
import { seasonAccess, HIDDEN_SEASON_METADATA } from '@/lib/seasons/visibility'
import { autoAssignAvailability } from '@/lib/archive/auto-assign'
import { autoEntrantsAvailability } from '@/lib/archive/auto-entrants'
import { playoffBracketAvailability } from '@/lib/archive/auto-playoffs'
import { getCurrentUser } from '@/lib/account/auth'
import { prisma } from '@/lib/prisma'
import { DEFAULT_COMPETITION_SLUG } from '@/lib/seasons/browse'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ seasonId: string }> }): Promise<Metadata> {
  const { seasonId } = await params
  const id = Number(seasonId)

  /*
   * The metadata is guarded before the page is.
   *
   * `generateMetadata` runs even when the page body calls notFound(), so guarding only the body
   * still puts a private Season's real title in the browser tab and in the head of the not-found
   * response. Same rule, same function, applied here first.
   */
  const access = await seasonAccess(id)
  if (!access.allowed) return HIDDEN_SEASON_METADATA

  const view = await getSeasonView(id)
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
  params: Promise<{ seasonId: string }>
  searchParams: Promise<{ view?: string; competition?: string }>
}) {
  const { seasonId } = await params
  const sp = await searchParams
  // The URL carries the immutable database id. The displayed Season number is a separate, editable
  // label that is only unique within its Competition and year, so it could never address a Season.
  const id = Number(seasonId)
  if (!Number.isInteger(id) || id <= 0) notFound()
  const view = await getSeasonView(id)
  if (!view) notFound()
  const number = view.number

  // Groups is the default whenever no view is supplied, or an unrecognised one is.
  const activeView: 'groups' | 'playoffs' = sp.view === 'playoffs' ? 'playoffs' : 'groups'
  // Same default as the landing page, so the picker and the prev/next arrows stay inside 8BRCAM
  // unless the URL says otherwise.
  const competition = sp.competition ?? DEFAULT_COMPETITION_SLUG

  const access = await resolveStaffAccess()
  const canManage = access.status === 'ok' && access.actor.can('manage_registrations')
  const canManageComp = access.status === 'ok' && access.actor.can('manage_competitions')

  /*
   * A private Season is private at its own URL too.
   *
   * The listings already filter on `publiclyVisible`, but this route did not — so any private
   * Season could be opened by guessing its id. One shared rule now decides it, for every private
   * Season and not merely the generated shells: see lib/seasons/visibility.
   */
  if (!(await seasonAccess(view.id)).allowed) notFound()
  const user = await getCurrentUser()
  const registered = user
    ? !!(await prisma.seasonEntrant.findFirst({ where: { seasonId: view.id, status: { not: 'WITHDRAWN' }, userId: Number(user.id) }, select: { id: true } }))
    : false

  const state = view.lifecycleState
  const [browse, neighbours, groups, qualified, bracketPublic, glance] = await Promise.all([
    getSeasonBrowseData(competition),
    seasonNeighbours(id, competition),
    getSeasonGroupStage(view.id),
    seasonPlayoffParticipants(view.id),
    hasPublicPlayoffBracket(view.id, state),
    getSeasonGlance(view.id, view.format.groupStageGames),
  ])

  /*
   * Auto Assign availability, decided once, on the server.
   *
   * Both boards receive it rather than working it out themselves — otherwise the entrant board and
   * the score board would each carry a copy of the phase and blocking rules, and they would drift.
   */
  const [entrantAuto, scoreAuto, addEntrantsAuto, playoffAuto] = canManageComp
    ? await Promise.all([
        autoAssignAvailability(view.id, 'entrants'),
        autoAssignAvailability(view.id, 'scores'),
        autoEntrantsAvailability(view.id),
        playoffBracketAvailability(view.id),
      ])
    : [
        { show: false, disabledReason: null }, { show: false, disabledReason: null },
        { show: false, disabledReason: null }, { show: false, disabledReason: null },
      ]

  // The masthead's "View Playoffs" switches the same toggle the control bar drives, so it is built
  // from the URL already on screen rather than a second source of truth.
  const playoffsParams = new URLSearchParams()
  if (competition) playoffsParams.set('competition', competition)
  playoffsParams.set('view', 'playoffs')
  const playoffsHref = `/seasons/${id}?${playoffsParams.toString()}`

  // Admins keep editing the group tables through the existing stage component; everyone else gets
  // the read-only matrix. Rendering both would show the same group twice.
  const adminEditsGroups = canManageComp && (state === 'GROUP_STAGE_LIVE' || state === 'GROUPS_CLOSED')

  return (
    <div className="w-full">
      <SeasonControls
        competitions={browse.competitions}
        seasons={browse.seasons}
        years={browse.years}
        current={{ id, number, year: view.year }}
        competitionSlug={competition}
        view={activeView}
        neighbours={neighbours}
        searchPlayers={async (q: string) => {
          'use server'
          return searchSeasonEntrantsAction(view.id, q)
        }}
        settingsHref={canManage ? `/seasons/${id}/settings` : null}
        createHref={canManageComp ? '/seasons/new' : null}
      />

      {/* Full bleed: only small responsive gutters, no centred cap, so the masthead and the tables
          below it use the whole viewport. */}
      <div className="w-full max-w-none px-3 pb-16 pt-4 sm:px-5">
        {/* Shown on both views: it identifies the Season you are looking at, and switching to the
            bracket should not take that away. */}
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

        {view.description && <p className="mt-4 max-w-3xl text-sm text-muted-foreground">{view.description}</p>}

        <div className="mt-6">
          {activeView === 'groups' ? (
            adminEditsGroups ? (
              <SeasonGroupStage
                seasonId={view.id}
                groups={groups}
                groupStageGames={view.format.groupStageGames}
                autoAssign={scoreAuto}
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
                seasonId={view.id}
                canManage={canManageComp}
              />
            )
          ) : (
            <PlayoffsView
              seasonId={view.id}
              playoffAuto={playoffAuto}
              state={state}
              bracketPublic={bracketPublic}
              canManage={canManage}
              canManageComp={canManageComp}
              champion={
                state === 'COMPLETED' && (view.championHandle || view.championName)
                  ? {
                      cueverseId: view.championHandle,
                      preferredName: view.championName,
                      runnerUp: view.runnerUpHandle || view.runnerUpName,
                      finalScore: view.finalScore,
                    }
                  : null
              }
            />
          )}
        </div>

        <AdminSurfaces
          view={view}
          state={state}
          canManage={canManage}
          canManageComp={canManageComp}
          isLoggedIn={!!user}
          registered={registered}
          entrantAuto={entrantAuto}
          addEntrantsAuto={addEntrantsAuto}
          playoffAuto={playoffAuto}
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
  seasonId, state, bracketPublic, canManage, canManageComp, champion,
  playoffAuto,
}: {
  seasonId: number
  state: string
  bracketPublic: boolean
  canManage: boolean
  canManageComp: boolean
  champion: { cueverseId: string | null; preferredName: string | null; runnerUp: string | null; finalScore: string | null } | null
  /** Decided by the page: one source for whether Build Playoff Bracket belongs here. */
  playoffAuto?: { show: boolean; disabledReason: string | null }
}) {
  if (!bracketPublic) return <GroupsStillInProgress />
  const rounds = await seasonPlayoffRounds(seasonId)
  if (rounds.length === 0) return <GroupsStillInProgress />
  const note = await playoffDisclaimerOf(seasonId)

  // An admin running LIVE playoffs keeps the editable bracket: that component carries inline score
  // entry and Close Season, and swapping it for the read-only panel would take those away.
  if (state === 'PLAYOFFS_LIVE' && canManage) {
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
          disclaimer={note}
          autoPlayoffs={playoffAuto}
        />
      </div>
    )
  }

  return (
    <div>
      <SeasonBracketPanel rounds={rounds} note={note} champion={champion} />
      {/* The note itself lives in the panel footer; this is only the way in to edit it. */}
      <PlayoffDisclaimer kind="season" id={seasonId} value={note} canManage={canManageComp} showValue={false} />
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
  view, state, canManage, canManageComp, isLoggedIn, registered, entrantAuto, addEntrantsAuto, playoffAuto,
}: {
  view: NonNullable<Awaited<ReturnType<typeof getSeasonView>>>
  state: string
  canManage: boolean
  canManageComp: boolean
  isLoggedIn: boolean
  registered: boolean
  /** Decided by the page, not here: one source for whether Auto Assign belongs on this screen. */
  entrantAuto?: { show: boolean; disabledReason: string | null }
  addEntrantsAuto?: { show: boolean; disabledReason: string | null }
  playoffAuto?: { show: boolean; disabledReason: string | null }
}) {
  if (state === 'REGISTRATION_OPEN' || state === 'REGISTRATION_SCHEDULED') {
    return (
      <SeasonRegistration
        seasonId={view.id}
        entrants={view.entrants.map((e) => ({ entrantId: e.entrantId, name: e.name, cueverseId: e.cueverseId, slug: e.slug, rating: e.rating }))}
        canManage={canManage}
        isOpen={state === 'REGISTRATION_OPEN'}
        isLoggedIn={isLoggedIn}
        alreadyRegistered={registered}
        requiresPassword={view.requiresJoinPassword}
        autoEntrants={addEntrantsAuto}
      />
    )
  }

  if (state === 'REGISTRATION_CLOSED' || state === 'GROUP_SETUP') {
    return canManageComp
      ? <SeasonGroupSetup seasonId={view.id} view={await getSeasonGroupSetup(view.id)} autoAssign={entrantAuto} />
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
            autoPlayoffs={playoffAuto}
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
