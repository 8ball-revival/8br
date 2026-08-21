'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { requireCapability, requireStaffActor } from './staff-auth'
import * as svc from './service'
import * as teamSvc from './teams'
import { createTournament, type CreateTournamentConfig } from './tournament-create'
import { normalizeFlair, type FlairInput } from './flair'
import * as fa from './free-agents'
import type { ClosingPlan, EligibleAccount, FreeAgentRow } from './free-agents'
import { captureTeamRatingsAtClose } from './team-ratings'
import { recordGroupResult, confirmQualifiersAndSeed } from './group-stage'
import * as gsetup from './group-setup'
import * as quals from './qualifiers'
import { startSwiss, recordSwissResult, pairNextRound, completeSwiss } from './swiss'
import { syncLiveTournamentToSnapshot } from './tournament-sync'
import { transitionTournamentState, requireTournamentState, bracketMatchesEntrants, type TournamentState } from './tournament-lifecycle'
import { isGroupsPlayoffs } from './match-format'
import { recordAudit } from './audit'
import { getCurrentUser } from '@/lib/account/auth'
import { invalidateRankings } from '@/lib/stats/invalidate-rankings'

export interface ActionResult {
  ok?: boolean
  error?: string
  message?: string
  /** Tab the workspace should switch to after a successful lifecycle action. */
  navigate?: 'bracket' | 'results' | 'groups'
}

/** Revalidate the tournament page + every snapshot-derived surface after a tournament edit. */
function revalidateTournament(number?: number | null) {
  if (number != null) revalidatePath(`/tournaments/${number}`)
  for (const p of ['/tournaments', '/hall-of-fame', '/players', '/records', '/seasons']) revalidatePath(p)
  // Tournaments feed the ladder too, so the cached AGGREGATE has to go. Listing '/rankings' here only
  // re-rendered the page, which then read the same stale rows straight back.
  invalidateRankings()
}

async function tournamentNumberOf(tournamentId: number): Promise<number | null> {
  const s = await prisma.tournament.findUnique({ where: { id: tournamentId }, select: { number: true } })
  return s?.number ?? null
}
async function cupNumberOfMatch(matchId: number): Promise<number | null> {
  const m = await prisma.playoffMatch.findUnique({ where: { id: matchId }, select: { tournament: { select: { number: true } } } })
  return m?.tournament.number ?? null
}
async function seasonIdOfMatch(matchId: number): Promise<number | null> {
  const m = await prisma.playoffMatch.findUnique({ where: { id: matchId }, select: { tournamentId: true } })
  return m?.tournamentId ?? null
}

// ---- Create ---------------------------------------------------------------

export async function createTournamentAction(cfg: CreateTournamentConfig): Promise<ActionResult & { number?: number }> {
  const actor = await requireCapability('manage_competitions')
  const res = await createTournament(actor, cfg)
  if (!res.ok) return { error: res.error }
  // "Start now" (the default) opens registration immediately via the lifecycle machine (which syncs
  // registrationStatus + audits). "Schedule for later" leaves it in DRAFT with registrationOpensAt set.
  if (res.startNow) {
    await transitionTournamentState(actor, res.id!, 'REGISTRATION_OPEN').catch(() => {})
  }
  await syncLiveTournamentToSnapshot(res.id!) // make the new tournament appear in the snapshot-backed list
  revalidateTournament(res.number)
  return { ok: true, number: res.number, message: `Created ${res.code} — Tournament ${res.number}.` }
}

// ---- Legacy conversion ----------------------------------------------------

// ---- Entrants (individual tournaments) ------------------------------------

export interface EntrantCandidate { playerId: string; primaryName: string; cueverseId: string | null }

export async function searchTournamentPlayersAction(tournamentId: number, query: string): Promise<EntrantCandidate[]> {
  await requireCapability('manage_competitions')
  const { searchEntrantCandidates } = await import('./queries')
  return searchEntrantCandidates(tournamentId, query)
}

/** Entrant management is only permitted while registration is open or closed (never once the
 *  bracket is generated, the tournament is in progress, or the tournament is completed/cancelled). */
const ENTRANT_STATES: TournamentState[] = ['REGISTRATION_OPEN', 'REGISTRATION_CLOSED']

export async function addTournamentEntrantsAction(tournamentId: number, playerIds: string[]): Promise<ActionResult> {
  const actor = await requireCapability('manage_competitions')
  const gate = await requireTournamentState(tournamentId, ENTRANT_STATES)
  if (!gate.ok) return { error: gate.error }
  let added = 0
  for (const id of playerIds) {
    const r = await svc.addEntrantByProfile(actor, tournamentId, id)
    if (r.ok && !r.already) added++
  }
  revalidateTournament(await tournamentNumberOf(tournamentId))
  return { ok: true, message: `Added ${added} entrant${added === 1 ? '' : 's'}.` }
}

// addManualEntrantAction (free-text "temporary entrant") was REMOVED: every entrant in a new cup
// must reference a permanent registered player. Use `addTournamentEntrantsAction` (Add Player) instead.
// The server-side service (svc.addManualEntrant) now refuses as a defense-in-depth backstop.

export async function removeTournamentEntrantAction(tournamentId: number, registrationId: number): Promise<ActionResult> {
  const actor = await requireCapability('manage_competitions')
  const gate = await requireTournamentState(tournamentId, ENTRANT_STATES)
  if (!gate.ok) return { error: gate.error }
  const r = await svc.removeEntrant(actor, tournamentId, registrationId)
  if (!r.ok) return { error: r.error }
  revalidateTournament(await tournamentNumberOf(tournamentId))
  return { ok: true }
}

export async function restoreTournamentEntrantAction(tournamentId: number, registrationId: number): Promise<ActionResult> {
  const actor = await requireCapability('manage_competitions')
  const gate = await requireTournamentState(tournamentId, ENTRANT_STATES)
  if (!gate.ok) return { error: gate.error }
  const r = await svc.restoreEntrant(actor, tournamentId, registrationId)
  if (!r.ok) return { error: r.error }
  revalidateTournament(await tournamentNumberOf(tournamentId))
  return { ok: true }
}

// ---- Settings -------------------------------------------------------------

/** Set the competition race length (games to win a match). Any positive integer; reused
 *  by score validation, standings, and displays across the whole event. */
export async function setTournamentRaceLengthAction(tournamentId: number, raceLength: number): Promise<ActionResult> {
  const actor = await requireCapability('manage_competitions')
  if (!Number.isInteger(raceLength) || raceLength < 1) return { error: 'Race length must be a positive whole number.' }
  // Group Stage + Playoffs has hard-coded, per-stage match lengths (10-game groups; Race to 7/9
  // playoffs) — there is no single configurable race length to set.
  const t = await prisma.tournament.findUnique({ where: { id: tournamentId }, select: { tournamentFormat: true } })
  if (isGroupsPlayoffs(t?.tournamentFormat)) return { error: 'Group Stage + Playoffs uses fixed match lengths (10-game groups, Race to 7/9 playoffs) and cannot be changed.' }
  const gate = await requireTournamentState(tournamentId, ['DRAFT', 'REGISTRATION_OPEN', 'REGISTRATION_CLOSED'])
  if (!gate.ok) return { error: gate.error }
  await svc.assertCompetitionUnlocked(prisma, tournamentId)
  await svc.updateSeason(actor, tournamentId, { raceLength })
  revalidateTournament(await tournamentNumberOf(tournamentId))
  return { ok: true, message: `Race length set to ${raceLength}.` }
}

