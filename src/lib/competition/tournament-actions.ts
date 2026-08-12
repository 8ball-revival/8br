'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { requireCapability, requireStaffActor } from './staff-auth'
import * as svc from './service'
import * as teamSvc from './teams'
import { createCup, type CreateCupConfig } from './tournament-create'
import { convertLegacyCup } from './cup-convert'
import { syncLiveCupToSnapshot } from './tournament-sync'
import { transitionCupState, requireCupState, bracketMatchesEntrants, type CupState } from './tournament-lifecycle'
import { recordAudit } from './audit'
import { getCurrentUser } from '@/lib/account/auth'

export interface ActionResult {
  ok?: boolean
  error?: string
  message?: string
  /** Tab the workspace should switch to after a successful lifecycle action. */
  navigate?: 'bracket' | 'results'
}

/** Revalidate the cup page + every snapshot-derived surface after a cup edit. */
function revalidateCup(number?: number | null) {
  if (number != null) revalidatePath(`/cups/${number}`)
  for (const p of ['/cups', '/', '/rankings', '/hall-of-fame', '/players', '/records', '/seasons']) revalidatePath(p)
}

async function cupNumberOfSeason(tournamentId: number): Promise<number | null> {
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

export async function createCupAction(cfg: CreateCupConfig): Promise<ActionResult & { number?: number }> {
  const actor = await requireCapability('manage_competitions')
  const res = await createCup(actor, cfg)
  if (!res.ok) return { error: res.error }
  await syncLiveCupToSnapshot(res.id!) // make the new cup appear in the snapshot-backed list
  revalidateCup(res.number)
  return { ok: true, number: res.number, message: `Created ${res.code} — Cup ${res.number}.` }
}

// ---- Legacy conversion ----------------------------------------------------

/** One-time migration of a legacy (old-format) cup into the editable workspace. */
export async function convertLegacyCupAction(tournamentId: number): Promise<ActionResult> {
  const actor = await requireCapability('manage_competitions')
  const r = await convertLegacyCup(actor, tournamentId)
  if (!r.ok) return { error: r.error }
  revalidateCup(await cupNumberOfSeason(tournamentId))
  return { ok: true, message: 'Converted to an editable competition — history preserved.' }
}

// ---- Entrants (individual cups) -------------------------------------------

export interface EntrantCandidate { playerId: string; primaryName: string; cueverseId: string | null }

export async function searchCupPlayersAction(tournamentId: number, query: string): Promise<EntrantCandidate[]> {
  await requireCapability('manage_competitions')
  const { searchEntrantCandidates } = await import('./queries')
  return searchEntrantCandidates(tournamentId, query)
}

/** Entrant management is only permitted while registration is open or closed (never once the
 *  bracket is generated, the tournament is in progress, or the cup is completed/cancelled). */
const ENTRANT_STATES: CupState[] = ['REGISTRATION_OPEN', 'REGISTRATION_CLOSED']

export async function addCupEntrantsAction(tournamentId: number, playerIds: string[]): Promise<ActionResult> {
  const actor = await requireCapability('manage_competitions')
  const gate = await requireCupState(tournamentId, ENTRANT_STATES)
  if (!gate.ok) return { error: gate.error }
  let added = 0
  for (const id of playerIds) {
    const r = await svc.addEntrantByProfile(actor, tournamentId, id)
    if (r.ok && !r.already) added++
  }
  revalidateCup(await cupNumberOfSeason(tournamentId))
  return { ok: true, message: `Added ${added} entrant${added === 1 ? '' : 's'}.` }
}

// addManualEntrantAction (free-text "temporary entrant") was REMOVED: every entrant in a new cup
// must reference a permanent registered player. Use `addCupEntrantsAction` (Add Player) instead.
// The server-side service (svc.addManualEntrant) now refuses as a defense-in-depth backstop.

export async function removeCupEntrantAction(tournamentId: number, registrationId: number): Promise<ActionResult> {
  const actor = await requireCapability('manage_competitions')
  const gate = await requireCupState(tournamentId, ENTRANT_STATES)
  if (!gate.ok) return { error: gate.error }
  const r = await svc.removeEntrant(actor, tournamentId, registrationId)
  if (!r.ok) return { error: r.error }
  revalidateCup(await cupNumberOfSeason(tournamentId))
  return { ok: true }
}

export async function restoreCupEntrantAction(tournamentId: number, registrationId: number): Promise<ActionResult> {
  const actor = await requireCapability('manage_competitions')
  const gate = await requireCupState(tournamentId, ENTRANT_STATES)
  if (!gate.ok) return { error: gate.error }
  const r = await svc.restoreEntrant(actor, tournamentId, registrationId)
  if (!r.ok) return { error: r.error }
  revalidateCup(await cupNumberOfSeason(tournamentId))
  return { ok: true }
}

// ---- Settings -------------------------------------------------------------

/** Set the competition race length (games to win a match). Any positive integer; reused
 *  by score validation, standings, and displays across the whole event. */
export async function setCupRaceLengthAction(tournamentId: number, raceLength: number): Promise<ActionResult> {
  const actor = await requireCapability('manage_competitions')
  if (!Number.isInteger(raceLength) || raceLength < 1) return { error: 'Race length must be a positive whole number.' }
  const gate = await requireCupState(tournamentId, ['DRAFT', 'REGISTRATION_OPEN', 'REGISTRATION_CLOSED'])
  if (!gate.ok) return { error: gate.error }
  await svc.assertCompetitionUnlocked(prisma, tournamentId)
  await svc.updateSeason(actor, tournamentId, { raceLength })
  revalidateCup(await cupNumberOfSeason(tournamentId))
  return { ok: true, message: `Race length set to ${raceLength}.` }
}

// ---- Bracket --------------------------------------------------------------

/** States in which the bracket may be built, regenerated, or corrected: after registration closes
 *  and while it is generated-but-not-started. NEVER once the tournament is In Progress/Completed. */
const BRACKET_EDIT_STATES: CupState[] = ['REGISTRATION_CLOSED', 'BRACKET_GENERATED']

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
 * registered entrants' permanent ids and moves the cup to BRACKET_GENERATED. Navigates the admin to
 * the Bracket tab. Does NOT silently overwrite an up-to-date existing bracket (regeneration of a
 * stale bracket after re-opening is allowed; a matching one is left intact).
 */
export async function generateCupBracketAction(tournamentId: number): Promise<ActionResult> {
  const actor = await requireCapability('manage_competitions')
  const gate = await requireCupState(tournamentId, ['REGISTRATION_OPEN', 'REGISTRATION_CLOSED', 'BRACKET_GENERATED'])
  if (!gate.ok) return { error: gate.error }

  const order = await defaultSeedOrder(tournamentId)
  if (order.length < 2) return { error: 'Add at least 2 registered entrants before generating the bracket.' }

  // Don't silently overwrite: if a bracket already exists and still matches the entrants, keep it.
  if (gate.state === 'BRACKET_GENERATED') {
    const fresh = await bracketMatchesEntrants(tournamentId)
    if (fresh.ok) return { ok: true, message: 'Bracket is already generated and up to date.', navigate: 'bracket' }
    // else: stale (entrants changed after re-opening) → regenerate below.
  }

  // Auto-close registration first (persisted) so the bracket is built against a frozen field.
  if (gate.state === 'REGISTRATION_OPEN') {
    const close = await transitionCupState(actor, tournamentId, 'REGISTRATION_CLOSED')
    if (!close.ok) return { error: close.error }
  }

  // Replace any prior (stale/published) bracket, then build + publish the new one.
  const published = await prisma.playoffMatch.count({ where: { tournamentId, published: true } })
  if (published > 0) {
    const rd = await svc.returnPlayoffToDraft(actor, tournamentId)
    if (!rd.ok) return { error: rd.error }
  }
  await svc.reseedEntrants(actor, tournamentId, order)
  const built = await svc.rebuildManualPlayoff(actor, tournamentId, order)
  if (!built.ok) return { error: built.error }
  const pub = await svc.publishPlayoff(actor, tournamentId)
  if (!pub.ok) return { error: pub.error }

  const cur = await requireCupState(tournamentId, ['REGISTRATION_CLOSED', 'BRACKET_GENERATED'])
  if (cur.ok && cur.state === 'REGISTRATION_CLOSED') {
    const t = await transitionCupState(actor, tournamentId, 'BRACKET_GENERATED')
    if (!t.ok) return { error: t.error }
  }
  await recordAudit(actor, { action: 'cup.bracket.generate', entity: 'Tournament', entityId: tournamentId, newValue: { entrants: order.length } })
  revalidateCup(await cupNumberOfSeason(tournamentId))
  return { ok: true, message: 'Bracket generated. Review it, then Start Cup.', navigate: 'bracket' }
}

/**
 * Re-open registration (a first-class toggle, NOT a recovery) before the cup is live. Allowed from
 * Registration Closed or Bracket Generated. Re-opening from Bracket Generated warns that the
 * existing bracket may become outdated — the bracket rows are kept, but the cup can only be started
 * again after a fresh, matching bracket is generated (enforced by Start Cup's staleness check).
 * Once the cup is live, registration is permanently locked and this is refused server-side.
 */
export async function reopenCupRegistrationAction(tournamentId: number): Promise<ActionResult> {
  const actor = await requireCapability('manage_competitions')
  const gate = await requireCupState(tournamentId, ['REGISTRATION_CLOSED', 'BRACKET_GENERATED'])
  if (!gate.ok) return { error: gate.error }
  const hadBracket = gate.state === 'BRACKET_GENERATED'
  const r = await transitionCupState(actor, tournamentId, 'REGISTRATION_OPEN', hadBracket ? { reason: 'Re-opened after bracket generation' } : {})
  if (!r.ok) return { error: r.error }
  revalidateCup(await cupNumberOfSeason(tournamentId))
  return {
    ok: true,
    message: hadBracket
      ? 'Registration re-opened. The previous bracket is now outdated — regenerate it before starting the cup.'
      : 'Registration re-opened.',
  }
}

/**
 * Build/rebuild the draft bracket from an ordered seed list. Allowed only in REGISTRATION_CLOSED
 * (initial generation) or BRACKET_GENERATED (regeneration during pre-start review). If a bracket is
 * already published, it is returned to draft first so it can be rebuilt. Byes for non-power-of-two
 * fields are created and auto-advanced by the bracket planner. Records a distinct
 * generated/regenerated audit event for the cup history.
 */
export async function buildCupBracketAction(tournamentId: number, orderedRegistrationIds: number[]): Promise<ActionResult> {
  const actor = await requireCapability('manage_competitions')
  const gate = await requireCupState(tournamentId, BRACKET_EDIT_STATES)
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
  await recordAudit(actor, { action: 'cup.bracket.generate', entity: 'Tournament', entityId: tournamentId, newValue: { regenerated } })
  revalidateCup(await cupNumberOfSeason(tournamentId))
  return { ok: true, message: regenerated ? 'Bracket regenerated (draft).' : 'Draft bracket built.' }
}

/**
 * Publish the generated bracket so it is publicly visible. This does NOT begin the tournament —
 * it moves REGISTRATION_CLOSED → BRACKET_GENERATED (bracket visible, reporting/scoring still off;
 * admins may review + regenerate). Re-publishing after a regeneration keeps the state.
 */
export async function publishCupBracketAction(tournamentId: number): Promise<ActionResult> {
  const actor = await requireCapability('manage_competitions')
  const gate = await requireCupState(tournamentId, BRACKET_EDIT_STATES)
  if (!gate.ok) return { error: gate.error }
  const r = await svc.publishPlayoff(actor, tournamentId)
  if (!r.ok) return { error: r.error }
  if (gate.state === 'REGISTRATION_CLOSED') {
    const t = await transitionCupState(actor, tournamentId, 'BRACKET_GENERATED')
    if (!t.ok && t.error) return { error: t.error }
  }
  revalidateCup(await cupNumberOfSeason(tournamentId))
  return { ok: true, message: 'Bracket published. Review it, then Begin Tournament to start play.' }
}

/**
 * Explicitly begin the tournament: BRACKET_GENERATED → IN_PROGRESS. Requires a generated (published)
 * bracket. From here registration + withdrawals stay locked, entrant management is gone, and match
 * reporting/scoring are enabled. The UI requires a confirmation before calling this.
 */
export async function beginCupTournamentAction(tournamentId: number): Promise<ActionResult> {
  const actor = await requireCapability('manage_competitions')
  const gate = await requireCupState(tournamentId, ['BRACKET_GENERATED'])
  if (!gate.ok) return { error: gate.error }
  const published = await prisma.playoffMatch.count({ where: { tournamentId, published: true } })
  if (published === 0) return { error: 'Publish the generated bracket before beginning the tournament.' }
  // Refuse to start on a stale bracket (entrants changed after it was generated).
  const fresh = await bracketMatchesEntrants(tournamentId)
  if (!fresh.ok) return { error: `${fresh.reason} Regenerate the bracket before starting the cup.` }
  const t = await transitionCupState(actor, tournamentId, 'IN_PROGRESS')
  if (!t.ok) return { error: t.error }
  revalidateCup(await cupNumberOfSeason(tournamentId))
  // Cup is live: registration is permanently locked; match reporting is enabled → Results tab.
  return { ok: true, message: 'The cup is live. Registration is locked and results can be reported.', navigate: 'results' }
}

export async function returnCupBracketToDraftAction(tournamentId: number): Promise<ActionResult> {
  const actor = await requireCapability('manage_competitions')
  const gate = await requireCupState(tournamentId, BRACKET_EDIT_STATES)
  if (!gate.ok) return { error: gate.error }
  const r = await svc.returnPlayoffToDraft(actor, tournamentId)
  if (!r.ok) return { error: r.error }
  revalidateCup(await cupNumberOfSeason(tournamentId))
  return { ok: true, message: 'Bracket returned to draft for editing.' }
}

/** Delete the (unstarted) bracket. If the cup had advanced to BRACKET_GENERATED, this scraps the
 *  bracket and returns it to REGISTRATION_CLOSED so entrants can be corrected. */
export async function deleteCupBracketAction(tournamentId: number): Promise<ActionResult> {
  const actor = await requireCapability('manage_competitions')
  const gate = await requireCupState(tournamentId, BRACKET_EDIT_STATES)
  if (!gate.ok) return { error: gate.error }
  const r = await svc.deletePlayoff(actor, tournamentId)
  if (!r.ok) return { error: r.error }
  if (gate.state === 'BRACKET_GENERATED') {
    // Backward correction within the pre-start review phase (audited via transitionCupState).
    await transitionCupState(actor, tournamentId, 'REGISTRATION_CLOSED', { recovery: true, reason: 'Bracket deleted before start' })
  }
  revalidateCup(await cupNumberOfSeason(tournamentId))
  return { ok: true, message: 'Bracket deleted.' }
}

// ---- Results --------------------------------------------------------------

export async function recordCupScoreAction(matchId: number, home: number, away: number, reason?: string): Promise<ActionResult> {
  const actor = await requireCapability('edit_results')
  const sid = await seasonIdOfMatch(matchId)
  if (sid) { const gate = await requireCupState(sid, ['IN_PROGRESS']); if (!gate.ok) return { error: gate.error } }
  const r = await svc.recordPlayoffScore(actor, matchId, home, away, reason)
  if (!r.ok) return { error: r.error }
  // Auto-verify to advance the winner immediately (admin editor is authoritative).
  await svc.verifyPlayoffMatch(actor, matchId, reason)
  const tournamentId = await seasonIdOfMatch(matchId)
  if (tournamentId) await syncLiveCupToSnapshot(tournamentId) // published/converted cups: keep rankings current
  revalidateCup(await cupNumberOfMatch(matchId))
  return { ok: true, message: 'Result saved and winner advanced.' }
}

export async function undoCupResultAction(matchId: number, reason?: string): Promise<ActionResult> {
  const actor = await requireCapability('edit_results')
  const sid = await seasonIdOfMatch(matchId)
  if (sid) { const gate = await requireCupState(sid, ['IN_PROGRESS']); if (!gate.ok) return { error: gate.error } }
  const r = await svc.undoPlayoffResult(actor, matchId, reason)
  if (!r.ok) return { error: r.error }
  const tournamentId = await seasonIdOfMatch(matchId)
  if (tournamentId) await syncLiveCupToSnapshot(tournamentId) // published/converted cups: keep rankings current
  revalidateCup(await cupNumberOfMatch(matchId))
  return { ok: true, message: 'Result undone.' }
}

export async function setCupMatchNoteAction(matchId: number, note: string): Promise<ActionResult> {
  const actor = await requireCapability('edit_results')
  const sid = await seasonIdOfMatch(matchId)
  if (sid) { const gate = await requireCupState(sid, ['BRACKET_GENERATED', 'IN_PROGRESS']); if (!gate.ok) return { error: gate.error } }
  const r = await svc.setPlayoffNote(actor, matchId, note)
  if (!r.ok) return { error: r.error }
  revalidateCup(await cupNumberOfMatch(matchId))
  return { ok: true }
}

// ---- Teams (2v2 / team cups) ----------------------------------------------

export async function createTeamAction(tournamentId: number, name: string): Promise<ActionResult & { teamId?: number }> {
  const actor = await requireCapability('manage_competitions')
  const r = await teamSvc.createTeam(actor, tournamentId, name)
  if (!r.ok) return { error: r.error }
  revalidateCup(await cupNumberOfSeason(tournamentId))
  return { ok: true, teamId: r.teamId }
}

export async function setTeamMembersAction(teamId: number, members: teamSvc.TeamMemberInput[]): Promise<ActionResult> {
  const actor = await requireCapability('manage_competitions')
  const r = await teamSvc.setTeamMembers(actor, teamId, members)
  if (!r.ok) return { error: r.error }
  const t = await prisma.tournamentTeam.findUnique({ where: { id: teamId }, select: { tournamentId: true } })
  revalidateCup(t ? await cupNumberOfSeason(t.tournamentId) : null)
  return { ok: true, message: 'Roster saved.' }
}

export async function renameTeamAction(teamId: number, name: string): Promise<ActionResult> {
  const actor = await requireCapability('manage_competitions')
  const r = await teamSvc.renameTeam(actor, teamId, name)
  if (!r.ok) return { error: r.error }
  const t = await prisma.tournamentTeam.findUnique({ where: { id: teamId }, select: { tournamentId: true } })
  revalidateCup(t ? await cupNumberOfSeason(t.tournamentId) : null)
  return { ok: true }
}

export async function withdrawTeamAction(teamId: number): Promise<ActionResult> {
  const actor = await requireCapability('manage_competitions')
  const r = await teamSvc.withdrawTeam(actor, teamId)
  if (!r.ok) return { error: r.error }
  const t = await prisma.tournamentTeam.findUnique({ where: { id: teamId }, select: { tournamentId: true } })
  revalidateCup(t ? await cupNumberOfSeason(t.tournamentId) : null)
  return { ok: true }
}

export async function restoreTeamAction(teamId: number): Promise<ActionResult> {
  const actor = await requireCapability('manage_competitions')
  const r = await teamSvc.restoreTeam(actor, teamId)
  if (!r.ok) return { error: r.error }
  const t = await prisma.tournamentTeam.findUnique({ where: { id: teamId }, select: { tournamentId: true } })
  revalidateCup(t ? await cupNumberOfSeason(t.tournamentId) : null)
  return { ok: true }
}

export async function deleteTeamAction(teamId: number): Promise<ActionResult> {
  const actor = await requireCapability('manage_competitions')
  const t = await prisma.tournamentTeam.findUnique({ where: { id: teamId }, select: { tournamentId: true } })
  const r = await teamSvc.deleteTeam(actor, teamId)
  if (!r.ok) return { error: r.error }
  revalidateCup(t ? await cupNumberOfSeason(t.tournamentId) : null)
  return { ok: true }
}

// ---- Lifecycle ------------------------------------------------------------

/** Explicit cup state transition (Admin+). Enforces the valid-transition matrix, completion
 *  gate, legacy-field sync, idempotent ladder, and audit — all in the lifecycle service. */
export async function setCupStateAction(tournamentId: number, to: CupState, reason?: string): Promise<ActionResult> {
  const actor = await requireCapability('manage_competitions')
  const r = await transitionCupState(actor, tournamentId, to, { reason })
  if (!r.ok) return { error: r.error }
  revalidateCup(await cupNumberOfSeason(tournamentId))
  return { ok: true, message: `Cup is now ${to.replace(/_/g, ' ').toLowerCase()}.` }
}

/** OWNER-only recovery transition (an otherwise-invalid skip/backwards move), audited distinctly. */
export async function recoverCupStateAction(tournamentId: number, to: CupState, reason: string): Promise<ActionResult> {
  const actor = await requireOwnerActor()
  if (!reason?.trim()) return { error: 'A reason is required for a recovery transition.' }
  const r = await transitionCupState(actor, tournamentId, to, { reason, recovery: true })
  if (!r.ok) return { error: r.error }
  revalidateCup(await cupNumberOfSeason(tournamentId))
  return { ok: true, message: `Recovery applied — cup set to ${to.replace(/_/g, ' ').toLowerCase()}.` }
}

/** Complete the tournament (state → COMPLETED). The lifecycle service validates the Final has a
 *  winner + no required match is open, records placements, applies the ladder once, and audits. */
export async function completeCupAction(tournamentId: number, reason?: string): Promise<ActionResult> {
  const actor = await requireCapability('manage_competitions')
  const r = await transitionCupState(actor, tournamentId, 'COMPLETED', { reason })
  if (!r.ok) return { error: r.error }
  revalidateCup(await cupNumberOfSeason(tournamentId))
  return { ok: true, message: 'Cup completed. Winner recorded; rankings and records updated.' }
}

// ---- Player self-report (member) ------------------------------------------

/**
 * A MATCH PARTICIPANT reports their OWN LOSS (never a win). Server-side: verifies the caller is
 * in the match, the cup is IN_PROGRESS, and the match is undecided; then records the opponent as
 * the winner (race-length) and advances the bracket. Duplicate/conflicting submissions are
 * rejected. Players can never report themselves as the winner (enforced structurally).
 */
export async function reportCupLossAction(matchId: number, myGamesWon: number): Promise<ActionResult> {
  const user = await getCurrentUser()
  if (!user) return { error: 'Please sign in to report your result.' }
  const { reportOwnLoss } = await import('./service')
  const r = await reportOwnLoss(Number(user.id), user.username, matchId, myGamesWon)
  if (!r.ok) return { error: r.error }
  const tournamentId = await seasonIdOfMatch(matchId)
  if (tournamentId) await syncLiveCupToSnapshot(tournamentId)
  revalidateCup(await cupNumberOfMatch(matchId))
  return { ok: true, message: 'Your loss was reported and your opponent advanced.' }
}

/**
 * Permanently delete a LIVE cup and everything under it (entrants, teams, bracket,
 * results) — cascades via the Tournament row. Blocked for imported historical cups (those
 * are protected; an Owner must unlock, and even then they are not deletable here).
 * Requires typing the competition code to confirm. Regenerates the snapshot after.
 */
export async function deleteCupAction(tournamentId: number, typedCode: string): Promise<ActionResult> {
  const actor = await requireCapability('manage_competitions')
  const s = await prisma.tournament.findUnique({ where: { id: tournamentId } })
  if (!s || s.competitionType !== 'CUP') return { error: 'Cup not found.' }
  if (s.importedFromFixture || s.locked) return { error: 'Imported historical cups cannot be deleted.' }
  if (typedCode.trim() !== (s.code ?? '')) return { error: `Confirmation code does not match. Type ${s.code} to confirm deletion.` }

  const code = s.code
  const number = s.number
  await prisma.tournament.delete({ where: { id: tournamentId } }) // cascades registrations, teams, playoff matches, bracket rows
  const { recordAudit } = await import('./audit')
  await recordAudit(actor, { action: 'cup.delete', entity: 'Tournament', entityId: tournamentId, oldValue: { name: s.name, code, number } })
  const { regenerateCupSnapshot } = await import('@/lib/tournaments/migrate') // rebuild the snapshot without the deleted cup
  await regenerateCupSnapshot()
  revalidateCup(number)
  return { ok: true, message: `Deleted ${code} — Cup ${number}.` }
}

export async function archiveCupAction(tournamentId: number, reason?: string): Promise<ActionResult> {
  const actor = await requireCapability('manage_competitions')
  const r = await svc.archiveCompetition(actor, tournamentId, reason)
  if (!r.ok) return { error: r.error }
  revalidateCup(await cupNumberOfSeason(tournamentId))
  return { ok: true, message: 'Cup archived.' }
}

export async function unarchiveCupAction(tournamentId: number, reason?: string): Promise<ActionResult> {
  const actor = await requireCapability('manage_competitions')
  const r = await svc.unarchiveCompetition(actor, tournamentId, reason)
  if (!r.ok) return { error: r.error }
  revalidateCup(await cupNumberOfSeason(tournamentId))
  return { ok: true, message: 'Cup restored from archive.' }
}

// ---- Owner-only historical unlock / relock --------------------------------

async function requireOwnerActor() {
  const actor = await requireStaffActor()
  if (!actor.isOwner) throw new Error('Forbidden: only the Owner can unlock or relock historical competitions.')
  return actor
}

export async function unlockHistoricalCupAction(tournamentId: number, typedCode: string, reason: string): Promise<ActionResult> {
  const actor = await requireOwnerActor()
  const r = await svc.unlockHistoricalCompetition(actor, tournamentId, typedCode, reason)
  if (!r.ok) return { error: r.error }
  revalidateCup(await cupNumberOfSeason(tournamentId))
  return { ok: true, message: 'Historical cup unlocked for editing.' }
}

export async function relockHistoricalCupAction(tournamentId: number, reason?: string): Promise<ActionResult> {
  const actor = await requireOwnerActor()
  const r = await svc.relockCompetition(actor, tournamentId, reason)
  if (!r.ok) return { error: r.error }
  revalidateCup(await cupNumberOfSeason(tournamentId))
  return { ok: true, message: 'Historical cup re-locked.' }
}
