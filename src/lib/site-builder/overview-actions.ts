'use server'

/**
 * Reads the control centre performs on demand.
 *
 * Separate from `overview.ts` because that module is imported by a server COMPONENT, and a file
 * marked `'use server'` may only export async functions — mixing the overview types and helpers into
 * it would make the whole module an action surface.
 */

import { requireCapability } from '@/lib/competition/staff-auth'
import { getRevisions } from './overview'

export async function getRevisionsAction(key: string) {
  // A read, and capability-checked exactly like a write: revision history names who published what
  // and when, and includes documents that were never made public.
  await requireCapability('manage_site_builder')
  return getRevisions(key)
}
