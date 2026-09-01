'use server'

import { revalidatePath } from 'next/cache'
import { requireCapability } from '@/lib/competition/staff-auth'
import { getCurrentUser } from '@/lib/account/auth'
import { getProfileByUserId } from '@/lib/players/service'
import {
  createSeason,
  addSeasonEntrant,
  removeSeasonEntrant,
  searchSeasonCandidates,
  closeRegistration,
  registerSelf,
  type CreateSeasonConfig,
  type SeasonCandidate,
} from './service'
import * as grp from './groups'
import * as gs from './group-stage'
import * as po from './playoffs'
import { closeSeason } from './close'
import { deleteSeason, planSeasonDeletion } from './admin'
import { prisma } from '@/lib/prisma'
import { invalidateRankings } from '@/lib/stats/invalidate-rankings'
import { invalidateAchievements } from '@/lib/achievements/service'

export interface SeasonActionResult {
  ok?: boolean
  error?: string
  message?: string
  /** On a Season-number conflict: the next free number, so the form can offer it. */
  suggestion?: number
}

/** Season pages are addressed by database id, so that is what gets revalidated. */
/**
 * Refresh everything a Season edit can change — including the Rankings AGGREGATE.
 *
 * Revalidating the paths alone was the trap `invalidate-rankings` warns about: the page re-renders
 * and reads the same cached rows straight back, so a group result or a playoff score entered here
 * did not reach the ladder until the five-minute window happened to lapse. The Tournament side has
 * always folded the tag in; the Season side, which is where most ranked matches are actually
 * recorded, did not — only closing or deleting a Season ever cleared it.
 *
 * Every Season edit clears it now rather than the handful somebody judged to be ranking-relevant.
 * The cost of being wrong in that judgement is a table showing figures that are quietly out of
 * date; the cost of being over-eager is one recomputed aggregate.
 */
function revalidateSeason(seasonId?: number | null) {
  if (seasonId != null) revalidatePath(`/seasons/${seasonId}`)
  revalidatePath('/seasons')
  invalidateRankings()
}

// ---- Creation -------------------------------------------------------------

export async function createSeasonAction(
  cfg: CreateSeasonConfig,
): Promise<SeasonActionResult & { id?: number; number?: number }> {
  const actor = await requireCapability('manage_competitions')
  const res = await createSeason(actor, cfg)
  // A conflict comes back with a fresh suggestion so the form can offer it without losing the rest
  // of what was typed.
  if (!res.ok || res.id == null) return { error: res.error ?? 'Could not create the Season.', suggestion: res.suggestion }
  revalidateSeason(res.id)
  return { ok: true, id: res.id, number: res.number, message: `Created Season ${res.number}.` }
}

/** The next free Season number for a Competition and year — what the create form suggests. */
export async function suggestSeasonNumberAction(competitionSeriesId: number, competitionYear: number): Promise<number> {
  await requireCapability('manage_competitions')
  const { suggestSeasonNumber } = await import('./numbering')
  return suggestSeasonNumber(competitionSeriesId, competitionYear)
}

// ---- Registration (admin) -------------------------------------------------

export async function searchSeasonPlayersAction(seasonId: number, query: string): Promise<SeasonCandidate[]> {
  await requireCapability('manage_registrations')
  return searchSeasonCandidates(seasonId, query)
}

export async function addSeasonEntrantAction(seasonId: number, playerId: string): Promise<SeasonActionResult> {
  const actor = await requireCapability('manage_registrations')
  const res = await addSeasonEntrant(actor, seasonId, playerId)
  if (!res.ok) return { error: res.error }
  revalidateSeason(seasonId)
  return { ok: true, message: 'Added 1 entrant.' }
}

export async function removeSeasonEntrantAction(seasonId: number, entrantId: number): Promise<SeasonActionResult> {
  const actor = await requireCapability('manage_registrations')
  const res = await removeSeasonEntrant(actor, seasonId, entrantId)
  if (!res.ok) return { error: res.error }
  revalidateSeason(seasonId)
  return { ok: true, message: 'Entrant removed.' }
}

