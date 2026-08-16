'use server'

import { revalidatePath } from 'next/cache'
import { requireCapability } from '@/lib/competition/staff-auth'
import {
  createCompetition,
  updateCompetition,
  listActiveCompetitions,
  type CompetitionRef,
  type CreateCompetitionInput,
} from './service'

/**
 * Server actions for Competition records.
 *
 * Every mutating action is gated on `manage_competitions`, which resolves to ADMIN or OWNER
 * (see CAPABILITY_RULES). Regular members and any non-admin staff tier cannot create or edit a
 * Competition — the gate is enforced here on the server, never by hiding UI.
 */

export interface CompetitionActionResult {
  ok?: boolean
  error?: string
  competition?: CompetitionRef
}

export async function createCompetitionAction(
  input: CreateCompetitionInput,
): Promise<CompetitionActionResult> {
  const actor = await requireCapability('manage_competitions')
  const res = await createCompetition(actor, input)
  if (!res.ok) return { error: res.error ?? 'Could not create the Competition.' }
  revalidatePath('/seasons')
  return { ok: true, competition: res.competition }
}

export async function updateCompetitionAction(
  id: number,
  patch: Partial<CreateCompetitionInput> & { active?: boolean },
): Promise<CompetitionActionResult> {
  const actor = await requireCapability('manage_competitions')
  const res = await updateCompetition(actor, id, patch)
  if (!res.ok) return { error: res.error ?? 'Could not update the Competition.' }
  revalidatePath('/seasons')
  return { ok: true, competition: res.competition }
}

/** Active Competitions for the Season form selector. Read-only, so any signed-in staff may load it. */
export async function listActiveCompetitionsAction(): Promise<CompetitionRef[]> {
  await requireCapability('manage_competitions')
  return listActiveCompetitions()
}
