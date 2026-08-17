'use server'

import { revalidatePath } from 'next/cache'

import { requireCapability } from '@/lib/competition/staff-auth'
import { createMember, type CreateMemberInput, type CreateMemberResult } from './create-member-service'

/**
 * Staff-created member accounts (server action).
 *
 * The work lives in `create-member-service`, which takes an explicit actor and can therefore also be
 * called from a script. This wrapper adds only the two things that need a request: the capability
 * gate and the cache revalidation.
 *
 * A 'use server' module may only export async functions. It must NOT re-export the input/output
 * types: the server-actions loader turns every export in here into a runtime binding, so a
 * `export type { ... }` line becomes a reference to something that does not exist at runtime and the
 * whole action module fails to evaluate. Import those types from `create-member-service` instead.
 *
 * Gated on `manage_players` (ADMIN or OWNER). New accounts are always created as `member` — this is
 * not a route to mint staff; role changes go through the separate, Owner-gated roles service.
 */
export async function createMemberAction(input: CreateMemberInput): Promise<CreateMemberResult> {
  const actor = await requireCapability('manage_players')
  const res = await createMember(actor, input)
  if (res.ok) revalidatePath('/staff/members')
  return res
}
