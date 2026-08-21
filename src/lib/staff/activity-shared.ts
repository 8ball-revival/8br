/** Client-safe Activity Log types + classification (pure, no server-only / no DB). */

export const ACTIVITY_CATEGORIES = [
  'Authentication', 'Accounts', 'Password resets', 'Roles', 'Seasons', 'Tournaments', 'Registration',
  'Teams', 'Results', 'FF', 'KO', 'No Contest', 'Wildcards', 'Disqualifications', 'Rankings', 'Awards',
  'Settings', 'Deletion', 'Security', 'System', 'QA',
] as const
export type ActivityCategory = (typeof ACTIVITY_CATEGORIES)[number]
export type Severity = 'info' | 'notice' | 'warning' | 'critical'

const QA_ACTOR = /verify|vis-|field-|(^|[^a-z])qa([^a-z]|$)/i

/** Automated verification/QA actors and the internal `system` actor. */
export function actorClass(actorUsername: string): 'human' | 'qa' | 'system' {
  if (actorUsername === 'system') return 'system'
  if (QA_ACTOR.test(actorUsername)) return 'qa'
  return 'human'
}

/** Map an audit action + actor to a category + severity. QA/System classification overrides so
 *  automated noise is filtered from the default human view. */
export function classify(action: string, actorUsername: string): { category: ActivityCategory; severity: Severity } {
  const a = action.toLowerCase()
  const cls = actorClass(actorUsername)
  const category: ActivityCategory =
    cls === 'system' ? 'System'
    : cls === 'qa' ? 'QA'
    : /password/.test(a) ? 'Password resets'
    : /disqualif/.test(a) ? 'Disqualifications'
    : /wildcard/.test(a) ? 'Wildcards'
    : /forfeit|\bff\b/.test(a) ? 'FF'
    : /kick|\bko\b/.test(a) ? 'KO'
    : /no.?contest|void/.test(a) ? 'No Contest'
    : /role|promote|demote|headadmin|head_admin|owner/.test(a) ? 'Roles'
    : /login|logout|auth|session|signin|sign_in/.test(a) ? 'Authentication'
    : /delete|purge/.test(a) ? 'Deletion'
    : /security|lock|unlock/.test(a) ? 'Security'
    : /award|trophy|champion|diamond/.test(a) ? 'Awards'
    : /rank|ladder|rating/.test(a) ? 'Rankings'
    : /setting/.test(a) ? 'Settings'
    : /registration|entrant|register/.test(a) ? 'Registration'
    : /team|free.?agent|roster/.test(a) ? 'Teams'
    : /result|score|correct|report|save/.test(a) ? 'Results'
    : /account|user|suspend|ban|warn|timeout|moderat/.test(a) ? 'Accounts'
    : /season/.test(a) ? 'Seasons'
    : /tournament|cup|playoff|swiss|group|bracket/.test(a) ? 'Tournaments'
    : 'Accounts'

  const severity: Severity =
    /delete|purge|ban|disqualif|kick|\bko\b/.test(a) ? 'critical'
    : /password|role|promote|demote|headadmin|close|complete|reversal|revert|correct/.test(a) ? 'warning'
    : /reset|suspend|timeout|setting|unlock/.test(a) ? 'notice'
    : 'info'

  return { category, severity }
}

export interface ActivityFilters {
  search?: string
  from?: string
  to?: string
  actor?: string
  target?: string
  category?: ActivityCategory | ''
  action?: string
  severity?: Severity | ''
  includeAutomated?: boolean
}

export interface ActivityRow {
  id: number
  createdAt: string
  actorUsername: string
  action: string
  entity: string
  entityId: string | null
  category: ActivityCategory
  severity: Severity
  reason: string | null
  oldValue: unknown
  newValue: unknown
}

export interface ActivityPage { rows: ActivityRow[]; total: number; page: number; pageSize: number }