/**
 * Set (or clear) the note shown under this tournament's playoff bracket.
 *
 * Mirrors the Season equivalent, including the deliberate lack of a lifecycle gate beyond
 * "a bracket exists": the note describes the bracket, and you usually only learn what needs
 * saying after the fact, often long after the tournament is finished.
 */
export async function setTournamentPlayoffDisclaimerAction(tournamentId: number, text: string | null): Promise<ActionResult> {
  const actor = await requireCapability('manage_competitions')
  const r = await svc.setTournamentPlayoffDisclaimer(actor, tournamentId, text)
  if (!r.ok) return { error: r.error }
  revalidateTournament(await tournamentNumberOf(tournamentId))
  return { ok: true, message: text?.trim() ? 'Note saved.' : 'Note removed.' }
}

// ---- Bracket --------------------------------------------------------------

/** States in which the bracket may be built, regenerated, or corrected: after registration closes
 *  and while it is generated-but-not-started. NEVER once the tournament is In Progress/Completed. */
const BRACKET_EDIT_STATES: TournamentState[] = ['REGISTRATION_CLOSED', 'BRACKET_GENERATED']

/** Active (non-withdrawn) entrant registration ids in default seed order (seed asc, then id). */
async function defaultSeedOrder(tournamentId: number): Promise<number[]> {
  const regs = await prisma.registration.findMany({
    where: { tournamentId, status: { not: 'WITHDRAWN' } },
    select: { id: true },
    orderBy: [{ seed: 'asc' }, { id: 'asc' }],
  })
  return regs.map((r) => r.id)
}

/**
 * PRIMARY "Generate Brackets" action (Overview). Validates enough eligible entrants, AUTO-CLOSES
 * registration if it is still open (persisted), then builds + publishes the bracket from the
 * registered entrants' permanent ids and moves the tournament to BRACKET_GENERATED. Navigates the admin to
 * the Bracket tab. Does NOT silently overwrite an up-to-date existing bracket (regeneration of a
 * stale bracket after re-opening is allowed; a matching one is left intact).
 */
export async function generateTournamentBracketAction(tournamentId: number): Promise<ActionResult> {
  const actor = await requireCapability('manage_competitions')
  // Random-draw tournaments use the dedicated, one-time atomic "Generate Teams" action instead —
  // never this manual path (backend enforcement, so a direct call can't bypass the RANDOM flow).
  const rnd = await prisma.tournament.findUnique({ where: { id: tournamentId }, select: { participantFormat: true, teamFormation: true } })
  if (rnd?.participantFormat === 'TEAM' && rnd.teamFormation === 'RANDOM') {
    return { error: 'Use “Generate Teams” for random-draw tournaments.' }
  }
  const gate = await requireTournamentState(tournamentId, ['REGISTRATION_OPEN', 'REGISTRATION_CLOSED', 'BRACKET_GENERATED'])
  if (!gate.ok) return { error: gate.error }

  // Don't silently overwrite: if a bracket already exists and still matches the entrants, keep it.
  if (gate.state === 'BRACKET_GENERATED') {
    const fresh = await bracketMatchesEntrants(tournamentId)
    if (fresh.ok) return { ok: true, message: 'Bracket is already generated and up to date.', navigate: 'bracket' }
    // else: stale (entrants changed after re-opening) → regenerate below.
  }

  // Auto-close registration first (persisted) so the bracket is built against a frozen field.
  if (gate.state === 'REGISTRATION_OPEN') {
    const close = await transitionTournamentState(actor, tournamentId, 'REGISTRATION_CLOSED')
    if (!close.ok) return { error: close.error }
  }

  // Random-draw teams: shuffle the solo entrants into teams (against the now-frozen field) before seeding.
  const asm = await teamSvc.ensureRandomTeamsAssembled(actor, tournamentId)
  if (!asm.ok) return { error: asm.error }
  const exc = await teamSvc.excludeIncompletePickTeams(actor, tournamentId)
  if (!exc.ok) return { error: exc.error }
  await captureTeamRatingsAtClose(tournamentId) // freeze member ratings for the team-details popover



  const order = await defaultSeedOrder(tournamentId)
  if (order.length < 2) return { error: 'Add at least 2 registered entrants before generating the bracket.' }

  // Replace any prior (stale/published) bracket, then build + publish the new one.
  const published = await prisma.playoffMatch.count({ where: { tournamentId, published: true } })
  if (published > 0) {
    const rd = await svc.returnPlayoffToDraft(actor, tournamentId)
    if (!rd.ok) return { error: rd.error }
  }
  await svc.reseedEntrants(actor, tournamentId, order)
  const fmt = await prisma.tournament.findUnique({ where: { id: tournamentId }, select: { tournamentFormat: true } })
  const built = await svc.rebuildManualPlayoff(actor, tournamentId, order, { doubleElim: fmt?.tournamentFormat === 'DOUBLE_ELIM' })
  if (!built.ok) return { error: built.error }
  const pub = await svc.publishPlayoff(actor, tournamentId)
  if (!pub.ok) return { error: pub.error }

  const cur = await requireTournamentState(tournamentId, ['REGISTRATION_CLOSED', 'BRACKET_GENERATED'])
  if (cur.ok && cur.state === 'REGISTRATION_CLOSED') {
    const t = await transitionTournamentState(actor, tournamentId, 'BRACKET_GENERATED')
    if (!t.ok) return { error: t.error }
  }
  await recordAudit(actor, { action: 'tournament.bracket.generate', entity: 'Tournament', entityId: tournamentId, newValue: { entrants: order.length } })
  revalidateTournament(await tournamentNumberOf(tournamentId))
  return { ok: true, message: 'Bracket generated. Review it, then Start Tournament.', navigate: 'bracket' }
}

/**
 * RANDOM-draw "Generate Teams" — the ONE-TIME, atomic team generation for teamFormation = RANDOM.
 * Runs only from REGISTRATION_CLOSED (registration is closed & validated as its own step first).
 * Draws balanced-random teams with unique names, seeds + publishes the bracket using the existing
 * generator (seeding + byes unchanged), and advances straight to live (no seeding-review step).
 * IDEMPOTENT: once teams are drawn and the bracket is published, it never draws again — a retry just
 * navigates to the bracket. A failure before the commit leaves nothing partial; a failure AFTER teams
 * are drawn but before the bracket publishes is recoverable by re-running (the draw no-ops, the
 * bracket completes) — so retries can never produce a second assignment.
 */