export async function closeSeasonRegistrationAction(seasonId: number): Promise<SeasonActionResult> {
  const actor = await requireCapability('manage_competitions')
  const res = await closeRegistration(actor, seasonId)
  if (!res.ok) return { error: res.error }
  revalidateSeason(seasonId)
  return { ok: true, message: 'Registration closed — ratings snapshot captured. Set up the groups next.' }
}

// ---- Self-registration (members) ------------------------------------------

export async function registerForSeasonAction(seasonNumber: number, joinPassword: string): Promise<SeasonActionResult> {
  const user = await getCurrentUser()
  if (!user) return { error: 'Please sign in to register for this Season.' }
  const profile = await getProfileByUserId(Number(user.id))
  if (!profile) return { error: 'Complete your player profile before registering.' }
  const res = await registerSelf(Number(user.id), { playerId: profile.id, name: profile.primaryName, handle: profile.cueverseId }, seasonNumber, joinPassword)
  if (!res.ok) return { error: res.error }
  revalidateSeason(seasonNumber)
  revalidatePath('/account')
  return { ok: true, message: "You're registered for this Season." }
}

// ============================================================================
// Phase C — Group setup
// ============================================================================

export async function generateSeasonGroupsAction(seasonId: number, numGroups: number): Promise<SeasonActionResult & { uneven?: boolean }> {
  const actor = await requireCapability('manage_competitions')
  const r = await grp.generateSeasonGroups(actor, seasonId, numGroups)
  if (!r.ok) return { error: r.error }
  revalidateSeason(seasonId)
  return { ok: true, message: r.uneven ? 'Groups generated — sizes differ by one (allowed).' : 'Groups generated.', uneven: r.uneven }
}
export async function moveSeasonEntrantAction(seasonId: number, entrantId: number, toGroupId: number | null): Promise<SeasonActionResult> {
  const actor = await requireCapability('manage_competitions')
  const r = await grp.moveSeasonEntrantToGroup(actor, seasonId, entrantId, toGroupId)
  if (!r.ok) return { error: r.error }
  revalidateSeason(seasonId)
  return { ok: true }
}
export async function addSeasonGroupAction(seasonId: number): Promise<SeasonActionResult> {
  const actor = await requireCapability('manage_competitions')
  const r = await grp.addSeasonGroup(actor, seasonId)
  if (!r.ok) return { error: r.error }
  revalidateSeason(seasonId); return { ok: true }
}
export async function removeSeasonGroupAction(seasonId: number, groupId: number): Promise<SeasonActionResult> {
  const actor = await requireCapability('manage_competitions')
  const r = await grp.removeSeasonGroup(actor, seasonId, groupId)
  if (!r.ok) return { error: r.error }
  revalidateSeason(seasonId); return { ok: true, message: 'Group removed — its players returned to Unassigned.' }
}
export async function renameSeasonGroupAction(seasonId: number, groupId: number, name: string): Promise<SeasonActionResult> {
  const actor = await requireCapability('manage_competitions')
  const r = await grp.renameSeasonGroup(actor, seasonId, groupId, name)
  if (!r.ok) return { error: r.error }
  revalidateSeason(seasonId); return { ok: true }
}
export async function recodeSeasonGroupAction(seasonId: number, groupId: number, code: string): Promise<SeasonActionResult> {
  const actor = await requireCapability('manage_competitions')
  const r = await grp.recodeSeasonGroup(actor, seasonId, groupId, code)
  if (!r.ok) return { error: r.error }
  revalidateSeason(seasonId); return { ok: true, message: 'Group renamed.' }
}
export async function resetSeasonGroupsAction(seasonId: number): Promise<SeasonActionResult> {
  const actor = await requireCapability('manage_competitions')
  const r = await grp.resetSeasonGroups(actor, seasonId)
  if (!r.ok) return { error: r.error }
  revalidateSeason(seasonId); return { ok: true, message: 'Assignments cleared.' }
}
export async function publishSeasonGroupsAction(seasonId: number): Promise<SeasonActionResult> {
  const actor = await requireCapability('manage_competitions')
  const r = await grp.publishSeasonGroups(actor, seasonId)
  if (!r.ok) return { error: r.error }
  revalidateSeason(seasonId); return { ok: true, message: 'Group stage is live.' }
}

