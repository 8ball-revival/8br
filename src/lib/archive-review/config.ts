import raw from '../../../scripts/archive/review-config.json'

export type ReviewStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'deferred'
  | 'needs_evidence'
  | 'resolved'

export interface ReviewCategoryConfig {
  label: string
  hint: string
  resolutions: string[]
  correctionResolutions?: string[]
  evidenceResolutions?: string[]
}

export interface ReviewConfig {
  statuses: ReviewStatus[]
  appliedStatuses: ReviewStatus[]
  categories: Record<string, ReviewCategoryConfig>
}

export const reviewConfig = raw as unknown as ReviewConfig

export const CATEGORY_ORDER = [
  'shared-alias',
  'merge-candidate',
  'name-duplicate',
  'match',
  'championship',
  'historical-note',
  'entry-method',
] as const

// The ONLY permitted batch actions. Anything not here (merges, score/winner
// corrections, evidence-required upgrades, disputed-note publication, alias-ownership)
// is intentionally non-batchable.
export const BATCH_ACTIONS: Record<
  string,
  { label: string; cats: string[]; status: ReviewStatus; resolution?: string }
> = {
  defer: { label: 'Defer selected', cats: ['shared-alias', 'merge-candidate', 'name-duplicate', 'match', 'championship'], status: 'deferred' },
  needs_evidence: { label: 'Mark needs evidence', cats: ['shared-alias', 'merge-candidate', 'name-duplicate', 'match', 'championship'], status: 'needs_evidence' },
  approve_preserve: { label: 'Approve — preserve raw values', cats: ['match'], status: 'approved', resolution: 'preserve_as_archived' },
  approve_current_confidence: { label: 'Approve current confidence', cats: ['championship'], status: 'approved', resolution: 'approve_current_confidence' },
  entry_historical_import: { label: 'Set to Historical Import', cats: ['entry-method'], status: 'approved', resolution: 'historical_import' },
  name_different_people: { label: 'Mark as Different People', cats: ['name-duplicate'], status: 'approved', resolution: 'different_people' },
}

export const NEUTRAL_RESOLUTION: Record<string, string> = {
  'shared-alias': 'needs_evidence',
  'merge-candidate': 'needs_evidence',
  'name-duplicate': 'insufficient_evidence',
  match: 'needs_evidence',
  championship: 'needs_evidence',
}

export function batchActionsForCategory(category: string): { key: string; label: string }[] {
  return Object.entries(BATCH_ACTIONS)
    .filter(([, a]) => a.cats.includes(category))
    .map(([key, a]) => ({ key, label: a.label }))
}

export function resolutionLabel(res: string): string {
  return res.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase())
}
export function statusLabel(s: string): string {
  return s.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase())
}