export async function generateRandomTeamsAction(tournamentId: number): Promise<ActionResult> {
  const actor = await requireCapability('manage_competitions')
  const t = await prisma.tournament.findUnique({ where: { id: tournamentId }, select: { participantFormat: true, teamFormation: true, tournamentFormat: true } })
  if (!(t?.participantFormat === 'TEAM' && t.teamFormation === 'RANDOM')) return { error: 'This action is only for random-draw team tournaments.' }

  // Idempotency: teams drawn AND bracket published → the operation already succeeded. Never redraw.
  const teamsExist = (await prisma.tournamentTeam.count({ where: { tournamentId } })) > 0
  const alreadyPublished = (await prisma.playoffMatch.count({ where: { tournamentId, published: true } })) > 0
  if (teamsExist && alreadyPublished) return { ok: true, message: 'Teams are already generated — the bracket is live.', navigate: 'bracket' }

  const gate = await requireTournamentState(tournamentId, ['REGISTRATION_CLOSED'])
  if (!gate.ok) return { error: gate.error }

  // 1) Draw balanced-random teams + unique names (atomic; idempotent no-op if already drawn).
  const asm = await teamSvc.assembleRandomTeams(actor, tournamentId)
  if (!asm.ok) return { error: asm.error }
  await captureTeamRatingsAtClose(tournamentId) // ratings already frozen at draw; no-op safety net

  // 2) Seed + build + publish the bracket from the generated teams (existing seeding & bye behavior).
  const order = await defaultSeedOrder(tournamentId)
  if (order.length < 2) return { error: 'Need at least two teams to generate the bracket.' }
  const priorPublished = await prisma.playoffMatch.count({ where: { tournamentId, published: true } })
  if (priorPublished > 0) {
    const rd = await svc.returnPlayoffToDraft(actor, tournamentId)
    if (!rd.ok) return { error: rd.error }
  }
  await svc.reseedEntrants(actor, tournamentId, order)
  const built = await svc.rebuildManualPlayoff(actor, tournamentId, order, { doubleElim: t.tournamentFormat === 'DOUBLE_ELIM' })
  if (!built.ok) return { error: built.error }
  const pub = await svc.publishPlayoff(actor, tournamentId)
  if (!pub.ok) return { error: pub.error }

  // 3) Advance to live. The direct CLOSED→IN_PROGRESS jump is blocked for non-Swiss, so step through
  //    BRACKET_GENERATED — RANDOM never pauses there for review.
  const g1 = await transitionTournamentState(actor, tournamentId, 'BRACKET_GENERATED')
  if (!g1.ok) return { error: g1.error }
  const g2 = await transitionTournamentState(actor, tournamentId, 'IN_PROGRESS')
  if (!g2.ok) return { error: g2.error }

  await recordAudit(actor, { action: 'tournament.team.generate', entity: 'Tournament', entityId: tournamentId, newValue: { teams: asm.teams } })
  revalidateTournament(await tournamentNumberOf(tournamentId))
  return { ok: true, message: `${asm.teams} teams generated — the bracket is live.`, navigate: 'bracket' }
}

// ---- Group Stage + Playoffs (GROUPS_PLAYOFFS format only) -------------------

/**
 * Open the Group Setup phase: close registration (if open), finalize teams, then create the empty
 * draft groups. Does NOT generate matches, publish, or start play — the Admin organizes the groups on
 * the (private) Group Setup board and then publishes. Stays in REGISTRATION_CLOSED.
 */
export async function startGroupStageAction(tournamentId: number): Promise<ActionResult> {
  const actor = await requireCapability('manage_competitions')
  const gate = await requireTournamentState(tournamentId, ['REGISTRATION_OPEN', 'REGISTRATION_CLOSED'])
  if (!gate.ok) return { error: gate.error }
  if (gate.state === 'REGISTRATION_OPEN') {
    const close = await transitionTournamentState(actor, tournamentId, 'REGISTRATION_CLOSED')
    if (!close.ok) return { error: close.error }
  }
  const asm = await teamSvc.ensureRandomTeamsAssembled(actor, tournamentId)
  if (!asm.ok) return { error: asm.error }
  const exc = await teamSvc.excludeIncompletePickTeams(actor, tournamentId)
  if (!exc.ok) return { error: exc.error }
  await captureTeamRatingsAtClose(tournamentId) // freeze member ratings for the team-details popover

  const t = await prisma.tournament.findUnique({ where: { id: tournamentId }, select: { groupCount: true } })
  const r = await gsetup.enterGroupSetup(actor, tournamentId, Math.max(1, t?.groupCount ?? 1))
  if (!r.ok) return { error: r.error }
  revalidateTournament(await tournamentNumberOf(tournamentId))
  return { ok: true, message: 'Group Setup ready — organize the groups, then publish to start the Group Stage.', navigate: 'groups' }
}

/** Draft-phase gate: Group Setup edits are only allowed before the Group Stage begins. */
async function requireGroupSetup(tournamentId: number): Promise<ActionResult | null> {
  const gate = await requireTournamentState(tournamentId, ['REGISTRATION_CLOSED'])
  if (!gate.ok) return { error: gate.error }
  if (await gsetup.groupsArePublished(tournamentId)) return { error: 'Groups are already published — reopen the draft to reorganize.' }
  return null
}

/** Move an entrant to a group (or to Unassigned when `toGroupId` is null). */
export async function moveGroupEntrantAction(tournamentId: number, registrationId: number, toGroupId: number | null): Promise<ActionResult> {
  const actor = await requireCapability('manage_competitions')
  const blocked = await requireGroupSetup(tournamentId)
  if (blocked) return blocked
  const r = await gsetup.moveEntrantToGroup(actor, tournamentId, registrationId, toGroupId)
  if (!r.ok) return { error: r.error }
  revalidateTournament(await tournamentNumberOf(tournamentId))
  return { ok: true, message: 'Saved.' }
}

/** Auto-assign every entrant evenly across the current groups (replaces the draft assignments). */
export async function autoAssignGroupsAction(tournamentId: number): Promise<ActionResult> {
  const actor = await requireCapability('manage_competitions')
  const blocked = await requireGroupSetup(tournamentId)
  if (blocked) return blocked
  const r = await gsetup.autoAssignGroups(actor, tournamentId)
  if (!r.ok) return { error: r.error }
  revalidateTournament(await tournamentNumberOf(tournamentId))
  return { ok: true, message: 'Entrants auto-assigned evenly.' }
}

/** Even out current group sizes (and place any Unassigned), preserving assignments where possible. */
export async function autoBalanceGroupsAction(tournamentId: number): Promise<ActionResult> {
  const actor = await requireCapability('manage_competitions')
  const blocked = await requireGroupSetup(tournamentId)
  if (blocked) return blocked
  const r = await gsetup.autoBalanceGroups(actor, tournamentId)
  if (!r.ok) return { error: r.error }
  revalidateTournament(await tournamentNumberOf(tournamentId))
  return { ok: true, message: 'Groups balanced.' }
}