// ============================================================================
// Phase D — Live group stage
// ============================================================================
export async function saveSeasonGroupAction(seasonId: number, groupId: number, entries: gs.GroupResultEntry[], opts?: { confirmFF?: boolean; confirmKO?: boolean; koReason?: string }): Promise<gs.SaveGroupResult> {
  const actor = await requireCapability('edit_results')
  const r = await gs.saveSeasonGroupResults(actor, seasonId, groupId, entries, opts ?? {})
  if (r.ok) revalidateSeason(seasonId)
  return r
}
export async function closeSeasonGroupsAction(seasonId: number): Promise<SeasonActionResult> {
  const actor = await requireCapability('manage_competitions')
  const r = await gs.closeSeasonGroups(actor, seasonId)
  if (!r.ok) return { error: r.error }
  revalidateSeason(seasonId); return { ok: true, message: 'Groups closed — final standings locked.' }
}
/**
 * What Close Groups would do, before it does it.
 *
 * Read-only. Opens no transaction and changes nothing, so opening the dialog to look at the numbers
 * and then cancelling leaves the Season exactly as it was.
 */
export async function previewCloseGroupsAction(seasonId: number): Promise<import('./group-close').CloseGroupsPreflight> {
  await requireCapability('manage_competitions')
  const { closeGroupsPreflight } = await import('./group-close')
  return closeGroupsPreflight(seasonId)
}

/** What reopening would put back in question. Also read-only. */
export async function previewReopenGroupsAction(seasonId: number): Promise<import('./group-close').ReopenImpact> {
  await requireCapability('manage_competitions')
  const { reopenGroupsImpact } = await import('./group-close')
  return reopenGroupsImpact(seasonId)
}

/** Clear one half-entered match back to unplayed. Named, one at a time - never a sweep. */
export async function clearSeasonMatchAction(seasonId: number, matchId: number): Promise<SeasonActionResult> {
  const actor = await requireCapability('edit_results')
  const { clearSeasonMatch } = await import('./group-stage')
  const res = await clearSeasonMatch(actor, seasonId, matchId)
  if (!res.ok) return { error: res.error }
  revalidateSeason(seasonId)
  return { ok: true, message: 'Match cleared to unplayed.' }
}

export async function reopenSeasonGroupsAction(
  seasonId: number,
  opts: { discardDraftBracket?: boolean } = {},
): Promise<SeasonActionResult> {
  const actor = await requireCapability('manage_competitions')
  const res = await gs.reopenSeasonGroups(actor, seasonId, opts)
  if (!res.ok) return { error: res.error }
  revalidateSeason(seasonId)
  return {
    ok: true,
    message: res.discardedDraftMatches
      ? `Groups reopened. The ${res.discardedDraftMatches}-match bracket draft was discarded as requested.`
      : 'Groups reopened for editing. Any playoff draft has been kept.',
  }
}


