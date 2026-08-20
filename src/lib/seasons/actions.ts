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
import { deleteSeason } from './admin'
import { prisma } from '@/lib/prisma'
import { invalidateRankings } from '@/lib/stats/invalidate-rankings'

export interface SeasonActionResult {
  ok?: boolean
  error?: string
  message?: string
  /** On a Season-number conflict: the next free number, so the form can offer it. */
  suggestion?: number
}

/** Season pages are addressed by database id, so that is what gets revalidated. */
function revalidateSeason(seasonId?: number | null) {
  if (seasonId != null) revalidatePath(`/seasons/${seasonId}`)
  revalidatePath('/seasons')
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
export async function reopenSeasonGroupsAction(seasonId: number): Promise<SeasonActionResult> {
  const actor = await requireCapability('manage_competitions')
  const r = await gs.reopenSeasonGroups(actor, seasonId)
  if (!r.ok) return { error: r.error }
  revalidateSeason(seasonId); return { ok: true, message: 'Groups reopened — any draft bracket was discarded.' }
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
export async function swapSeasonBracketSlotsAction(
  seasonId: number,
  a: { matchId: number; side: 'home' | 'away' },
  b: { matchId: number; side: 'home' | 'away' },
): Promise<SeasonActionResult> {
  const actor = await requireCapability('manage_competitions')
  const r = await po.swapSeasonBracketSlots(actor, seasonId, a, b)
  if (!r.ok) return { error: r.error }
  revalidateSeason(seasonId); return { ok: true, message: 'Swapped.' }
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
export async function generateSeasonBracketAction(seasonId: number): Promise<SeasonActionResult> {
  const actor = await requireCapability('manage_competitions')
  const r = await po.generateSeasonBracket(actor, seasonId)
  if (!r.ok) return { error: r.error }
  revalidateSeason(seasonId); return { ok: true, message: 'Draft bracket generated (private).' }
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
export async function closeSeasonAction(seasonId: number): Promise<SeasonActionResult> {
  const actor = await requireCapability('manage_competitions')
  const r = await closeSeason(actor, seasonId)
  if (!r.ok) return { error: r.error }
  revalidateSeason(seasonId)
  invalidateRankings()
  return { ok: true, message: 'Season closed — champion crowned and rankings applied.' }
}
export async function deleteSeasonAction(seasonId: number, password: string): Promise<SeasonActionResult> {
  const actor = await requireCapability('manage_competitions')
  const s = await prisma.season.findUnique({ where: { id: seasonId }, select: { number: true } })
  if (!s) return { error: 'Season not found.' }
  // Re-authentication gate: the admin must confirm their OWN password before this irreversible delete.
  const { verifyCurrentUserPassword } = await import('@/lib/account/auth')
  if (!(await verifyCurrentUserPassword(password))) return { error: 'Incorrect password — deletion cancelled.' }
  const r = await deleteSeason(actor, seasonId, actor.isHeadAdmin)
  if (!r.ok) return { error: r.error }
  revalidatePath('/seasons'); invalidateRankings()
  return { ok: true, message: 'Season permanently deleted.' }
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
