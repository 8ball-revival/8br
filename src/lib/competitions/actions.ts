'use server'

import { revalidatePath } from 'next/cache'
import { requireCapability } from '@/lib/competition/staff-auth'
import {
  createCompetition,
  updateCompetition,
  deleteCompetition,
  listActiveCompetitions,
  listCompetitionsForAdmin,
  type CompetitionAdminRow,
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

/** Staff table rows (every Competition + its Season count). ADMIN/OWNER only. */
export async function listCompetitionsForAdminAction(): Promise<CompetitionAdminRow[]> {
  await requireCapability('manage_competitions')
  return listCompetitionsForAdmin()
}

/** Delete a Competition. Refused server-side while any Season still belongs to it. */
export async function deleteCompetitionAction(id: number): Promise<CompetitionActionResult> {
  const actor = await requireCapability('manage_competitions')
  const res = await deleteCompetition(actor, id)
  if (!res.ok) return { error: res.error ?? 'Could not delete the Competition.' }
  revalidatePath('/seasons')
  revalidatePath('/staff/competitions')
  return { ok: true }
}

/**
 * Attach, replace or remove a Competition icon.
 *
 * The file itself is uploaded to the existing Payload Media collection by the client (which is
 * already authenticated and gated by Media's staff-only `create` access); this action only records
 * the resulting filename against the Competition. Passing null removes it, so the badge falls back
 * to initials. Re-gated here so the association cannot be set by a non-admin.
 */
export async function setCompetitionIconAction(
  id: number,
  filename: string | null,
): Promise<CompetitionActionResult> {
  const actor = await requireCapability('manage_competitions')
  const res = await updateCompetition(actor, id, { iconMediaId: filename })
  if (!res.ok) return { error: res.error ?? 'Could not update the Competition icon.' }
  revalidatePath('/seasons')
  revalidatePath('/staff/competitions')
  return { ok: true, competition: res.competition }
}
