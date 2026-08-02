'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { requireCapability, requireStaffActor } from './staff-auth'
import * as svc from './service'
import * as teamSvc from './teams'
import { createCup, type CreateCupConfig } from './cup-create'
import { convertLegacyCup } from './cup-convert'
import { syncLiveCupToSnapshot } from './cup-sync'

export interface ActionResult {
  ok?: boolean
  error?: string
  message?: string
}

/** Revalidate the cup page + every snapshot-derived surface after a cup edit. */
function revalidateCup(cupNumber?: number | null) {
  if (cupNumber != null) revalidatePath(`/cups/${cupNumber}`)
  for (const p of ['/cups', '/', '/rankings', '/hall-of-fame', '/players', '/records', '/seasons']) revalidatePath(p)
}

async function cupNumberOfSeason(seasonId: number): Promise<number | null> {
  const s = await prisma.season.findUnique({ where: { id: seasonId }, select: { cupNumber: true } })
  return s?.cupNumber ?? null
}
async function cupNumberOfMatch(matchId: number): Promise<number | null> {
  const m = await prisma.playoffMatch.findUnique({ where: { id: matchId }, select: { season: { select: { cupNumber: true } } } })
  return m?.season.cupNumber ?? null
}
async function seasonIdOfMatch(matchId: number): Promise<number | null> {
  const m = await prisma.playoffMatch.findUnique({ where: { id: matchId }, select: { seasonId: true } })
  return m?.seasonId ?? null
}

// ---- Create ---------------------------------------------------------------

export async function createCupAction(cfg: CreateCupConfig): Promise<ActionResult & { cupNumber?: number }> {
  const actor = await requireCapability('manage_competitions')
  const res = await createCup(actor, cfg)
  if (!res.ok) return { error: res.error }
  await syncLiveCupToSnapshot(res.id!) // make the new cup appear in the snapshot-backed list
  revalidateCup(res.cupNumber)
  return { ok: true, cupNumber: res.cupNumber, message: `Created ${res.competitionCode} — Cup ${res.cupNumber}.` }
}

// ---- Legacy conversion ----------------------------------------------------

/** One-time migration of a legacy (old-format) cup into the editable workspace. */
export async function convertLegacyCupAction(seasonId: number): Promise<ActionResult> {
  const actor = await requireCapability('manage_competitions')
  const r = await convertLegacyCup(actor, seasonId)
  if (!r.ok) return { error: r.error }
  revalidateCup(await cupNumberOfSeason(seasonId))
  return { ok: true, message: 'Converted to an editable competition — history preserved.' }
}

// ---- Entrants (individual cups) -------------------------------------------

export interface EntrantCandidate { playerId: string; primaryName: string; cueverseId: string | null; alreadyEntered: boolean }

export async function searchCupPlayersAction(seasonId: number, query: string): Promise<EntrantCandidate[]> {
  await requireCapability('manage_competitions')
  const { searchEntrantCandidates } = await import('./queries')
  return searchEntrantCandidates(seasonId, query)
}

export async function addCupEntrantsAction(seasonId: number, playerIds: string[]): Promise<ActionResult> {
  const actor = await requireCapability('manage_competitions')
  let added = 0
  for (const id of playerIds) {
    const r = await svc.addEntrantByProfile(actor, seasonId, id)
    if (r.ok && !r.already) added++
  }
  revalidateCup(await cupNumberOfSeason(seasonId))
  return { ok: true, message: `Added ${added} entrant${added === 1 ? '' : 's'}.` }
}

export async function addManualEntrantAction(seasonId: number, name: string): Promise<ActionResult> {
  const actor = await requireCapability('manage_competitions')
  const r = await svc.addManualEntrant(actor, seasonId, name)
  if (!r.ok) return { error: r.error }
  revalidateCup(await cupNumberOfSeason(seasonId))
  return { ok: true, message: `Added ${name}.` }
}

export async function removeCupEntrantAction(seasonId: number, registrationId: number): Promise<ActionResult> {
  const actor = await requireCapability('manage_competitions')
  const r = await svc.removeEntrant(actor, seasonId, registrationId)
  if (!r.ok) return { error: r.error }
  revalidateCup(await cupNumberOfSeason(seasonId))
  return { ok: true }
}

