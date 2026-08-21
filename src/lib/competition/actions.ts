'use server'

import { revalidatePath } from 'next/cache'
import { requireCapability, requireStaffActor } from './staff-auth'
import * as svc from './service'
import type { RegistrationStatus, LiveMatchStatus } from '@prisma/client'
import { invalidateRankings } from '@/lib/stats/invalidate-rankings'

export interface ActionResult {
  ok?: boolean
  error?: string
  message?: string
}

/** Revalidate every public + staff surface that consumes competition data.
 *  Includes rankings / Hall of Fame / player pages so that editing a result makes
 *  those derived views recompute on their next read (the ranking engine itself is
 *  a pure function of the underlying data — nothing is cached server-side). */
function revalidateAll() {
  for (const p of ['/groups', '/playoffs', '/seasons', '/account', '/register', '/hall-of-fame', '/players', '/records']) revalidatePath(p)
  invalidateRankings()
  for (const p of [
    '/staff',
    '/staff/tournament',
    '/staff/registrations',
    '/staff/groups',
    '/staff/matches',
    '/staff/standings',
    '/staff/playoffs',
    '/staff/audit',
  ])
    revalidatePath(p)
}

function num(fd: FormData, name: string): number {
  return Number(fd.get(name))
}
function str(fd: FormData, name: string): string {
  return String(fd.get(name) ?? '').trim()
}

// ---- Tournament ---------------------------------------------------------------

export async function createSeasonAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const actor = await requireCapability('manage_competitions')
  const slug = str(fd, 'slug').toLowerCase().replace(/[^a-z0-9-]/g, '-')
  const name = str(fd, 'name')
  if (!slug || !name) return { error: 'Provide a Tournament name and slug.' }
  try {
    await svc.createSeason(actor, { slug, name })
    revalidateAll()
    return { ok: true, message: 'Tournament created.' }
  } catch (e) {
    const msg = e instanceof Error ? e.message : ''
    if (/unique|exists/i.test(msg)) return { error: 'A Tournament with that slug already exists.' }
    return { error: 'Could not create the Tournament.' }
  }
}

export async function updateSeasonAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const actor = await requireCapability('manage_competitions')
  const tournamentId = num(fd, 'tournamentId')
  const closesAt = str(fd, 'registrationClosesAt')
  try {
    // NOTE: registrationStatus is intentionally NOT set here — it is owned by the
    // dedicated Open/Close/Reopen controls (setRegistrationStateAction) so the
    // manual registration status stays the single authoritative source.
    await svc.updateSeason(
      actor,
      tournamentId,
      {
        status: str(fd, 'status') as 'UPCOMING' | 'ACTIVE' | 'COMPLETED',
        registrationClosesAt: closesAt ? new Date(closesAt) : null,
        groupsStatus: str(fd, 'groupsStatus') as 'PENDING' | 'PUBLISHED' | 'COMPLETED',
        playoffsStatus: str(fd, 'playoffsStatus') as 'PENDING' | 'PUBLISHED' | 'COMPLETED',
        raceLength: num(fd, 'raceLength'),
        qualifiersPerGroup: num(fd, 'qualifiersPerGroup'),
      },
      str(fd, 'reason') || undefined,
    )
    revalidateAll()
    return { ok: true, message: 'Tournament updated. Public pages refreshed.' }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Update failed.' }
  }
}

// ---- Registrations --------------------------------------------------------

export async function setRegistrationStatusAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const actor = await requireCapability('manage_registrations')
  try {
    await svc.setRegistrationStatus(actor, num(fd, 'registrationId'), str(fd, 'status') as RegistrationStatus, str(fd, 'reason') || undefined)
    revalidateAll()
    return { ok: true }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Action failed.' }
  }
}

// ---- Registration open / close / reopen -----------------------------------

