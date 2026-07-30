'use server'

import { revalidatePath } from 'next/cache'
import { getReviewer, hasReviewAccess } from './auth'
import { recordDecision } from './decisions'
import { reviewConfig, BATCH_ACTIONS, NEUTRAL_RESOLUTION, type ReviewStatus } from './config'

export interface SaveResult {
  ok: boolean
  error?: string
  savedResolution?: string
  savedStatus?: string
}

/** Server action: record a review decision. Authorized (admin/senior_editor) only.
 *  Corrections require a cited source + reviewer note. Never overwrites history. */
export async function saveDecision(_prev: SaveResult, formData: FormData): Promise<SaveResult> {
  const reviewer = await getReviewer()
  if (!hasReviewAccess(reviewer)) return { ok: false, error: 'Not authorized.' }

  const issueId = String(formData.get('issueId') ?? '')
  const category = String(formData.get('category') ?? '')
  const resolution = String(formData.get('resolution') ?? '')
  const status = String(formData.get('status') ?? 'pending')
  const note = (String(formData.get('note') ?? '').trim() || null) as string | null
  const relatedIds = String(formData.get('relatedIds') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

  const cat = reviewConfig.categories[category]
  if (!cat || !cat.resolutions.includes(resolution)) return { ok: false, error: 'Invalid resolution for this category.' }
  if (!reviewConfig.statuses.includes(status as ReviewStatus)) return { ok: false, error: 'Invalid status.' }

  let evidence: Record<string, unknown> | null = null
  if (cat.correctionResolutions?.includes(resolution)) {
    const source = String(formData.get('source') ?? '').trim()
    if (!source || !note) return { ok: false, error: 'A correction requires a cited source reference AND a reviewer note.' }
    const ra = String(formData.get('replacementA') ?? '').trim()
    const rb = String(formData.get('replacementB') ?? '').trim()
    evidence = {
      source,
      replacementA: ra === '' ? null : Number(ra),
      replacementB: rb === '' ? null : Number(rb),
      confidence: 'reviewer-corrected',
    }
  } else if (cat.evidenceResolutions?.includes(resolution)) {
    const source = String(formData.get('source') ?? '').trim()
    if (!source) return { ok: false, error: 'This resolution requires cited evidence (a source reference).' }
    evidence = { source }
  }

  recordDecision({
    issueId,
    category,
    relatedIds,
    resolution,
    status: status as ReviewStatus,
    note,
    evidence,
    reviewer: reviewer!.email,
  })

  revalidatePath('/archive-review')
  return { ok: true, savedResolution: resolution, savedStatus: status }
}

/* ------------------------------ safe batch review ------------------------------ */

export interface BatchResult {
  ok: boolean
  error?: string
  count?: number
  batchId?: string
  action?: string
}

/** Direct-call server action. Records ONE decision per issue with a shared batchId.
 *  Restricted to the safe allowlist; requires a reviewer note; preserves each issue's
 *  individual decision history; reversible via new decisions (never deletion). */
export async function saveBatchDecision(input: {
  category: string
  batchAction: string
  note: string
  reviewerReason?: string
  issueIds: string[]
}): Promise<BatchResult> {
  const reviewer = await getReviewer()
  if (!hasReviewAccess(reviewer)) return { ok: false, error: 'Not authorized.' }

  const action = BATCH_ACTIONS[input.batchAction]
  if (!action) return { ok: false, error: 'That batch action is not permitted.' }
  if (!action.cats.includes(input.category)) return { ok: false, error: `“${input.batchAction}” is not allowed for ${input.category}.` }
  const note = input.note?.trim()
  if (!note) return { ok: false, error: 'A reviewer note is required for every batch action.' }
  const issueIds = (input.issueIds ?? []).filter(Boolean)
  if (issueIds.length === 0) return { ok: false, error: 'No issues selected.' }

  const resolution = action.resolution ?? NEUTRAL_RESOLUTION[input.category]
  const cat = reviewConfig.categories[input.category]
  if (!cat || !cat.resolutions.includes(resolution)) return { ok: false, error: 'Resolution not valid for this category.' }

  const batchId = `batch-${Math.random().toString(36).slice(2, 8)}-${Date.now().toString(36)}`
  for (const issueId of issueIds) {
    recordDecision({
      issueId,
      category: input.category,
      relatedIds: [],
      resolution,
      status: action.status,
      note,
      reviewerReason: input.reviewerReason ?? null,
      batchId,
      relatedDecisionIds: issueIds,
      reviewer: reviewer!.email,
    })
  }
  revalidatePath('/archive-review')
  return { ok: true, count: issueIds.length, batchId, action: input.batchAction }
}