/** Add an empty group to the draft (existing assignments are preserved). */
export async function addDraftGroupAction(tournamentId: number): Promise<ActionResult> {
  const actor = await requireCapability('manage_competitions')
  const blocked = await requireGroupSetup(tournamentId)
  if (blocked) return blocked
  const r = await svc.createGroup(actor, tournamentId)
  if (!r.ok) return { error: r.error }
  revalidateTournament(await tournamentNumberOf(tournamentId))
  return { ok: true, message: 'Group added.' }
}

/** Remove a draft group — its entrants return to Unassigned (never deleted). */
export async function removeDraftGroupAction(tournamentId: number, groupId: number): Promise<ActionResult> {
  const actor = await requireCapability('manage_competitions')
  const blocked = await requireGroupSetup(tournamentId)
  if (blocked) return blocked
  const r = await gsetup.removeDraftGroup(actor, tournamentId, groupId)
  if (!r.ok) return { error: r.error }
  revalidateTournament(await tournamentNumberOf(tournamentId))
  return { ok: true, message: r.returned > 0 ? `Group removed — ${r.returned} entrant${r.returned === 1 ? '' : 's'} back in Unassigned.` : 'Group removed.' }
}

/** Rename a draft group. */
export async function renameDraftGroupAction(tournamentId: number, groupId: number, name: string): Promise<ActionResult> {
  const actor = await requireCapability('manage_competitions')
  const blocked = await requireGroupSetup(tournamentId)
  if (blocked) return blocked
  const r = await svc.renameGroup(actor, tournamentId, groupId, name)
  if (!r.ok) return { error: r.error }
  revalidateTournament(await tournamentNumberOf(tournamentId))
  return { ok: true, message: 'Group renamed.' }
}

/** Adjust the target entrants-per-group (adds/removes empty groups; never drops entrants). */
export async function setGroupTargetAction(tournamentId: number, target: number): Promise<ActionResult> {
  const actor = await requireCapability('manage_competitions')
  const blocked = await requireGroupSetup(tournamentId)
  if (blocked) return blocked
  const r = await gsetup.setTargetPerGroup(actor, tournamentId, target)
  if (!r.ok) return { error: r.error }
  revalidateTournament(await tournamentNumberOf(tournamentId))
  return { ok: true, message: 'Target group size updated.' }
}

/** Publish the draft groups and start the Group Stage (validate → matches + standings → public → live). */
export async function publishGroupsAndStartAction(tournamentId: number): Promise<ActionResult> {
  const actor = await requireCapability('manage_competitions')
  const blocked = await requireGroupSetup(tournamentId)
  if (blocked) return blocked
  const r = await gsetup.publishGroupsAndStart(actor, tournamentId)
  if (!r.ok) return { error: r.error }
  revalidateTournament(await tournamentNumberOf(tournamentId))
  return { ok: true, message: 'Groups published — the Group Stage is live.', navigate: 'groups' }
}

/** Record (or correct) a group match result. Authoritative — verified + standings recompute. */
export async function recordGroupResultAction(matchId: number, home: number, away: number, reason?: string): Promise<ActionResult> {
  const actor = await requireCapability('edit_results')
  const r = await recordGroupResult(actor, matchId, home, away, reason)
  if (!r.ok) return { error: r.error }
  const match = await prisma.tournamentMatch.findUnique({ where: { id: matchId }, select: { tournamentId: true } })
  if (match) revalidateTournament(await tournamentNumberOf(match.tournamentId))
  return { ok: true, message: 'Result recorded.' }
}

/** Confirm the final qualifiers and seed them into the playoff bracket (single or double elim). */
/**
 * List every entrant with a standing, and whether they are going through.
 *
 * A read. Gated all the same: an unpublished group stage's standings are not public, and this is the
 * shape the qualifier review reads from.
 */
export async function listQualifiersAction(tournamentId: number) {
  await requireCapability('manage_competitions')
  return quals.listQualifiers(tournamentId)
}

/**
 * Override one entrant in or out of the playoffs — or clear the override and hand the decision back
 * to the calculation.
 *
 * Only while the group stage is running or closed. Once the bracket is generated the field is
 * already seated, and changing who qualified would leave the two disagreeing; the bracket is
 * returned to draft first, which is a separate deliberate act.
 */
export async function setQualifierOverrideAction(
  tournamentId: number,
  registrationId: number,
  override: boolean | null,
): Promise<ActionResult> {
  const actor = await requireCapability('manage_competitions')
  const gate = await requireTournamentState(tournamentId, ['GROUPS_IN_PROGRESS'])
  if (!gate.ok) return { error: gate.error }
  if (override !== true && override !== false && override !== null) return { error: 'Say whether the entrant is in, out, or unset.' }
  const r = await quals.setQualifierOverride(actor, tournamentId, registrationId, override)
  if (!r.ok) return { error: r.error }
  revalidateTournament(await tournamentNumberOf(tournamentId))
  return { ok: true, message: override == null ? 'Back to the calculated result.' : override ? 'Marked as qualifying.' : 'Marked as not qualifying.' }
}

export async function confirmQualifiersAction(tournamentId: number): Promise<ActionResult> {
  const actor = await requireCapability('manage_competitions')
  const gate = await requireTournamentState(tournamentId, ['GROUPS_IN_PROGRESS'])
  if (!gate.ok) return { error: gate.error }
  const r = await confirmQualifiersAndSeed(actor, tournamentId)
  if (!r.ok) return { error: r.error }
  revalidateTournament(await tournamentNumberOf(tournamentId))
  return { ok: true, message: 'Qualifiers seeded into a draft bracket — review who’s in and the seeding on the Bracket tab, then publish and start the playoffs.', navigate: 'bracket' }
}

// ---- Swiss ----------------------------------------------------------------

/** Start the Swiss rounds (closes registration first if still open), generating round 1. */
export async function startSwissAction(tournamentId: number): Promise<ActionResult> {
  const actor = await requireCapability('manage_competitions')
  const gate = await requireTournamentState(tournamentId, ['REGISTRATION_OPEN', 'REGISTRATION_CLOSED'])
  if (!gate.ok) return { error: gate.error }
  if (gate.state === 'REGISTRATION_OPEN') {
    const close = await transitionTournamentState(actor, tournamentId, 'REGISTRATION_CLOSED')
    if (!close.ok) return { error: close.error }
  }
  const asm = await teamSvc.ensureRandomTeamsAssembled(actor, tournamentId)
  if (!asm.ok) return { error: asm.error }
  const exc = await teamSvc.excludeIncompletePickTeams(actor, tournamentId)
  if (!exc.ok) return { error: exc.error }
  await captureTeamRatingsAtClose(tournamentId) // freeze member ratings for the team-details popover


  const r = await startSwiss(actor, tournamentId)
  if (!r.ok) return { error: r.error }
  revalidateTournament(await tournamentNumberOf(tournamentId))
  return { ok: true, message: 'Swiss started — round 1 paired.', navigate: 'results' }
}

