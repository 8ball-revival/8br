import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { CreatorShell } from '@/components/creator/creator-shell'
import { CreatorSettings } from '@/components/creator/settings-panel'
import { TournamentWorkspace } from '@/components/tournaments/tournament-workspace'
import { TournamentEntrantsBoard } from '@/components/creator/tournament-entrants-board'
import { TournamentBracketSetup } from '@/components/creator/tournament-bracket-setup'
import { tournamentTopology } from '@/lib/tournaments/bracket-topology'
import { TournamentLiveBracket } from '@/components/creator/tournament-live-bracket'
import { LowerBracketEditor } from '@/components/creator/lower-bracket-editor'
import { getRoutableBracket } from '@/lib/competition/lower-bracket-service'
import { tournamentScoringRounds } from '@/lib/tournaments/scoring-view'
import { championOfTournament } from '@/lib/tournaments/champion'
import { loadTournamentStage } from '@/lib/creator/tournament-stage'
import { updateRecordDisplayAction } from '@/lib/creator/settings-actions'
import { updateTournamentDetailsAction } from '@/lib/creator/record-details'
import { resolveStaffAccess } from '@/lib/competition/staff-auth'
import { getTournamentWorkspace } from '@/lib/tournaments/live'
import { getTournamentHistory } from '@/lib/competition/tournament-lifecycle'
import { tournamentStore, loadTournamentContext } from '@/lib/tournaments/prime'
import type { StageId } from '@/lib/creator/workflow'

export const dynamic = 'force-dynamic'

/*
  Closing a competition replays the entire rating ledger inside one transaction — about five seconds
  today and growing with the archive. The Prisma timeout was raised to match (LEDGER_TX_OPTIONS);
  this raises the FUNCTION's limit so the lambda cannot be cut off first and leave the close half
  done. Two limits guard the same operation and both have to be big enough.
*/
export const maxDuration = 60
export const metadata: Metadata = { title: 'Tournament · Creator', robots: { index: false } }

/**
 * Every Tournament stage, on its own URL, rendering the canonical workspace.
 *
 * ── One page, not seven ──────────────────────────────────────────────────────────────────────────
 * Setup, entrants, teams, groups, swiss, playoffs and complete are the same workspace entered at
 * different tabs. Seven near-identical files would each load the same data and differ by one string,
 * and they would drift. A single dynamic segment keeps the URLs the specification asks for and one
 * place to change when the workspace does.
 *
 * ── The stage guard is the loader's ──────────────────────────────────────────────────────────────
 * `loadTournamentStage` refuses a stage this record has not reached and redirects to the one it has,
 * exactly as the Season loader does — so /swiss on a single-elimination Tournament lands somewhere
 * useful instead of rendering an empty page.
 */

/** Creator stage → the workspace tab that does that work. */
const TAB_FOR: Record<string, 'overview' | 'roster' | 'groups' | 'swiss' | 'bracket' | 'results' | 'settings'> = {
  setup: 'overview',
  entrants: 'roster',
  teams: 'roster',
  groups: 'groups',
  swiss: 'swiss',
  playoffs: 'bracket',
  complete: 'results',
}

const STAGE_IDS = new Set(['setup', 'entrants', 'teams', 'groups', 'swiss', 'playoffs', 'complete'])

/**
 * Which screen a bracket stage shows, decided by the BRACKET rather than by the lifecycle state.
 *
 * An elimination Tournament draws its bracket once registration closes. A Groups + Playoffs one
 * gets it from confirming the qualifiers, while the record is still GROUPS_IN_PROGRESS. Keying on
 * the state meant enumerating those combinations, and the second one was missing — its playoffs
 * stage fell through to the workspace. Asking whether the draw has been PUBLISHED is the same
 * question asked once, and it is the question that actually decides:
 *
 *   no matches, or none published  →  the private setup board, still arrangeable
 *   any match published            →  the live scoring board
 *
 * Swiss keeps the workspace, deliberately and finally: it has no bracket — its rounds are paired as
 * it goes — so there is no board for it to move to, and it is the one format left holding the flat
 * Results list that every other format has stopped needing.
 */
const BRACKET_STAGES = new Set(['playoffs', 'complete'])
const HAS_A_BRACKET = (format: string) => format !== 'SWISS'