export async function setRegistrationStateAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const actor = await requireCapability('manage_competitions')
  const next = str(fd, 'next') as 'NOT_OPEN' | 'OPEN' | 'CLOSED'
  if (!['NOT_OPEN', 'OPEN', 'CLOSED'].includes(next)) return { error: 'Invalid registration state.' }
  const res = await svc.setRegistrationState(actor, num(fd, 'tournamentId'), next, str(fd, 'reason') || undefined)
  if (!res.ok) return { error: res.error }
  revalidateAll()
  const label = next === 'OPEN' ? 'Registration is now open.' : next === 'CLOSED' ? 'Registration is now closed.' : 'Registration reset.'
  return { ok: true, message: label }
}

// ---- Entrants (admin-added, account-independent) ---------------------------

export interface EntrantCandidate { playerId: string; primaryName: string; cueverseId: string | null }

/** Live search for addable player profiles (for the "add entrant" combobox).
 *  Already-entered / inactive / deleted / banned profiles are excluded server-side. */
export async function searchEntrantCandidatesAction(tournamentId: number, query: string): Promise<EntrantCandidate[]> {
  await requireCapability('manage_competitions')
  const { searchEntrantCandidates } = await import('./queries')
  return searchEntrantCandidates(tournamentId, query)
}

export async function addEntrantAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const actor = await requireCapability('manage_competitions')
  const tournamentId = num(fd, 'tournamentId')
  const ids = String(fd.get('playerIds') ?? fd.get('playerId') ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  if (ids.length === 0) return { error: 'Select at least one player profile.' }
  let added = 0
  let already = 0
  for (const playerId of ids) {
    const res = await svc.addEntrantByProfile(actor, tournamentId, playerId)
    if (res.already) already++
    else if (res.ok) added++
  }
  revalidateAll()
  return { ok: true, message: `Added ${added} entrant(s)${already ? `, ${already} already in` : ''}.` }
}

/**
 * Add one entrant by player id.
 *
 * The form-driven `addEntrantAction` above is still what the Entrants tab posts; this is the direct
 * call the group screen's quick-add uses, so a missing player can be added where you notice they are
 * missing instead of stepping back to a separate registration tab.
 */
export async function addEntrantByPlayerAction(tournamentId: number, playerId: string): Promise<ActionResult> {
  const actor = await requireCapability('manage_competitions')
  const res = await svc.addEntrantByProfile(actor, tournamentId, playerId)
  if (!res.ok) return { error: res.error ?? 'Could not add that entrant.' }
  revalidateAll()
  return { ok: true, message: res.already ? 'Already entered.' : 'Entrant added.' }
}

export async function removeEntrantAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const actor = await requireCapability('manage_competitions')
  const res = await svc.removeEntrant(actor, num(fd, 'tournamentId'), num(fd, 'registrationId'), str(fd, 'reason') || undefined)
  if (!res.ok) return { error: res.error }
  revalidateAll()
  return { ok: true, message: 'Entrant removed (can be restored).' }
}

export async function restoreEntrantAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const actor = await requireCapability('manage_competitions')
  const res = await svc.restoreEntrant(actor, num(fd, 'tournamentId'), num(fd, 'registrationId'))
  if (!res.ok) return { error: res.error }
  revalidateAll()
  return { ok: true, message: 'Entrant restored.' }
}

export interface BulkImportResult extends ActionResult {
  report?: { added: string[]; duplicates: string[]; unmatched: string[] }
}

export async function bulkImportEntrantsAction(_prev: BulkImportResult, fd: FormData): Promise<BulkImportResult> {
  const actor = await requireCapability('manage_competitions')
  const lines = String(fd.get('cueverseIds') ?? '').split('\n')
  const report = await svc.bulkImportEntrants(actor, num(fd, 'tournamentId'), lines)
  revalidateAll()
  return { ok: true, report: { added: report.added, duplicates: report.duplicates, unmatched: report.unmatched }, message: `Added ${report.added.length}, ${report.duplicates.length} already in, ${report.unmatched.length} unmatched.` }
}

// ---- Groups ---------------------------------------------------------------

