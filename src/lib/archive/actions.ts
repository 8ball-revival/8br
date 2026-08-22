'use server'

import { revalidatePath } from 'next/cache'

import { requireCapability } from '@/lib/competition/staff-auth'
import {
  previewGroupAssign, applyGroupAssign,
  previewGroupScores, applyGroupScores,
  isBlocked,
  type GroupAssignPlan, type ScorePlan, type AutoAssignBlocked,
  type ApplyResult, type ScoreApplyResult,
} from './auto-assign'

/**
 * The Auto Assign endpoints.
 *
 * Permission is checked HERE as well as inside the services. A hidden button is not a permission
 * check — the action is reachable by anyone who can post to it — so every one of these establishes
 * who is asking before it does anything, and the transaction checks again before it writes.
 */

const parseId = (v: unknown): number | null => {
  const n = Number(v)
  return Number.isInteger(n) && n > 0 ? n : null
}

/**
 * Manual resolutions are Season-scoped and arrive from the preview.
 *
 * They map an archived handle to one of the entrants ALREADY selected for this Season. They never
 * become a global alias: promoting a historical handle onto a canonical Player is a separate,
 * deliberate act the owner takes elsewhere, and doing it as a side effect of clicking Apply would
 * quietly rewrite an identity across the whole site.
 */
function parseResolutions(input: unknown): Record<string, number> {
  if (!input || typeof input !== 'object') return {}
  const out: Record<string, number> = {}
  for (const [sourceId, entrantId] of Object.entries(input as Record<string, unknown>)) {
    const id = parseId(entrantId)
    if (id != null && /^[A-Za-z0-9_-]{1,40}$/.test(sourceId)) out[sourceId] = id
  }
  return out
}

export async function previewGroupAssignAction(
  seasonId: unknown,
  resolutions?: unknown,
): Promise<GroupAssignPlan | AutoAssignBlocked> {
  await requireCapability('manage_competitions')
  const id = parseId(seasonId)
  if (id == null) return { blocked: true, reason: 'That is not a valid Season.' }
  return previewGroupAssign(id, parseResolutions(resolutions))
}

export async function applyGroupAssignAction(
  seasonId: unknown,
  resolutions?: unknown,
): Promise<ApplyResult> {
  const actor = await requireCapability('manage_competitions')
  const id = parseId(seasonId)
  if (id == null) {
    return { ok: false, error: 'That is not a valid Season.', placed: 0, alreadyCorrect: 0, conflicts: 0, unresolved: 0, unusedEntrants: 0, groupsCreated: 0 }
  }

  const result = await applyGroupAssign(
    { userId: actor.userId, username: actor.username },
    id,
    parseResolutions(resolutions),
  )
  if (result.ok) {
    revalidatePath(`/seasons/${id}`)
    revalidatePath(`/creator/seasons/${id}`)
  }
  return result
}

export async function previewGroupScoresAction(seasonId: unknown): Promise<ScorePlan | AutoAssignBlocked> {
  await requireCapability('manage_competitions')
  const id = parseId(seasonId)
  if (id == null) return { blocked: true, reason: 'That is not a valid Season.' }
  return previewGroupScores(id)
}

export async function applyGroupScoresAction(seasonId: unknown): Promise<ScoreApplyResult> {
  const actor = await requireCapability('manage_competitions')
  const id = parseId(seasonId)
  if (id == null) {
    return { ok: false, error: 'That is not a valid Season.', applied: 0, alreadyMatched: 0, conflicted: 0, unresolved: 0 }
  }

  const result = await applyGroupScores({ userId: actor.userId, username: actor.username }, id)
  if (result.ok) {
    revalidatePath(`/seasons/${id}`)
    revalidatePath(`/creator/seasons/${id}`)
  }
  return result
}

// ───────────────────────────────────────────────────────────── Auto Add Entrants

export async function previewAutoEntrantsAction(seasonId: unknown) {
  await requireCapability('manage_competitions')
  const id = parseId(seasonId)
  if (id == null) return { blocked: true as const, reason: 'That is not a valid Season.' }
  const { previewAutoEntrants } = await import('./auto-entrants')
  return previewAutoEntrants(id)
}