export default async function CreatorTournamentStagePage({
  params,
}: {
  params: Promise<{ id: string; stage: string }>
}) {
  const { id, stage } = await params
  if (!STAGE_IDS.has(stage)) notFound()

  // The live TournamentView revision has to be resolved before the workspace data is read; see the
  // note in lib/tournaments/context about why this must be inlined in the page frame.
  tournamentStore.enterWith(await loadTournamentContext())

  /*
   * `teams` is not a workflow stage — it is the roster tab under a different name, offered only for
   * a team Tournament. Mapping it to `entrants` for the reachability check keeps the workflow bar
   * honest while still giving teams their own URL.
   */
  const asked = (stage === 'teams' ? 'entrants' : stage) as StageId
  const ctx = await loadTournamentStage(id, asked)
  if (stage === 'teams' && !ctx.isTeam) notFound()

  const access = await resolveStaffAccess()
  const canManage = access.status === 'ok' && access.actor.can('manage_competitions')
  const canEditResults = access.status === 'ok' && access.actor.can('edit_results')
  const isOwner = access.status === 'ok' && access.actor.isOwner

  const ws = ctx.number != null ? await getTournamentWorkspace(ctx.number) : null

  return (
    <CreatorShell
      kind="tournament"
      title={ctx.title}
      summary={ctx.summary}
      status={ctx.status}
      workflow={ctx.workflow}
      publicHref={ctx.publicHref}
      settings={
        <CreatorSettings
          summary={ctx.settings}
          onSaveDisplay={async (patch) => {
            'use server'
            return updateRecordDisplayAction('tournament', ctx.id, patch)
          }}
          onSaveDetails={async (patch) => {
            'use server'
            return updateTournamentDetailsAction(ctx.id, patch)
          }}
        />
      }
      actions={
        <Link
          href="/creator"
          className="inline-flex items-center cyber-clip-sm border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-brand/40 hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]/60"
        >
          Save and Exit
        </Link>
      }
    >
      {/*
        ── Entrants is its own screen, shared with Seasons ──────────────────────────────────────
        Every other stage is a tab of the workspace, which is why this page maps stages onto tabs.
        Entrants is not: filling a list is the same job for both records, so it is the same board —
        compact rows, the handle in gold, the rating on the right, one count at the bottom — rather
        than a second version of it living inside the Tournament workspace.

        A drawn-team Tournament is excluded: its entrants are roster members with no registration of
        their own, so there is nothing on this screen for a person to add or remove.
      */}
      {ws && stage === 'entrants' && !ctx.isTeam ? (
        <TournamentEntrantsBoard
          tournamentId={ctx.id}
          format={String(ws.tournament.tournamentFormat ?? 'SINGLE_ELIM')}
          entrants={ws.entrants
            .filter((e) => !e.withdrawn)
            .map((e) => ({
              entrantId: e.registrationId,
              playerId: e.playerId,
              name: e.name,
              cueverseId: e.handle,
              rating: e.rating,
            }))}
          isOpen={ws.tournament.lifecycleState === 'REGISTRATION_OPEN'}
        />
      ) : ws && stage === 'playoffs'
        && HAS_A_BRACKET(String(ws.tournament.tournamentFormat))
        && !ws.matches.some((m) => m.published) ? (
        /*
          ── The draw is arranged before it exists publicly ─────────────────────────────────────
          Only while the bracket is still a draft. Once it is published the Tournament is a live
          record and the workspace's bracket tab is the right surface — this screen would offer to
          rearrange positions the server would refuse, which is worse than not offering it.
        */
        <TournamentBracketSetup
          tournamentId={ctx.id}
          topology={tournamentTopology(ws.matches)}
          /*
            A team is ONE entrant on this board.

            The draw seats a registration either way — a team has one of its own — so the board,
            the swap and the seeds are unchanged. Only the list differs: a team has a name and a
            roster rather than a handle and a rating.
          */
          entrants={ws.tournament.participantFormat === 'TEAM'
            ? ws.teams
              .filter((t) => !t.withdrawn)
              .map((t) => ({
                registrationId: t.registrationId,
                name: `${t.members.length} player${t.members.length === 1 ? '' : 's'}`,
                handle: t.name,
                rating: null,
                seed: t.seed,
              }))
            : ws.entrants
              .filter((e) => !e.withdrawn)
              .map((e) => ({
                registrationId: e.registrationId,
                name: e.name,
                handle: e.handle,
                rating: e.rating,
                seed: e.seed,
              }))}
          isDoubleElim={String(ws.tournament.tournamentFormat) === 'DOUBLE_ELIM'}
          /*
            A Groups + Playoffs draw is produced by confirming the qualifiers, not drawn here.
            Offering to redraw would discard the group stage's answer about who goes through.
          */
          canRedraw={String(ws.tournament.tournamentFormat) !== 'GROUPS_PLAYOFFS'}
          canStart
        />
      ) : ws && BRACKET_STAGES.has(stage)
        && HAS_A_BRACKET(String(ws.tournament.tournamentFormat))
        && ws.matches.some((m) => m.published) ? (
        /*
          ── Once it has started, the board IS the screen ────────────────────────────────────────
          The same scoring board a Season uses: scores in the cells, FF in the forfeiting player's
          own cell, a tie refused, the winner advanced, and a match still waiting told what it is
          waiting for. There is no separate flat list of results any more — it showed the same
          matches in a shape that could not say what a bye was.
        */
        <>
          <TournamentLiveBracket
            tournamentId={ctx.id}
            rounds={await tournamentScoringRounds(ctx.id)}
            champion={await championOfTournament(ctx.id)}
            isCompleted={String(ws.tournament.lifecycleState) === 'COMPLETED'}
          />
          {/*
            Owner-only, and only where there IS a losers bracket.

            `getRoutableBracket` returns nothing for a single-elimination or Swiss Tournament, so
            the editor renders nothing there rather than an empty panel. The gate is repeated in the
            server action: this one decides what is drawn, not what is allowed.
          */}
          {isOwner && (
            <LowerBracketEditor tournamentId={ctx.id} matches={await getRoutableBracket(ctx.id)} />
          )}
        </>
      ) : ws ? (
        <TournamentWorkspace
          data={ws}
          canManage={canManage}
          canEditResults={canEditResults}
          isOwner={isOwner}
          history={await getTournamentHistory(ctx.id, { admin: true })}
          initialTab={TAB_FOR[stage]}
        />
      ) : (
        <p className="cyber-clip border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">
          This Tournament has no live workspace yet. It may be an imported record whose data lives in
          the archive snapshot rather than in the live tables.
        </p>
      )}
    </CreatorShell>
  )
}