/** Record (or correct) a Swiss match result. */
export async function recordSwissResultAction(matchId: number, home: number, away: number, reason?: string): Promise<ActionResult> {
  const actor = await requireCapability('edit_results')
  const r = await recordSwissResult(actor, matchId, home, away, reason)
  if (!r.ok) return { error: r.error }
  const m = await prisma.swissMatch.findUnique({ where: { id: matchId }, select: { tournamentId: true } })
  if (m) revalidateTournament(await tournamentNumberOf(m.tournamentId))
  return { ok: true, message: 'Result recorded.' }
}

/** Pair the next Swiss round (requires the current round fully reported). */
export async function pairSwissRoundAction(tournamentId: number): Promise<ActionResult> {
  const actor = await requireCapability('manage_competitions')
  const r = await pairNextRound(actor, tournamentId)
  if (!r.ok) return { error: r.error }
  revalidateTournament(await tournamentNumberOf(tournamentId))
  return { ok: true, message: `Round ${r.round} paired.`, navigate: 'results' }
}

/** Finish a Swiss tournament (requires all rounds reported); applies the individual Rankings update. */
export async function completeSwissAction(tournamentId: number): Promise<ActionResult> {
  const actor = await requireCapability('manage_competitions')
  const r = await completeSwiss(actor, tournamentId)
  if (!r.ok) return { error: r.error }
  revalidateTournament(await tournamentNumberOf(tournamentId))
  return { ok: true, message: 'Swiss complete — Rankings updated.' }
}

// ---- Flair (per-tournament + per-admin default) ---------------------------

/** Edit a tournament's flair later (badge + description). Sanitized/validated server-side.
 *  Passing empty/nulls clears it. (Per-tournament colors/banners were removed — theming is a
 *  personal account preference now.) */
export async function updateTournamentFlairAction(tournamentId: number, flair: FlairInput): Promise<ActionResult> {
  const actor = await requireCapability('manage_competitions')
  const norm = normalizeFlair(flair)
  if (!norm.ok) return { error: norm.error }
  const v = norm.value!
  await prisma.tournament.update({ where: { id: tournamentId }, data: { description: v.description, badge: v.badge } })
  await recordAudit(actor, { action: 'tournament.flair.update', entity: 'Tournament', entityId: tournamentId, newValue: v })
  await syncLiveTournamentToSnapshot(tournamentId)
  revalidateTournament(await tournamentNumberOf(tournamentId))
  return { ok: true, message: 'Tournament flair updated.' }
}

/** Save the given flair as THIS admin's default (applied as the starting point for new tournaments). */
export async function saveFlairDefaultAction(flair: FlairInput): Promise<ActionResult> {
  const actor = await requireCapability('manage_competitions')
  const norm = normalizeFlair(flair)
  if (!norm.ok) return { error: norm.error }
  const v = norm.value!
  await prisma.tournamentFlairDefault.upsert({ where: { userId: actor.userId }, update: { description: v.description, badge: v.badge }, create: { userId: actor.userId, description: v.description, badge: v.badge } })
  return { ok: true, message: 'Saved as your default flair.' }
}

/** This admin's saved default flair (for prefilling the create form), or null. */
export async function getFlairDefaultAction(): Promise<FlairInput | null> {
  const actor = await requireCapability('manage_competitions')
  const d = await prisma.tournamentFlairDefault.findUnique({ where: { userId: actor.userId } })
  if (!d) return null
  return { description: d.description, badge: d.badge }
}

// ---- Admin team roster management + Free Agents ----------------------------

export async function listEligibleAccountsAction(tournamentId: number): Promise<EligibleAccount[]> {
  await requireCapability('manage_competitions')
  return fa.listEligibleAccounts(tournamentId)
}

export async function listFreeAgentsAction(tournamentId: number): Promise<FreeAgentRow[]> {
  await requireCapability('manage_competitions')
  return fa.listFreeAgents(tournamentId, 'WAITING')
}

export async function adminCreateTeamWithPlayersAction(tournamentId: number, name: string, memberUserIds: number[]): Promise<ActionResult> {
  const actor = await requireCapability('manage_competitions')
  const r = await fa.adminCreateTeamWithPlayers(actor, tournamentId, name, memberUserIds)
  if (!r.ok) return { error: r.error }
  revalidateTournament(await tournamentNumberOf(tournamentId))
  return { ok: true, message: 'Team created.' }
}

export async function adminAddTeamMemberAction(tournamentId: number, teamId: number, userId: number): Promise<ActionResult> {
  const actor = await requireCapability('manage_competitions')
  const r = await fa.adminAddMember(actor, tournamentId, teamId, userId)
  if (!r.ok) return { error: r.error }
  revalidateTournament(await tournamentNumberOf(tournamentId))
  return { ok: true, message: 'Player added.' }
}

export async function adminRemoveTeamMemberAction(tournamentId: number, teamId: number, userId: number): Promise<ActionResult> {
  const actor = await requireCapability('manage_competitions')
  const r = await fa.adminRemoveMember(actor, tournamentId, teamId, userId)
  if (!r.ok) return { error: r.error }
  revalidateTournament(await tournamentNumberOf(tournamentId))
  return { ok: true, message: 'Player removed.' }
}

export async function adminReplaceTeamMemberAction(tournamentId: number, teamId: number, oldUserId: number, newUserId: number): Promise<ActionResult> {
  const actor = await requireCapability('manage_competitions')
  const r = await fa.adminReplaceMember(actor, tournamentId, teamId, oldUserId, newUserId)
  if (!r.ok) return { error: r.error }
  revalidateTournament(await tournamentNumberOf(tournamentId))
  return { ok: true, message: 'Player replaced.' }
}

/** Compute the close-registration allocation PREVIEW (pure — nothing changes). */
export async function previewCloseAllocationAction(tournamentId: number): Promise<{ ok: boolean; error?: string; plan?: ClosingPlan }> {
  await requireCapability('manage_competitions')
  return fa.computeClosingPlan(tournamentId)
}

/** Confirm the close: allocate free agents, create teams, mark unplaced, close + lock — one transaction. */
export async function confirmCloseAllocationAction(tournamentId: number): Promise<ActionResult> {
  const actor = await requireCapability('manage_competitions')
  const r = await fa.applyClosingPlan(actor, tournamentId)
  if (!r.ok) return { error: r.error }
  revalidateTournament(await tournamentNumberOf(tournamentId))
  return { ok: true, message: `Registration closed — ${r.plan?.finalTeams ?? 0} teams entered.` }
}

