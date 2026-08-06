'use server'

import { requireStaffActor } from '@/lib/competition/staff-auth'
import { migrateRankedAccounts, type MigrationReport } from './ranked-accounts'

/**
 * OWNER-ONLY: run the ranked-account migration. `apply=false` (default) analyses and writes a dry-run
 * report; `apply=true` performs the idempotent writes and writes the applied report (with one-time
 * claim codes) to the admin-only migration-reports directory. Never exposed on a public route.
 */
export async function runRankedAccountMigrationAction(apply = false): Promise<{ ok: boolean; error?: string; report?: MigrationReport }> {
  const actor = await requireStaffActor()
  if (!actor.isOwner) return { ok: false, error: 'Only the Owner can run the ranked-account migration.' }
  const report = await migrateRankedAccounts(actor, { apply })
  return { ok: true, report }
}
