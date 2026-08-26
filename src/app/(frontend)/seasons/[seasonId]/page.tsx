import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { getSeasonView } from '@/lib/seasons/service'
import { getSeasonGroupStage } from '@/lib/seasons/views'
import { CommandDeck } from '@/components/command-deck'
import { seasonPlayoffRounds } from '@/lib/seasons/playoffs'
import {
  getSeasonBrowseData, seasonNeighbours, seasonPlayoffParticipants, hasPublicPlayoffBracket,
  getSeasonGlance,
} from '@/lib/seasons/browse'
import { searchSeasonEntrantsAction } from '@/lib/seasons/actions'
import { SeasonControls } from '@/components/seasons/season-controls'
import { SeasonGroupsView, GroupsStillInProgress } from '@/components/seasons/season-presentation'
import { SeasonMasthead } from '@/components/seasons/season-masthead'
import { SeasonRegistration } from '@/components/seasons/season-registration'
import { PlayoffDisclaimer } from '@/components/competition/playoff-disclaimer'
import { SeasonBracketPanel } from '@/components/seasons/season-bracket-panel'
import { resolveStaffAccess } from '@/lib/competition/staff-auth'
import { seasonAccess, HIDDEN_SEASON_METADATA } from '@/lib/seasons/visibility'
import { publicRegistrationOpen } from '@/lib/competition/registration-policy'
import { autoEntrantsAvailability } from '@/lib/archive/auto-entrants'
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
  searchParams: Promise<{ view?: string; competition?: string; division?: string; platform?: string }>
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
  /*
   * Whether a member may enter this Season themselves — one question, one answer, asked here.
   *
   * The Season's own access mode is no longer a second gate. It used to be: a Season could be OPEN
   * and still demand a join password, so "can I register" had two answers that could disagree, and
   * a member locked out by the wrong one had no way to tell which. The site-wide policy decides it
   * now. Legacy password-protected Seasons keep their mode and their hash — the data is preserved
   * and still readable — it simply is not consulted when deciding whether to show the control.
   */
  const memberRegistrationOpen = await publicRegistrationOpen({ lifecycleState: state })
  // A division narrowing, when the reader has asked for one. Null means every division.
  const divisionFilter = (typeof sp.division === 'string' ? sp.division : null) || null
  const [browse, neighbours, groups, qualified, bracketPublic, glance] = await Promise.all([
    /*
     * The browser is scoped to the platform of the Season on screen, not to a URL parameter.
     *
     * Opening a Yahoo Season by link and finding CueVerse pickers around it would be the same
     * mismatch the other way round; taking the scope from the record means a shared link always
     * arrives in the era it belongs to.
     */
    getSeasonBrowseData(competition, view.platform, divisionFilter),
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
  const [addEntrantsAuto] = canManageComp
    ? await Promise.all([autoEntrantsAvailability(view.id)])
    : [{ show: false, disabledReason: null }]

  // The masthead's "View Playoffs" switches the same toggle the control bar drives, so it is built
  // from the URL already on screen rather than a second source of truth.
  const playoffsParams = new URLSearchParams()
  if (competition) playoffsParams.set('competition', competition)
  playoffsParams.set('view', 'playoffs')
  const playoffsHref = `/seasons/${id}?${playoffsParams.toString()}`


  return (
    <div className="w-full">
      <SeasonControls
        competitions={browse.competitions}
        seasons={browse.seasons}
        years={browse.years}
        current={{ id, number, year: view.year }}
        competitionSlug={competition}
        platform={view.platform}
        divisions={browse.divisions}
        division={divisionFilter}
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
          platform={view.platform}
          division={view.division}
          ranked={view.ranked}
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
            (
              /*
               * Read-only, for everybody.
               *
               * Score entry, Close Groups and Reopen Groups used to appear here for an
               * administrator, which meant the same group could be edited from two different
               * screens with two different sets of controls. Whichever one somebody happened to be
               * looking at decided what they could do, and the two had to be kept in step by hand.
               * Group management is Creator's now; this page reports.
               */
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
              bracketPublic={bracketPublic}
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
          memberRegistrationOpen={memberRegistrationOpen}
          addEntrantsAuto={addEntrantsAuto}
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
/**
 * The public playoff view.
 *
 * Build Playoff Bracket and Place Entrants are gone: they build a PRIVATE draft, which has no
 * business being reachable from the page the draft is hidden from. Live score entry stays for now
 * because Creator has nowhere to put it yet - it moves with the next stage, and removing it first
 * would leave no way to record a playoff result at all.
 */
async function PlayoffsView({
  seasonId, bracketPublic, canManageComp, champion,
}: {
  seasonId: number
  bracketPublic: boolean
  canManageComp: boolean
  champion: { cueverseId: string | null; preferredName: string | null; runnerUp: string | null; finalScore: string | null } | null
}) {
  if (!bracketPublic) return <GroupsStillInProgress />
  const rounds = await seasonPlayoffRounds(seasonId)
  if (rounds.length === 0) return <GroupsStillInProgress />
  const note = await playoffDisclaimerOf(seasonId)

  /*
   * Everybody sees the same read-only bracket, including an Owner.
   *
   * Score entry, corrections and Close Season used to appear here for an administrator, which meant
   * the bracket could be edited from a public URL by a component that happened to be handed a
   * permission flag. Playoff scoring is Creator's now — see /creator/seasons/[id]/playoffs — and the
   * server actions behind it require the Creator capability, so removing the controls is the
   * presentation half of a rule the services already enforce.
   */
  /*
   * The bracket's own readout, in the same deck the group stage and the ladder use.
   *
   * A bracket already shows its shape, but not its state — how much of it has actually been played
   * is something a reader currently has to infer from which cards have scores. Counting it once,
   * here, states it.
   */
  const matches = rounds.flatMap((r) => r.matches)
  const decided = matches.filter((m) => m.winner != null).length

  return (
    <div>
      <CommandDeck
        eyebrow="Playoff Bracket"
        title="Playoffs"
        meta={rounds.map((r) => r.name).join(' → ')}
        stats={[
          { label: 'Rounds', value: rounds.length },
          { label: 'Matches', value: `${decided}/${matches.length}` },
          ...(champion?.finalScore ? [{ label: 'Final', value: champion.finalScore }] : []),
        ]}
      />
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
  view, state, canManage, canManageComp, isLoggedIn, registered, addEntrantsAuto,
  memberRegistrationOpen,
}: {
  view: NonNullable<Awaited<ReturnType<typeof getSeasonView>>>
  state: string
  canManage: boolean
  canManageComp: boolean
  isLoggedIn: boolean
  registered: boolean
  /** The site-wide policy's answer for this Season. The ONLY thing that opens self-registration. */
  memberRegistrationOpen: boolean
  /** Decided by the page, not here: one source for whether Auto Assign belongs on this screen. */
  addEntrantsAuto?: { show: boolean; disabledReason: string | null }
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
        memberRegistrationOpen={memberRegistrationOpen}
        autoEntrants={addEntrantsAuto}
      />
    )
  }

  if (state === 'REGISTRATION_CLOSED' || state === 'GROUP_SETUP') {
    /*
     * The draft board is gone from here.
     *
     * It rendered the private group draft into a public route's markup, guarded only by a
     * permission flag on the component. A draft that is meant to be invisible should not be in the
     * page at all - see the Creator groups stage, which is where it lives now.
     */
    return (
      <Info>
        Registration is closed with {view.entrantsCount} entrants. Groups will be published shortly.
        {canManageComp && (
          <>
            {' '}
            <a href={`/creator/seasons/${view.id}/groups`} className="font-semibold text-brand hover:underline">
              Set up the groups in Creator
            </a>.
          </>
        )}
      </Info>
    )
  }

  if (state === 'GROUPS_CLOSED') {
    return (
      <Info>
        Group Stage Complete — playoff bracket coming shortly.
        {canManageComp && (
          <>
            {' '}
            <a href={`/creator/seasons/${view.id}/groups`} className="font-semibold text-brand hover:underline">
              Advance to playoff selection in Creator
            </a>.
          </>
        )}
      </Info>
    )
  }

  if (state === 'PLAYOFF_SETUP') {
    /*
     * The private draft is not rendered here any more.
     *
     * It was: the setup board shipped the whole unpublished bracket - every participant and their
     * position - into a public route's markup, guarded by a permission flag on the component. A
     * draft that is meant to be invisible should not be in the response at all. It lives in Creator
     * now, which is also the only place it can be edited.
     */
    return (
      <Info>
        Group Stage Complete — playoff bracket coming shortly.
        {canManageComp && (
          <>
            {' '}
            <a href={`/creator/seasons/${view.id}/playoffs`} className="font-semibold text-brand hover:underline">
              Build the bracket in Creator
            </a>.
          </>
        )}
      </Info>
    )
  }

  return null
}

async function playoffDisclaimerOf(seasonId: number): Promise<string | null> {
  const s = await prisma.season.findUnique({ where: { id: seasonId }, select: { playoffDisclaimer: true } })
  return s?.playoffDisclaimer ?? null
}


function Info({ children }: { children: React.ReactNode }) {
  return <div className="mt-8 rounded-none border border-border bg-card/40 p-6 text-sm text-muted-foreground">{children}</div>
}