/**
 * Re-open registration (a first-class toggle, NOT a recovery) before the tournament is live. Allowed from
 * Registration Closed or Bracket Generated. Re-opening from Bracket Generated warns that the
 * existing bracket may become outdated — the bracket rows are kept, but the tournament can only be started
 * again after a fresh, matching bracket is generated (enforced by Start Tournament's staleness check).
 * Once the tournament is live, registration is permanently locked and this is refused server-side.
 */
export async function reopenTournamentRegistrationAction(tournamentId: number): Promise<ActionResult> {
  const actor = await requireCapability('manage_competitions')
  const gate = await requireTournamentState(tournamentId, ['REGISTRATION_CLOSED', 'BRACKET_GENERATED'])
  if (!gate.ok) return { error: gate.error }
  const hadBracket = gate.state === 'BRACKET_GENERATED'
  const r = await transitionTournamentState(actor, tournamentId, 'REGISTRATION_OPEN', hadBracket ? { reason: 'Re-opened after bracket generation' } : {})
  if (!r.ok) return { error: r.error }
  revalidateTournament(await tournamentNumberOf(tournamentId))
  return {
    ok: true,
    message: hadBracket
      ? 'Registration re-opened. The previous bracket is now outdated — regenerate it before starting the tournament.'
      : 'Registration re-opened.',
  }
}

/**
 * Build/rebuild the draft bracket from an ordered seed list. Allowed only in REGISTRATION_CLOSED
 * (initial generation) or BRACKET_GENERATED (regeneration during pre-start review). If a bracket is
 * already published, it is returned to draft first so it can be rebuilt. Byes for non-power-of-two
 * fields are created and auto-advanced by the bracket planner. Records a distinct
 * generated/regenerated audit event for the tournament history.
 */
export async function buildTournamentBracketAction(tournamentId: number, orderedRegistrationIds: number[]): Promise<ActionResult> {
  const actor = await requireCapability('manage_competitions')
  const gate = await requireTournamentState(tournamentId, BRACKET_EDIT_STATES)
  if (!gate.ok) return { error: gate.error }
  const regenerated = gate.state === 'BRACKET_GENERATED'
  // Regeneration: the current bracket is published — return it to draft so it can be rebuilt.
  if (regenerated) {
    const published = await prisma.playoffMatch.count({ where: { tournamentId, published: true } })
    if (published > 0) {
      const rd = await svc.returnPlayoffToDraft(actor, tournamentId)
      if (!rd.ok) return { error: rd.error }
    }
  }
  await svc.reseedEntrants(actor, tournamentId, orderedRegistrationIds)
  const r = await svc.rebuildManualPlayoff(actor, tournamentId, orderedRegistrationIds)
  if (!r.ok) return { error: r.error }
  await recordAudit(actor, { action: 'tournament.bracket.generate', entity: 'Tournament', entityId: tournamentId, newValue: { regenerated } })
  revalidateTournament(await tournamentNumberOf(tournamentId))
  return { ok: true, message: regenerated ? 'Bracket regenerated (draft).' : 'Draft bracket built.' }
}

/**
 * Drag-and-drop placement into a first-round bracket position, while the bracket is a draft.
 *
 * Distinct from buildTournamentBracketAction, which reseeds the whole field from an ordered list.
 * This moves one player into one position, which an ordered list cannot express once byes exist.
 */
export async function setTournamentBracketSlotAction(
  tournamentId: number,
  matchId: number,
  side: 'home' | 'away',
  registrationId: number | null,
): Promise<ActionResult> {
  const actor = await requireCapability('manage_competitions')
  const gate = await requireTournamentState(tournamentId, BRACKET_EDIT_STATES)
  if (!gate.ok) return { error: gate.error }
  const r = await svc.setTournamentBracketSlot(actor, tournamentId, matchId, side, registrationId)
  if (!r.ok) return { error: r.error }
  revalidateTournament(await tournamentNumberOf(tournamentId))
  return { ok: true }
}

/**
 * Publish the generated bracket so it is publicly visible. This does NOT begin the tournament —
 * it moves REGISTRATION_CLOSED → BRACKET_GENERATED (bracket visible, reporting/scoring still off;
 * admins may review + regenerate). Re-publishing after a regeneration keeps the state.
 */
export async function publishTournamentBracketAction(tournamentId: number): Promise<ActionResult> {
  const actor = await requireCapability('manage_competitions')
  const gate = await requireTournamentState(tournamentId, BRACKET_EDIT_STATES)
  if (!gate.ok) return { error: gate.error }
  const r = await svc.publishPlayoff(actor, tournamentId)
  if (!r.ok) return { error: r.error }
  if (gate.state === 'REGISTRATION_CLOSED') {
    const t = await transitionTournamentState(actor, tournamentId, 'BRACKET_GENERATED')
    if (!t.ok && t.error) return { error: t.error }
  }
  revalidateTournament(await tournamentNumberOf(tournamentId))
  return { ok: true, message: 'Bracket published. Review it, then Begin Tournament to start play.' }
}

/**
 * Explicitly begin the tournament: BRACKET_GENERATED → IN_PROGRESS. Requires a generated (published)
 * bracket. From here registration + withdrawals stay locked, entrant management is gone, and match
 * reporting/scoring are enabled. The UI requires a confirmation before calling this.
 */
export async function beginTournamentAction(tournamentId: number): Promise<ActionResult> {
  const actor = await requireCapability('manage_competitions')
  const gate = await requireTournamentState(tournamentId, ['BRACKET_GENERATED'])
  if (!gate.ok) return { error: gate.error }
  const published = await prisma.playoffMatch.count({ where: { tournamentId, published: true } })
  if (published === 0) return { error: 'Publish the generated bracket before beginning the tournament.' }
  // Refuse to start on a stale bracket (entrants changed after it was generated).
  const fresh = await bracketMatchesEntrants(tournamentId)
  if (!fresh.ok) return { error: `${fresh.reason} Regenerate the bracket before starting the tournament.` }
  const t = await transitionTournamentState(actor, tournamentId, 'IN_PROGRESS')
  if (!t.ok) return { error: t.error }
  revalidateTournament(await tournamentNumberOf(tournamentId))
  // TournamentView is live: registration is permanently locked; match reporting is enabled → Results tab.
  return { ok: true, message: 'The tournament is live. Registration is locked and results can be reported.', navigate: 'results' }
}

export async function returnTournamentBracketToDraftAction(tournamentId: number): Promise<ActionResult> {
  const actor = await requireCapability('manage_competitions')
  const gate = await requireTournamentState(tournamentId, BRACKET_EDIT_STATES)
  if (!gate.ok) return { error: gate.error }
  const r = await svc.returnPlayoffToDraft(actor, tournamentId)
  if (!r.ok) return { error: r.error }
  revalidateTournament(await tournamentNumberOf(tournamentId))
  return { ok: true, message: 'Bracket returned to draft for editing.' }
}

/** Delete the (unstarted) bracket. If the tournament had advanced to BRACKET_GENERATED, this scraps the
 *  bracket and returns it to REGISTRATION_CLOSED so entrants can be corrected. */
