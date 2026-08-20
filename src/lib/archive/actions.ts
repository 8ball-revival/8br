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

export { isBlocked }