// ============================================================================
// Phase E — Playoffs
// ============================================================================
export async function enterSeasonPlayoffSetupAction(seasonId: number): Promise<SeasonActionResult> {
  const actor = await requireCapability('manage_competitions')
  const r = await po.enterSeasonPlayoffSetup(actor, seasonId)
  if (!r.ok) return { error: r.error }
  revalidateSeason(seasonId); return { ok: true, message: 'Playoff setup opened.' }
}
export async function setSeasonQualificationAction(seasonId: number, entrantId: number, action: po.QualAction, reason?: string): Promise<SeasonActionResult> {
  const actor = await requireCapability('manage_competitions')
  const r = await po.setSeasonQualification(actor, seasonId, entrantId, action, reason)
  if (!r.ok) return { error: r.error }
  revalidateSeason(seasonId); return { ok: true }
}
export async function setSeasonPlayoffIncludedAction(seasonId: number, entrantId: number, included: boolean): Promise<SeasonActionResult> {
  const actor = await requireCapability('manage_competitions')
  const r = await po.setSeasonPlayoffIncluded(actor, seasonId, entrantId, included)
  if (!r.ok) return { error: r.error }
  revalidateSeason(seasonId); return { ok: true }
}
export async function setSeasonPlayoffFieldAction(seasonId: number, included: boolean): Promise<SeasonActionResult> {
  const actor = await requireCapability('manage_competitions')
  const r = await po.setSeasonPlayoffField(actor, seasonId, included)
  if (!r.ok) return { error: r.error }
  revalidateSeason(seasonId)
  return { ok: true, message: included ? `Added ${r.changed} player(s).` : `Cleared ${r.changed} player(s).` }
}
export async function setSeasonPlayoffDisclaimerAction(seasonId: number, text: string | null): Promise<SeasonActionResult> {
  const actor = await requireCapability('manage_competitions')
  const r = await po.setSeasonPlayoffDisclaimer(actor, seasonId, text)
  if (!r.ok) return { error: r.error }
  revalidateSeason(seasonId)
  return { ok: true, message: text?.trim() ? 'Note saved.' : 'Note removed.' }
}
/**
 * Arrange one pair of players in a bracket that has not been published.
 *
 * ── Why this does not revalidate ────────────────────────────────────────────────────────────────
 * `swapSeasonBracketSlots` refuses unless the Season is in PLAYOFF_SETUP, so the board being moved
 * is a draft: /seasons and the Season's public page do not show it, and rankings cannot have moved.
 * Revalidating them per drag was work with no reader.
 *
 * It was not free, either. A revalidate inside a Server Action tells the client its route is stale,
 * so the reply carries a fresh render of the whole Creator page — on top of the `router.refresh()`
 * the board then called itself. Arranging a sixteen-player draw meant dozens of full page loads for
 * a board that had already drawn the answer.
 *
 * ── Why it returns the board ────────────────────────────────────────────────────────────────────
 * So the client can reconcile without refetching anything. This is the arrangement the SERVER holds
 * after the write, which is not always the swap that was asked for — seeds belong to positions, not
 * to people — so adopting it keeps the board honest.
 */
export async function swapSeasonBracketSlotsAction(
  seasonId: number,
  a: { matchId: number; side: 'home' | 'away' },
  b: { matchId: number; side: 'home' | 'away' },
): Promise<SeasonActionResult & { slots?: import('./playoff-topology').EntrySlot[] }> {
  const actor = await requireCapability('manage_competitions')
  const r = await po.swapSeasonBracketSlots(actor, seasonId, a, b)
  if (!r.ok) return { error: r.error }
  const { bracketTopology } = await import('./playoff-topology')
  const topo = await bracketTopology(seasonId)
  return { ok: true, message: 'Swapped.', slots: topo.entrySlots }
}
export async function setSeasonBracketSlotAction(seasonId: number, matchId: number, side: 'home' | 'away', entrantId: number | null): Promise<SeasonActionResult> {
  const actor = await requireCapability('manage_competitions')
  const r = await po.setSeasonBracketSlot(actor, seasonId, matchId, side, entrantId)
  if (!r.ok) return { error: r.error }
  revalidateSeason(seasonId); return { ok: true }
}
export async function setSeasonPlayoffTypeAction(seasonId: number, doubleElim: boolean): Promise<SeasonActionResult> {
  const actor = await requireCapability('manage_competitions')
  const r = await po.setSeasonPlayoffType(actor, seasonId, doubleElim)
  if (!r.ok) return { error: r.error }
  revalidateSeason(seasonId); return { ok: true }
}
/** Every unmet Start condition, for the client to explain. The server checks again before it acts. */
export async function previewStartReadinessAction(seasonId: number): Promise<import('./playoff-topology').StartReadiness> {
  await requireCapability('manage_competitions')
  const { startReadiness } = await import('./playoff-topology')
  return startReadiness(seasonId)
}

/** The bracket's entry positions and what fills the rest, for the draft workspace. */
export async function previewBracketTopologyAction(seasonId: number): Promise<import('./playoff-topology').BracketTopology> {
  await requireCapability('manage_competitions')
  const { bracketTopology } = await import('./playoff-topology')
  return bracketTopology(seasonId)
}