export async function deleteTournamentBracketAction(tournamentId: number): Promise<ActionResult> {
  const actor = await requireCapability('manage_competitions')
  const gate = await requireTournamentState(tournamentId, BRACKET_EDIT_STATES)
  if (!gate.ok) return { error: gate.error }
  const r = await svc.deletePlayoff(actor, tournamentId)
  if (!r.ok) return { error: r.error }
  if (gate.state === 'BRACKET_GENERATED') {
    // Backward correction within the pre-start review phase (audited via transitionTournamentState).
    await transitionTournamentState(actor, tournamentId, 'REGISTRATION_CLOSED', { recovery: true, reason: 'Bracket deleted before start' })
  }
  revalidateTournament(await tournamentNumberOf(tournamentId))
  return { ok: true, message: 'Bracket deleted.' }
}

// ---- Results --------------------------------------------------------------

export async function recordTournamentScoreAction(matchId: number, home: number, away: number, reason?: string): Promise<ActionResult> {
  const actor = await requireCapability('edit_results')
  const sid = await seasonIdOfMatch(matchId)
  if (sid) { const gate = await requireTournamentState(sid, ['IN_PROGRESS']); if (!gate.ok) return { error: gate.error } }
  const r = await svc.recordPlayoffScore(actor, matchId, home, away, reason)
  if (!r.ok) return { error: r.error }
  // Auto-verify to advance the winner immediately (admin editor is authoritative).
  await svc.verifyPlayoffMatch(actor, matchId, reason)
  const tournamentId = await seasonIdOfMatch(matchId)
  if (tournamentId) await syncLiveTournamentToSnapshot(tournamentId) // published/converted cups: keep rankings current
  revalidateTournament(await cupNumberOfMatch(matchId))
  return { ok: true, message: 'Result saved and winner advanced.' }
}

/**
 * Record a forfeit on a bracket match.
 *
 * Same capability, same lifecycle gate and same follow-through as a numeric result: the opponent is
 * advanced by the ordinary verify path, and the snapshot is resynced so the Rankings reflect the
 * change. What differs is only what gets stored — see recordPlayoffForfeit.
 */
export async function recordTournamentForfeitAction(matchId: number, forfeiter: 'home' | 'away', reason?: string): Promise<ActionResult> {
  const actor = await requireCapability('edit_results')
  if (forfeiter !== 'home' && forfeiter !== 'away') return { error: 'Say which side forfeited.' }
  const sid = await seasonIdOfMatch(matchId)
  if (sid) { const gate = await requireTournamentState(sid, ['IN_PROGRESS']); if (!gate.ok) return { error: gate.error } }
  const r = await svc.recordPlayoffForfeit(actor, matchId, forfeiter, reason)
  if (!r.ok) return { error: r.error }
  // The opponent advances through the ordinary path — structurally identical to a win, which is the
  // point: the bracket does not care why the slot emptied.
  await svc.verifyPlayoffMatch(actor, matchId, reason)
  const tournamentId = await seasonIdOfMatch(matchId)
  if (tournamentId) await syncLiveTournamentToSnapshot(tournamentId)
  revalidateTournament(await cupNumberOfMatch(matchId))
  return { ok: true, message: 'Forfeit recorded and the opponent advanced.' }
}

export async function undoTournamentResultAction(matchId: number, reason?: string): Promise<ActionResult> {
  const actor = await requireCapability('edit_results')
  const sid = await seasonIdOfMatch(matchId)
  if (sid) { const gate = await requireTournamentState(sid, ['IN_PROGRESS']); if (!gate.ok) return { error: gate.error } }
  const r = await svc.undoPlayoffResult(actor, matchId, reason)
  if (!r.ok) return { error: r.error }
  const tournamentId = await seasonIdOfMatch(matchId)
  if (tournamentId) await syncLiveTournamentToSnapshot(tournamentId) // published/converted cups: keep rankings current
  revalidateTournament(await cupNumberOfMatch(matchId))
  return { ok: true, message: 'Result undone.' }
}

export async function setTournamentMatchNoteAction(matchId: number, note: string): Promise<ActionResult> {
  const actor = await requireCapability('edit_results')
  const sid = await seasonIdOfMatch(matchId)
  if (sid) { const gate = await requireTournamentState(sid, ['BRACKET_GENERATED', 'IN_PROGRESS']); if (!gate.ok) return { error: gate.error } }
  const r = await svc.setPlayoffNote(actor, matchId, note)
  if (!r.ok) return { error: r.error }
  revalidateTournament(await cupNumberOfMatch(matchId))
  return { ok: true }
}

// ---- Teams (2v2 / team cups) ----------------------------------------------

export async function createTeamAction(tournamentId: number, name: string): Promise<ActionResult & { teamId?: number }> {
  const actor = await requireCapability('manage_competitions')
  const r = await teamSvc.createTeam(actor, tournamentId, name)
  if (!r.ok) return { error: r.error }
  revalidateTournament(await tournamentNumberOf(tournamentId))
  return { ok: true, teamId: r.teamId }
}

export async function setTeamMembersAction(teamId: number, members: teamSvc.TeamMemberInput[]): Promise<ActionResult> {
  const actor = await requireCapability('manage_competitions')
  const r = await teamSvc.setTeamMembers(actor, teamId, members)
  if (!r.ok) return { error: r.error }
  const t = await prisma.tournamentTeam.findUnique({ where: { id: teamId }, select: { tournamentId: true } })
  revalidateTournament(t ? await tournamentNumberOf(t.tournamentId) : null)
  return { ok: true, message: 'Roster saved.' }
}

export async function renameTeamAction(teamId: number, name: string): Promise<ActionResult> {
  const actor = await requireCapability('manage_competitions')
  const r = await teamSvc.renameTeam(actor, teamId, name)
  if (!r.ok) return { error: r.error }
  const t = await prisma.tournamentTeam.findUnique({ where: { id: teamId }, select: { tournamentId: true } })
  revalidateTournament(t ? await tournamentNumberOf(t.tournamentId) : null)
  return { ok: true }
}

export async function withdrawTeamAction(teamId: number): Promise<ActionResult> {
  const actor = await requireCapability('manage_competitions')
  const r = await teamSvc.withdrawTeam(actor, teamId)
  if (!r.ok) return { error: r.error }
  const t = await prisma.tournamentTeam.findUnique({ where: { id: teamId }, select: { tournamentId: true } })
  revalidateTournament(t ? await tournamentNumberOf(t.tournamentId) : null)
  return { ok: true }
}

export async function restoreTeamAction(teamId: number): Promise<ActionResult> {
  const actor = await requireCapability('manage_competitions')
  const r = await teamSvc.restoreTeam(actor, teamId)
  if (!r.ok) return { error: r.error }
  const t = await prisma.tournamentTeam.findUnique({ where: { id: teamId }, select: { tournamentId: true } })
  revalidateTournament(t ? await tournamentNumberOf(t.tournamentId) : null)
  return { ok: true }
}