export async function restoreCupEntrantAction(seasonId: number, registrationId: number): Promise<ActionResult> {
  const actor = await requireCapability('manage_competitions')
  const r = await svc.restoreEntrant(actor, seasonId, registrationId)
  if (!r.ok) return { error: r.error }
  revalidateCup(await cupNumberOfSeason(seasonId))
  return { ok: true }
}

// ---- Settings -------------------------------------------------------------

/** Set the competition race length (games to win a match). Any positive integer; reused
 *  by score validation, standings, and displays across the whole event. */
export async function setCupRaceLengthAction(seasonId: number, raceLength: number): Promise<ActionResult> {
  const actor = await requireCapability('manage_competitions')
  if (!Number.isInteger(raceLength) || raceLength < 1) return { error: 'Race length must be a positive whole number.' }
  await svc.assertCompetitionUnlocked(prisma, seasonId)
  await svc.updateSeason(actor, seasonId, { raceLength })
  revalidateCup(await cupNumberOfSeason(seasonId))
  return { ok: true, message: `Race length set to ${raceLength}.` }
}

// ---- Bracket --------------------------------------------------------------

/** Build/rebuild the draft bracket from an ordered seed list (registrationIds; for team
 *  cups these are the teams' registration entrants). Also persists the pool seed order. */
export async function buildCupBracketAction(seasonId: number, orderedRegistrationIds: number[]): Promise<ActionResult> {
  const actor = await requireCapability('manage_competitions')
  await svc.reseedEntrants(actor, seasonId, orderedRegistrationIds)
  const r = await svc.rebuildManualPlayoff(actor, seasonId, orderedRegistrationIds)
  if (!r.ok) return { error: r.error }
  revalidateCup(await cupNumberOfSeason(seasonId))
  return { ok: true, message: 'Draft bracket built.' }
}

export async function publishCupBracketAction(seasonId: number): Promise<ActionResult> {
  const actor = await requireCapability('manage_competitions')
  const r = await svc.publishPlayoff(actor, seasonId)
  if (!r.ok) return { error: r.error }
  revalidateCup(await cupNumberOfSeason(seasonId))
  return { ok: true, message: 'Bracket published.' }
}

export async function returnCupBracketToDraftAction(seasonId: number): Promise<ActionResult> {
  const actor = await requireCapability('manage_competitions')
  const r = await svc.returnPlayoffToDraft(actor, seasonId)
  if (!r.ok) return { error: r.error }
  revalidateCup(await cupNumberOfSeason(seasonId))
  return { ok: true, message: 'Bracket returned to draft.' }
}

export async function deleteCupBracketAction(seasonId: number): Promise<ActionResult> {
  const actor = await requireCapability('manage_competitions')
  const r = await svc.deletePlayoff(actor, seasonId)
  if (!r.ok) return { error: r.error }
  revalidateCup(await cupNumberOfSeason(seasonId))
  return { ok: true, message: 'Bracket deleted.' }
}

// ---- Results --------------------------------------------------------------

export async function recordCupScoreAction(matchId: number, home: number, away: number, reason?: string): Promise<ActionResult> {
  const actor = await requireCapability('edit_results')
  const r = await svc.recordPlayoffScore(actor, matchId, home, away, reason)
  if (!r.ok) return { error: r.error }
  // Auto-verify to advance the winner immediately (admin editor is authoritative).
  await svc.verifyPlayoffMatch(actor, matchId, reason)
  const seasonId = await seasonIdOfMatch(matchId)
  if (seasonId) await syncLiveCupToSnapshot(seasonId) // published/converted cups: keep rankings current
  revalidateCup(await cupNumberOfMatch(matchId))
  return { ok: true, message: 'Result saved and winner advanced.' }
}