export async function generateSeasonBracketAction(seasonId: number, opts: { size?: number } = {}): Promise<SeasonActionResult> {
  const actor = await requireCapability('manage_competitions')
  const r = await po.generateSeasonBracket(actor, seasonId, opts)
  if (!r.ok) return { error: r.error }
  revalidateSeason(seasonId)
  return { ok: true, message: `Draft bracket of ${r.size} generated — private until you start the playoffs.` }
}
export async function startSeasonPlayoffsAction(seasonId: number): Promise<SeasonActionResult> {
  const actor = await requireCapability('manage_competitions')
  const r = await po.startSeasonPlayoffs(actor, seasonId)
  if (!r.ok) return { error: r.error }
  revalidateSeason(seasonId); return { ok: true, message: 'Playoffs are live.' }
}
export async function recordSeasonPlayoffResultAction(
  matchId: number,
  homeGames: number,
  awayGames: number,
  opts?: { confirmRebuild?: boolean; note?: string | null; expectedUpdatedAt?: string },
): Promise<SeasonActionResult & { warning?: po.DownstreamWarning; conflict?: boolean }> {
  const actor = await requireCapability('edit_results')
  const m = await prisma.seasonPlayoffMatch.findUnique({ where: { id: matchId }, select: { seasonId: true } })
  const r = await po.recordSeasonPlayoffResult(actor, matchId, homeGames, awayGames, opts ?? {})
  if (r.warning) return { warning: r.warning }
  if (r.conflict) return { error: r.error, conflict: true }
  if (!r.ok) return { error: r.error }
  if (m) revalidateSeason(m.seasonId)
  return { ok: true }
}

// ============================================================================
// Phase F — Close + delete
// ============================================================================
/** Record a playoff match won by forfeit. Canonical service; no games are written. */
export async function recordSeasonPlayoffForfeitAction(
  matchId: number,
  forfeiter: 'home' | 'away',
  opts: { confirmRebuild?: boolean; note?: string | null; expectedUpdatedAt?: string } = {},
): Promise<SeasonActionResult & { conflict?: boolean; warning?: po.DownstreamWarning }> {
  const actor = await requireCapability('edit_results')
  const r = await po.recordSeasonPlayoffForfeit(actor, matchId, forfeiter, opts)
  if (r.warning) return { warning: r.warning }
  if (!r.ok) return { error: r.error, conflict: r.conflict }
  const m = await prisma.seasonPlayoffMatch.findUnique({ where: { id: matchId }, select: { seasonId: true } })
  revalidateSeason(m?.seasonId ?? null)
  return { ok: true, message: 'Forfeit recorded.' }
}

/** What Close Season would record, and every reason it cannot yet. Read-only. */
export async function previewCompletionAction(seasonId: number): Promise<import('./close').CompletionReadiness> {
  await requireCapability('manage_competitions')
  const { completionReadiness } = await import('./close')
  return completionReadiness(seasonId)
}

/** The correction impact for one playoff match, before anything is written. Read-only. */
export async function previewCorrectionAction(
  matchId: number,
  proposed: { kind: 'score'; homeGames: number; awayGames: number } | { kind: 'forfeit'; forfeiter: 'home' | 'away' },
): Promise<import('./playoff-correction').CorrectionImpact | { error: string }> {
  await requireCapability('edit_results')
  const { correctionImpact } = await import('./playoff-correction')
  return correctionImpact(matchId, proposed)
}