export async function deleteTeamAction(teamId: number): Promise<ActionResult> {
  const actor = await requireCapability('manage_competitions')
  const t = await prisma.tournamentTeam.findUnique({ where: { id: teamId }, select: { tournamentId: true } })
  const r = await teamSvc.deleteTeam(actor, teamId)
  if (!r.ok) return { error: r.error }
  revalidateTournament(t ? await tournamentNumberOf(t.tournamentId) : null)
  return { ok: true }
}

// ---- Lifecycle ------------------------------------------------------------

/** Explicit cup state transition (Admin+). Enforces the valid-transition matrix, completion
 *  gate, legacy-field sync, idempotent ladder, and audit — all in the lifecycle service. */
export async function setTournamentStateAction(tournamentId: number, to: TournamentState, reason?: string): Promise<ActionResult> {
  const actor = await requireCapability('manage_competitions')
  const r = await transitionTournamentState(actor, tournamentId, to, { reason })
  if (!r.ok) return { error: r.error }
  revalidateTournament(await tournamentNumberOf(tournamentId))
  return { ok: true, message: `Tournament is now ${to.replace(/_/g, ' ').toLowerCase()}.` }
}

/** OWNER-only recovery transition (an otherwise-invalid skip/backwards move), audited distinctly. */
export async function recoverTournamentStateAction(tournamentId: number, to: TournamentState, reason: string): Promise<ActionResult> {
  const actor = await requireOwnerActor()
  if (!reason?.trim()) return { error: 'A reason is required for a recovery transition.' }
  const r = await transitionTournamentState(actor, tournamentId, to, { reason, recovery: true })
  if (!r.ok) return { error: r.error }
  revalidateTournament(await tournamentNumberOf(tournamentId))
  return { ok: true, message: `Recovery applied — tournament set to ${to.replace(/_/g, ' ').toLowerCase()}.` }
}

/** Complete the tournament (state → COMPLETED). The lifecycle service validates the Final has a
 *  winner + no required match is open, records placements, applies the ladder once, and audits. */
export async function completeTournamentAction(tournamentId: number, reason?: string): Promise<ActionResult> {
  const actor = await requireCapability('manage_competitions')
  const r = await transitionTournamentState(actor, tournamentId, 'COMPLETED', { reason })
  if (!r.ok) return { error: r.error }
  revalidateTournament(await tournamentNumberOf(tournamentId))
  return { ok: true, message: 'Tournament completed. Winner recorded; rankings and records updated.' }
}

// ---- Player self-report (member) ------------------------------------------

/**
 * A MATCH PARTICIPANT reports their OWN LOSS (never a win). Server-side: verifies the caller is
 * in the match, the tournament is IN_PROGRESS, and the match is undecided; then records the opponent as
 * the winner (race-length) and advances the bracket. Duplicate/conflicting submissions are
 * rejected. Players can never report themselves as the winner (enforced structurally).
 */
export async function reportTournamentLossAction(matchId: number, myGamesWon: number): Promise<ActionResult> {
  const user = await getCurrentUser()
  if (!user) return { error: 'Please sign in to report your result.' }
  const { reportOwnLoss } = await import('./service')
  const r = await reportOwnLoss(Number(user.id), user.username, matchId, myGamesWon)
  if (!r.ok) return { error: r.error }
  const tournamentId = await seasonIdOfMatch(matchId)
  if (tournamentId) await syncLiveTournamentToSnapshot(tournamentId)
  revalidateTournament(await cupNumberOfMatch(matchId))
  return { ok: true, message: 'Your loss was reported and your opponent advanced.' }
}

/**
 * Permanently delete a LIVE cup and everything under it (entrants, teams, bracket,
 * results) — cascades via the Tournament row. Blocked for imported historical cups (those
 * are protected; an Owner must unlock, and even then they are not deletable here).
 * Requires typing the competition code to confirm. Regenerates the snapshot after.
 */
export async function deleteTournamentAction(tournamentId: number, typedCode: string): Promise<ActionResult> {
  const actor = await requireCapability('manage_competitions')
  const s = await prisma.tournament.findUnique({ where: { id: tournamentId } })
  if (!s) return { error: 'Tournament not found.' }
  if (typedCode.trim() !== (s.code ?? '')) return { error: `Confirmation code does not match. Type ${s.code} to confirm deletion.` }

  const code = s.code
  const number = s.number
  await prisma.tournament.delete({ where: { id: tournamentId } }) // cascades registrations, teams, playoff matches, bracket rows
  const { recordAudit } = await import('./audit')
  await recordAudit(actor, { action: 'tournament.delete', entity: 'Tournament', entityId: tournamentId, oldValue: { name: s.name, code, number } })
  const { regenerateTournamentSnapshot } = await import('@/lib/tournaments/migrate') // rebuild the snapshot without the deleted cup
  await regenerateTournamentSnapshot()
  revalidateTournament(number)
  return { ok: true, message: `Deleted ${code} — Tournament ${number}.` }
}

export async function archiveTournamentAction(tournamentId: number, reason?: string): Promise<ActionResult> {
  const actor = await requireCapability('manage_competitions')
  const r = await svc.archiveCompetition(actor, tournamentId, reason)
  if (!r.ok) return { error: r.error }
  revalidateTournament(await tournamentNumberOf(tournamentId))
  return { ok: true, message: 'Tournament archived.' }
}

export async function unarchiveTournamentAction(tournamentId: number, reason?: string): Promise<ActionResult> {
  const actor = await requireCapability('manage_competitions')
  const r = await svc.unarchiveCompetition(actor, tournamentId, reason)
  if (!r.ok) return { error: r.error }
  revalidateTournament(await tournamentNumberOf(tournamentId))
  return { ok: true, message: 'Tournament restored from archive.' }
}

// ---- Owner-only historical unlock / relock --------------------------------

async function requireOwnerActor() {
  const actor = await requireStaffActor()
  if (!actor.isOwner) throw new Error('Forbidden: only the Owner can unlock or relock historical competitions.')
  return actor
}

export async function unlockHistoricalTournamentAction(tournamentId: number, typedCode: string, reason: string): Promise<ActionResult> {
  const actor = await requireOwnerActor()
  const r = await svc.unlockHistoricalCompetition(actor, tournamentId, typedCode, reason)
  if (!r.ok) return { error: r.error }
  revalidateTournament(await tournamentNumberOf(tournamentId))
  return { ok: true, message: 'Historical tournament unlocked for editing.' }
}

export async function relockHistoricalTournamentAction(tournamentId: number, reason?: string): Promise<ActionResult> {
  const actor = await requireOwnerActor()
  const r = await svc.relockCompetition(actor, tournamentId, reason)
  if (!r.ok) return { error: r.error }
  revalidateTournament(await tournamentNumberOf(tournamentId))
  return { ok: true, message: 'Historical tournament re-locked.' }
}