export async function createGroupAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const actor = await requireCapability('manage_competitions')
  const res = await svc.createGroup(actor, num(fd, 'tournamentId'))
  if (!res.ok) return { error: res.error }
  revalidateAll()
  return { ok: true, message: 'Group created.' }
}

export async function setGroupCountAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const actor = await requireCapability('manage_competitions')
  const res = await svc.setGroupCount(actor, num(fd, 'tournamentId'), num(fd, 'count'))
  if (!res.ok) return { error: res.error }
  revalidateAll()
  return { ok: true, message: 'Group count updated.' }
}

export async function swapPlayersAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const actor = await requireCapability('manage_competitions')
  const res = await svc.swapGroupPlayers(actor, num(fd, 'tournamentId'), num(fd, 'regA'), num(fd, 'regB'))
  if (!res.ok) return { error: res.error }
  revalidateAll()
  return { ok: true }
}

export async function addPlayersToGroupAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const actor = await requireCapability('manage_competitions')
  const ids = String(fd.get('registrationIds') ?? '').split(',').map((s) => Number(s.trim())).filter((n) => Number.isFinite(n) && n > 0)
  if (ids.length === 0) return { error: 'Select at least one player.' }
  const res = await svc.addPlayersToGroup(actor, num(fd, 'tournamentId'), num(fd, 'groupId'), ids)
  if (!res.ok) return { error: res.error }
  revalidateAll()
  return { ok: true, message: `Added ${res.added} player(s).` }
}

export async function renameGroupAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const actor = await requireCapability('manage_competitions')
  const res = await svc.renameGroup(actor, num(fd, 'tournamentId'), num(fd, 'groupId'), str(fd, 'name'))
  if (!res.ok) return { error: res.error }
  revalidateAll()
  return { ok: true, message: 'Group renamed.' }
}

export async function deleteGroupAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const actor = await requireCapability('manage_competitions')
  const res = await svc.deleteGroup(actor, num(fd, 'tournamentId'), num(fd, 'groupId'))
  if (!res.ok) return { error: res.error }
  revalidateAll()
  return { ok: true, message: 'Group deleted.' }
}

export async function moveGroupAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const actor = await requireCapability('manage_competitions')
  const res = await svc.moveGroup(actor, num(fd, 'tournamentId'), num(fd, 'groupId'), str(fd, 'direction') as 'up' | 'down')
  if (!res.ok) return { error: res.error }
  revalidateAll()
  return { ok: true }
}

export async function addPlayerToGroupAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const actor = await requireCapability('manage_competitions')
  if (!fd.get('registrationId')) return { error: 'Select a player to add.' }
  const res = await svc.addPlayerToGroup(actor, num(fd, 'tournamentId'), num(fd, 'groupId'), num(fd, 'registrationId'), {
    force: fd.get('force') === 'on',
  })
  if (!res.ok) return { error: res.error }
  revalidateAll()
  return { ok: true, message: 'Player added.' }
}

export async function removePlayerFromGroupAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const actor = await requireCapability('manage_competitions')
  const res = await svc.removePlayerFromGroup(actor, num(fd, 'tournamentId'), num(fd, 'groupId'), num(fd, 'registrationId'), {
    force: fd.get('force') === 'on',
  })
  if (!res.ok) return { error: res.error }
  revalidateAll()
  return { ok: true }
}

export async function reorderGroupPlayerAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const actor = await requireCapability('manage_competitions')
  const res = await svc.reorderGroupPlayer(actor, num(fd, 'tournamentId'), num(fd, 'groupId'), num(fd, 'registrationId'), str(fd, 'direction') as 'up' | 'down')
  if (!res.ok) return { error: res.error }
  revalidateAll()
  return { ok: true }
}

export async function unpublishGroupsAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const actor = await requireCapability('manage_competitions')
  const res = await svc.unpublishGroups(actor, num(fd, 'tournamentId'))
  if (!res.ok) return { error: res.error }
  revalidateAll()
  return { ok: true, message: 'Groups unpublished — hidden from the public site.' }
}