export async function applyAutoEntrantsAction(seasonId: unknown) {
  const actor = await requireCapability('manage_competitions')
  const id = parseId(seasonId)
  if (id == null) {
    return { ok: false, error: 'That is not a valid Season.', added: 0, alreadyEntered: 0, ambiguous: 0, missing: 0 }
  }
  const { applyAutoEntrants } = await import('./auto-entrants')
  const result = await applyAutoEntrants({ userId: actor.userId, username: actor.username }, id)
  if (result.ok) {
    revalidatePath(`/seasons/${id}`)
    revalidatePath(`/creator/seasons/${id}`)
  }
  return result
}

// ─────────────────────────────────────────── Select Playoff Entrants / Apply Archive Placement

/*
 * Two actions, because they are two decisions.
 *
 * Selecting the playoff field is a set of checkboxes and is safe to redo. Reproducing the archived
 * draw rearranges a bracket somebody may have arranged by hand. They shared a button once, which
 * meant the safe one could not be done without risking the other.
 *
 * Both read the same preview — there is one archive matcher and it stays that way.
 */

export async function previewArchiveSelectionAction(seasonId: unknown) {
  await requireCapability('manage_competitions')
  const id = parseId(seasonId)
  if (id == null) return { blocked: true as const, reason: 'That is not a valid Season.' }
  const { previewPlayoffBracket } = await import('./auto-playoffs')
  return previewPlayoffBracket(id)
}

/** The placement preview is the same read; the difference is what is done with it. */
export const previewArchivePlacementAction = previewArchiveSelectionAction

export async function applyArchiveSelectionAction(seasonId: unknown) {
  const actor = await requireCapability('manage_competitions')
  const id = parseId(seasonId)
  if (id == null) {
    return { ok: false, error: 'That is not a valid Season.', selected: 0, excluded: 0, missing: 0, ambiguous: 0 }
  }
  const { applyArchiveSelection } = await import('./auto-playoffs')
  const result = await applyArchiveSelection({ userId: actor.userId, username: actor.username }, id)
  if (result.ok) {
    revalidatePath(`/creator/seasons/${id}/playoffs`)
    revalidatePath(`/creator/seasons/${id}`)
  }
  return result
}

export async function applyArchivePlacementAction(seasonId: unknown, replaceDraft?: unknown) {
  const actor = await requireCapability('manage_competitions')
  const id = parseId(seasonId)
  if (id == null) {
    return { ok: false, error: 'That is not a valid Season.', selected: 0, excluded: 0, placed: 0, unresolvedSlots: 0, missing: 0, ambiguous: 0 }
  }
  const { applyArchivePlacement } = await import('./auto-playoffs')
  const result = await applyArchivePlacement(
    { userId: actor.userId, username: actor.username },
    id,
    { replaceDraft: replaceDraft === true },
  )
  if (result.ok) {
    revalidatePath(`/creator/seasons/${id}/playoffs`)
    revalidatePath(`/creator/seasons/${id}`)
  }
  return result
}

// ─────────────────────────────────────────────────────── Place Entrants

/**
 * Seat the archived players on the bracket that already exists.
 *
 * Separate from Build Playoff Bracket on purpose: that one draws a bracket and demands the whole
 * field; this one arranges the bracket in front of you and reports whoever it could not confirm.
 */
export async function previewPlacementAction(seasonId: unknown) {
  await requireCapability('manage_competitions')
  const id = parseId(seasonId)
  if (id == null) return { blocked: true as const, reason: 'That is not a valid Season.' }
  const { previewPlacement } = await import('./auto-playoffs')
  return previewPlacement(id)
}

export async function applyPlacementAction(seasonId: unknown) {
  const actor = await requireCapability('manage_competitions')
  const id = parseId(seasonId)
  if (id == null) return { ok: false, error: 'That is not a valid Season.', placed: 0, skipped: 0, displaced: 0 }
  const { applyPlacement } = await import('./auto-playoffs')
  const result = await applyPlacement({ userId: actor.userId, username: actor.username }, id)
  if (result.ok) {
    revalidatePath(`/seasons/${id}`)
    revalidatePath(`/creator/seasons/${id}`)
  }
  return result
}

export { isBlocked }
