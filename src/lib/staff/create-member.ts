'use server'

import { revalidatePath } from 'next/cache'

import { requireCapability } from '@/lib/competition/staff-auth'
import { createMember, type CreateMemberInput, type CreateMemberResult } from './create-member-service'

/**
 * Staff-created member accounts (server action).
 *
 * The work lives in `create-member-service` so that the archive importer creates accounts through
 * exactly the same code path as this button — one implementation, one set of rules. This wrapper
 * adds only the capability gate and the cache revalidation, both of which need a request.
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

export type { CreateMemberInput, CreateMemberResult }