export async function generateGroupsAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const actor = await requireCapability('manage_competitions')
  const res = await svc.generateGroups(actor, num(fd, 'tournamentId'), num(fd, 'numGroups'), str(fd, 'seed') || undefined, {
    force: fd.get('force') === 'on',
  })
  if (!res.ok) return { error: res.error }
  revalidateAll()
  return { ok: true, message: `Groups generated (seed ${res.seed}).` }
}

export async function movePlayerAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const actor = await requireCapability('manage_competitions')
  const res = await svc.movePlayer(actor, num(fd, 'tournamentId'), num(fd, 'registrationId'), num(fd, 'toGroupId'), {
    force: fd.get('force') === 'on',
  })
  if (!res.ok) return { error: res.error }
  revalidateAll()
  return { ok: true }
}

export async function publishGroupsAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const actor = await requireCapability('manage_competitions')
  const res = await svc.publishGroups(actor, num(fd, 'tournamentId'))
  if (!res.ok) return { error: res.error }
  revalidateAll()
  return { ok: true, message: 'Groups published. Round-robin matches generated.' }
}

// ---- Matches --------------------------------------------------------------

export async function recordScoreAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const actor = await requireCapability('edit_results')
  const res = await svc.recordScore(actor, num(fd, 'matchId'), num(fd, 'homeGames'), num(fd, 'awayGames'), str(fd, 'reason') || undefined)
  if (!res.ok) return { error: res.error }
  revalidateAll()
  return { ok: true }
}

export async function setResolutionAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const actor = await requireCapability('edit_results')
  const kind = str(fd, 'kind') as Extract<LiveMatchStatus, 'FORFEIT' | 'NO_SHOW' | 'DISPUTED'>
  const winner = fd.get('winnerRegistrationId') ? num(fd, 'winnerRegistrationId') : null
  const res = await svc.setMatchResolution(actor, num(fd, 'matchId'), kind, winner, str(fd, 'reason') || undefined)
  if (!res.ok) return { error: res.error }
  revalidateAll()
  return { ok: true }
}

export async function verifyMatchAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const actor = await requireCapability('edit_results')
  const res = await svc.verifyMatch(actor, num(fd, 'matchId'), fd.get('verified') !== 'false', str(fd, 'reason') || undefined)
  if (!res.ok) return { error: res.error }
  revalidateAll()
  return { ok: true }
}

export async function undoMatchAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const actor = await requireCapability('edit_results')
  const res = await svc.undoMatchResult(actor, num(fd, 'matchId'), str(fd, 'reason') || undefined)
  if (!res.ok) return { error: res.error }
  revalidateAll()
  return { ok: true, message: 'Result undone. Standings and rankings recalculated.' }
}

export async function setMatchNoteAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const actor = await requireCapability('edit_results')
  const res = await svc.setMatchNote(actor, num(fd, 'matchId'), str(fd, 'note'))
  if (!res.ok) return { error: res.error }
  revalidateAll()
  return { ok: true, message: 'Note saved.' }
}

// ---- Playoffs -------------------------------------------------------------

export async function generatePlayoffAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const actor = await requireCapability('manage_competitions')
  const res = await svc.generatePlayoff(actor, num(fd, 'tournamentId'), { force: fd.get('force') === 'on' })
  if (!res.ok) return { error: res.error }
  revalidateAll()
  return { ok: true, message: 'Playoff bracket generated.' }
}

export async function publishPlayoffAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const actor = await requireCapability('manage_competitions')
  const res = await svc.publishPlayoff(actor, num(fd, 'tournamentId'))
  if (!res.ok) return { error: res.error }
  revalidateAll()
  return { ok: true, message: 'Playoffs published.' }
}

export async function rebuildManualPlayoffAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const actor = await requireCapability('manage_competitions')
  const ids = String(fd.get('registrationIds') ?? '').split(',').map((s) => Number(s.trim())).filter((n) => Number.isFinite(n) && n > 0)
  const res = await svc.rebuildManualPlayoff(actor, num(fd, 'tournamentId'), ids)
  if (!res.ok) return { error: res.error }
  revalidateAll()
  return { ok: true }
}