export async function undoCupResultAction(matchId: number, reason?: string): Promise<ActionResult> {
  const actor = await requireCapability('edit_results')
  const r = await svc.undoPlayoffResult(actor, matchId, reason)
  if (!r.ok) return { error: r.error }
  const seasonId = await seasonIdOfMatch(matchId)
  if (seasonId) await syncLiveCupToSnapshot(seasonId) // published/converted cups: keep rankings current
  revalidateCup(await cupNumberOfMatch(matchId))
  return { ok: true, message: 'Result undone.' }
}

export async function setCupMatchNoteAction(matchId: number, note: string): Promise<ActionResult> {
  const actor = await requireCapability('edit_results')
  const r = await svc.setPlayoffNote(actor, matchId, note)
  if (!r.ok) return { error: r.error }
  revalidateCup(await cupNumberOfMatch(matchId))
  return { ok: true }
}

// ---- Teams (2v2 / team cups) ----------------------------------------------

export async function createTeamAction(seasonId: number, name: string): Promise<ActionResult & { teamId?: number }> {
  const actor = await requireCapability('manage_competitions')
  const r = await teamSvc.createTeam(actor, seasonId, name)
  if (!r.ok) return { error: r.error }
  revalidateCup(await cupNumberOfSeason(seasonId))
  return { ok: true, teamId: r.teamId }
}

export async function setTeamMembersAction(teamId: number, members: teamSvc.TeamMemberInput[]): Promise<ActionResult> {
  const actor = await requireCapability('manage_competitions')
  const r = await teamSvc.setTeamMembers(actor, teamId, members)
  if (!r.ok) return { error: r.error }
  const t = await prisma.cupTeam.findUnique({ where: { id: teamId }, select: { seasonId: true } })
  revalidateCup(t ? await cupNumberOfSeason(t.seasonId) : null)
  return { ok: true, message: 'Roster saved.' }
}

export async function renameTeamAction(teamId: number, name: string): Promise<ActionResult> {
  const actor = await requireCapability('manage_competitions')
  const r = await teamSvc.renameTeam(actor, teamId, name)
  if (!r.ok) return { error: r.error }
  const t = await prisma.cupTeam.findUnique({ where: { id: teamId }, select: { seasonId: true } })
  revalidateCup(t ? await cupNumberOfSeason(t.seasonId) : null)
  return { ok: true }
}

export async function withdrawTeamAction(teamId: number): Promise<ActionResult> {
  const actor = await requireCapability('manage_competitions')
  const r = await teamSvc.withdrawTeam(actor, teamId)
  if (!r.ok) return { error: r.error }
  const t = await prisma.cupTeam.findUnique({ where: { id: teamId }, select: { seasonId: true } })
  revalidateCup(t ? await cupNumberOfSeason(t.seasonId) : null)
  return { ok: true }
}

export async function restoreTeamAction(teamId: number): Promise<ActionResult> {
  const actor = await requireCapability('manage_competitions')
  const r = await teamSvc.restoreTeam(actor, teamId)
  if (!r.ok) return { error: r.error }
  const t = await prisma.cupTeam.findUnique({ where: { id: teamId }, select: { seasonId: true } })
  revalidateCup(t ? await cupNumberOfSeason(t.seasonId) : null)
  return { ok: true }
}

export async function deleteTeamAction(teamId: number): Promise<ActionResult> {
  const actor = await requireCapability('manage_competitions')
  const t = await prisma.cupTeam.findUnique({ where: { id: teamId }, select: { seasonId: true } })
  const r = await teamSvc.deleteTeam(actor, teamId)
  if (!r.ok) return { error: r.error }
  revalidateCup(t ? await cupNumberOfSeason(t.seasonId) : null)
  return { ok: true }
}

// ---- Lifecycle ------------------------------------------------------------