export async function closeSeasonAction(seasonId: number): Promise<SeasonActionResult> {
  const actor = await requireCapability('manage_competitions')
  const r = await closeSeason(actor, seasonId)
  if (!r.ok) return { error: r.error }
  revalidateSeason(seasonId) // clears the ladder aggregate too
  return { ok: true, message: 'Season closed — champion crowned and rankings applied.' }
}
/**
 * Permanently delete a Season.
 *
 * ── Three gates, and none of them is the button being drawn ──────────────────────────────────────
 * A server action is a public endpoint, so every check the panel performs is repeated here:
 *
 *   1. WHO. Owner, or the Head Administrator. `delete_competition` is Owner-only, and the Head Admin
 *      designation is deliberately allowed alongside it — they are the two people who already carry
 *      irreversible powers, and restricting it to the role alone would leave the person who runs the
 *      site unable to remove a record they created by mistake.
 *   2. WHICH. The operator types the Season's title back. That is the check that catches the real
 *      mistake here, which is not "meant to press cancel" but "had the wrong Season open" - a
 *      password proves who you are and says nothing about what you are pointing at.
 *   3. RE-AUTHENTICATION. Their own password, verified fresh. A borrowed session cannot do this.
 *
 * `deleteSeason` then writes the audit row BEFORE the delete and, for a completed Season, replays the
 * rating ledger without it inside the same transaction.
 */
export async function deleteSeasonAction(
  seasonId: number,
  input: { password: string; confirmTitle: string },
): Promise<SeasonActionResult> {
  const actor = await requireCapability('manage_competitions')
  if (!actor.can('delete_competition') && !actor.isHeadAdmin) {
    return { error: 'Permanent deletion is limited to the Owner and the Head Administrator.' }
  }

  const plan = await planSeasonDeletion(seasonId)
  if (!plan) return { error: 'Season not found.' }

  /*
   * Compared after trimming and case-insensitively.
   *
   * The title is shown on screen to be copied, so demanding an exact byte match punishes a trailing
   * space from a double-click selection rather than catching a wrong record. Case and surrounding
   * whitespace carry no information about which Season this is; the words do.
   */
  if (input.confirmTitle.trim().toLowerCase() !== plan.title.trim().toLowerCase()) {
    return { error: 'The title does not match. Nothing was deleted.' }
  }

  const { verifyCurrentUserPassword } = await import('@/lib/account/auth')
  if (!(await verifyCurrentUserPassword(input.password))) {
    return { error: 'Incorrect password — deletion cancelled.' }
  }

  const r = await deleteSeason(actor, seasonId, actor.isHeadAdmin)
  if (!r.ok) return { error: r.error }

  /*
   * Everything that was derived from this Season.
   *
   * Rankings unwind inside the transaction; these are the caches and rendered pages that would
   * otherwise keep showing a Season that no longer exists. Achievements matter as much as rankings
   * here: a Season Championship is DERIVED from `championPlayerId`, so the title vanishes from the
   * data the moment the row goes, and only a stale cache would still be claiming it.
   */
  invalidateRankings()
  invalidateAchievements()
  revalidatePath('/seasons')
  revalidatePath('/rankings')
  revalidatePath('/achievements')
  revalidatePath('/creator')
  revalidatePath('/')
  return { ok: true, message: `"${plan.title}" was permanently deleted.` }
}

export async function updateSeasonSettingsAction(seasonId: number, patch: import('./service').SeasonSettingsPatch): Promise<SeasonActionResult> {
  const actor = await requireCapability('manage_competitions')
  const { updateSeasonSettings } = await import('./service')
  const r = await updateSeasonSettings(actor, seasonId, patch)
  if (!r.ok) return { error: r.error, suggestion: r.suggestion }
  revalidateSeason(seasonId); return { ok: true, message: 'Settings saved.' }
}

export async function exportSeasonDataAction(seasonId: number): Promise<{ ok: boolean; error?: string; data?: unknown }> {
  await requireCapability('manage_competitions')
  const { exportSeasonData } = await import('./service')
  const data = await exportSeasonData(seasonId)
  if (!data) return { ok: false, error: 'Season not found.' }
  return { ok: true, data }
}

/**
 * Player search inside the Season on screen, for the browser's search box.
 *
 * Deliberately public and read-only: it returns only the entrants of the Season already being
 * displayed, which is information that page shows anyway. Distinct from `searchSeasonPlayersAction`,
 * which searches the whole member registry to ADD someone and is admin-gated.
 */
export async function searchSeasonEntrantsAction(seasonId: number, query: string): Promise<import('./browse').SeasonPlayerHit[]> {
  const { searchSeasonPlayers } = await import('./browse')
  return searchSeasonPlayers(seasonId, query)
}
