'use server'
import { requireStaffActor } from '@/lib/competition/staff-auth'
import { getActivityLog, type ActivityFilters } from './activity-log'

export interface CsvResult { ok?: boolean; error?: string; csv?: string; filename?: string }

const csvCell = (v: unknown): string => {
  const s = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** Export filtered activity as CSV. Only the Head Admin may export the COMPLETE log (including System
 *  + QA); Admins may export the operational (human) subset they can already see. Never includes
 *  secrets — audit rows already exclude passwords/tokens/hashes by construction. */
export async function exportActivityCsvAction(filters: ActivityFilters): Promise<CsvResult> {
  const actor = await requireStaffActor()
  if (!actor.can('view_audit')) return { error: 'Not authorized to export the Activity Log.' }
  // Admins cannot pull the full System/QA log; force the human-only view for non-Head-Admins.
  const effective: ActivityFilters = actor.isHeadAdmin ? filters : { ...filters, includeAutomated: false }
  const { rows } = await getActivityLog(effective, 1, 100000)
  const header = ['timestamp', 'actor', 'action', 'category', 'severity', 'entity', 'targetId', 'reason', 'before', 'after']
  const lines = [header.join(',')]
  for (const r of rows) {
    lines.push([r.createdAt, r.actorUsername, r.action, r.category, r.severity, r.entity, r.entityId ?? '', r.reason ?? '', r.oldValue, r.newValue].map(csvCell).join(','))
  }
  return { ok: true, csv: lines.join('\n'), filename: `8br-activity-log-${new Date().toISOString().slice(0, 10)}.csv` }
}