export async function completeCupAction(seasonId: number, reason?: string): Promise<ActionResult> {
  const actor = await requireCapability('manage_competitions')
  const r = await svc.completeCompetition(actor, seasonId, reason)
  if (!r.ok) return { error: r.error }
  // Ensure the cup is stamped completed AND has a year/date so its results land in the
  // rolling ranking window and its champion title is credited (backfills older cups).
  const s = await prisma.season.findUnique({ where: { id: seasonId }, select: { cupYear: true, cupDate: true } })
  await prisma.season.update({
    where: { id: seasonId },
    data: {
      cupStatus: 'completed',
      ...(s?.cupYear == null ? { cupYear: new Date().getFullYear() } : {}),
      ...(s?.cupDate == null ? { cupDate: new Date().toISOString().slice(0, 10) } : {}),
    },
  })
  await syncLiveCupToSnapshot(seasonId) // reflect final bracket/champion into the snapshot (rankings/records)
  revalidateCup(await cupNumberOfSeason(seasonId))
  return { ok: true, message: 'Cup marked complete. Rankings and records updated.' }
}

/**
 * Permanently delete a LIVE cup and everything under it (entrants, teams, bracket,
 * results) — cascades via the Season row. Blocked for imported historical cups (those
 * are protected; an Owner must unlock, and even then they are not deletable here).
 * Requires typing the competition code to confirm. Regenerates the snapshot after.
 */
export async function deleteCupAction(seasonId: number, typedCode: string): Promise<ActionResult> {
  const actor = await requireCapability('manage_competitions')
  const s = await prisma.season.findUnique({ where: { id: seasonId } })
  if (!s || s.competitionType !== 'CUP') return { error: 'Cup not found.' }
  if (s.importedFromFixture || s.locked) return { error: 'Imported historical cups cannot be deleted.' }
  if (typedCode.trim() !== (s.competitionCode ?? '')) return { error: `Confirmation code does not match. Type ${s.competitionCode} to confirm deletion.` }

  const code = s.competitionCode
  const cupNumber = s.cupNumber
  await prisma.season.delete({ where: { id: seasonId } }) // cascades registrations, teams, playoff matches, bracket rows
  const { recordAudit } = await import('./audit')
  await recordAudit(actor, { action: 'cup.delete', entity: 'Season', entityId: seasonId, oldValue: { name: s.name, code, cupNumber } })
  const { regenerateCupSnapshot } = await import('@/lib/cups/migrate') // rebuild the snapshot without the deleted cup
  await regenerateCupSnapshot()
  revalidateCup(cupNumber)
  return { ok: true, message: `Deleted ${code} — Cup ${cupNumber}.` }
}

export async function archiveCupAction(seasonId: number, reason?: string): Promise<ActionResult> {
  const actor = await requireCapability('manage_competitions')
  const r = await svc.archiveCompetition(actor, seasonId, reason)
  if (!r.ok) return { error: r.error }
  revalidateCup(await cupNumberOfSeason(seasonId))
  return { ok: true, message: 'Cup archived.' }
}

export async function unarchiveCupAction(seasonId: number, reason?: string): Promise<ActionResult> {
  const actor = await requireCapability('manage_competitions')
  const r = await svc.unarchiveCompetition(actor, seasonId, reason)
  if (!r.ok) return { error: r.error }
  revalidateCup(await cupNumberOfSeason(seasonId))
  return { ok: true, message: 'Cup restored from archive.' }
}

// ---- Owner-only historical unlock / relock --------------------------------

async function requireOwnerActor() {
  const actor = await requireStaffActor()
  if (!actor.isOwner) throw new Error('Forbidden: only the Owner can unlock or relock historical competitions.')
  return actor
}

export async function unlockHistoricalCupAction(seasonId: number, typedCode: string, reason: string): Promise<ActionResult> {
  const actor = await requireOwnerActor()
  const r = await svc.unlockHistoricalCompetition(actor, seasonId, typedCode, reason)
  if (!r.ok) return { error: r.error }
  revalidateCup(await cupNumberOfSeason(seasonId))
  return { ok: true, message: 'Historical cup unlocked for editing.' }
}

export async function relockHistoricalCupAction(seasonId: number, reason?: string): Promise<ActionResult> {
  const actor = await requireOwnerActor()
  const r = await svc.relockCompetition(actor, seasonId, reason)
  if (!r.ok) return { error: r.error }
  revalidateCup(await cupNumberOfSeason(seasonId))
  return { ok: true, message: 'Historical cup re-locked.' }
}