export async function returnPlayoffToDraftAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const actor = await requireCapability('manage_competitions')
  const res = await svc.returnPlayoffToDraft(actor, num(fd, 'tournamentId'))
  if (!res.ok) return { error: res.error }
  revalidateAll()
  return { ok: true, message: 'Bracket returned to draft.' }
}

export async function deletePlayoffAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const actor = await requireCapability('manage_competitions')
  const res = await svc.deletePlayoff(actor, num(fd, 'tournamentId'))
  if (!res.ok) return { error: res.error }
  revalidateAll()
  return { ok: true, message: 'Bracket deleted.' }
}

export async function recordPlayoffScoreAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const actor = await requireCapability('edit_results')
  const res = await svc.recordPlayoffScore(actor, num(fd, 'matchId'), num(fd, 'homeGames'), num(fd, 'awayGames'), str(fd, 'reason') || undefined)
  if (!res.ok) return { error: res.error }
  revalidateAll()
  return { ok: true }
}

export async function verifyPlayoffMatchAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const actor = await requireCapability('edit_results')
  const res = await svc.verifyPlayoffMatch(actor, num(fd, 'matchId'), str(fd, 'reason') || undefined)
  if (!res.ok) return { error: res.error }
  revalidateAll()
  return { ok: true }
}

export async function undoPlayoffMatchAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const actor = await requireCapability('edit_results')
  const res = await svc.undoPlayoffResult(actor, num(fd, 'matchId'), str(fd, 'reason') || undefined)
  if (!res.ok) return { error: res.error }
  revalidateAll()
  return { ok: true, message: 'Playoff result undone. Bracket advancement reverted.' }
}

export async function setPlayoffNoteAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const actor = await requireCapability('edit_results')
  const res = await svc.setPlayoffNote(actor, num(fd, 'matchId'), str(fd, 'note'))
  if (!res.ok) return { error: res.error }
  revalidateAll()
  return { ok: true, message: 'Note saved.' }
}

// ---- Competition lifecycle -------------------------------------------------

export async function completeCompetitionAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const actor = await requireCapability('manage_competitions')
  const res = await svc.completeCompetition(actor, num(fd, 'tournamentId'), str(fd, 'reason') || undefined)
  if (!res.ok) return { error: res.error }
  revalidateAll()
  return { ok: true, message: 'Competition marked complete.' }
}

export async function archiveCompetitionAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const actor = await requireCapability('manage_competitions')
  const res = await svc.archiveCompetition(actor, num(fd, 'tournamentId'), str(fd, 'reason') || undefined)
  if (!res.ok) return { error: res.error }
  revalidateAll()
  return { ok: true, message: 'Competition archived.' }
}

export async function unarchiveCompetitionAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const actor = await requireCapability('manage_competitions')
  const res = await svc.unarchiveCompetition(actor, num(fd, 'tournamentId'), str(fd, 'reason') || undefined)
  if (!res.ok) return { error: res.error }
  revalidateAll()
  return { ok: true, message: 'Competition restored from archive.' }
}

// ---- Historical TournamentView lock (OWNER only) --------------------------------------

async function requireOwnerActor() {
  const actor = await requireStaffActor()
  if (!actor.isOwner) throw new Error('Forbidden: only the Owner can unlock or relock historical competitions.')
  return actor
}

export async function unlockCompetitionAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const actor = await requireOwnerActor()
  const res = await svc.unlockHistoricalCompetition(actor, num(fd, 'tournamentId'), str(fd, 'code'), str(fd, 'reason'))
  if (!res.ok) return { error: res.error }
  revalidateAll()
  return { ok: true, message: 'Historical competition unlocked for editing.' }
}

export async function relockCompetitionAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const actor = await requireOwnerActor()
  const res = await svc.relockCompetition(actor, num(fd, 'tournamentId'), str(fd, 'reason') || undefined)
  if (!res.ok) return { error: res.error }
  revalidateAll()
  return { ok: true, message: 'Competition re-locked.' }
}
