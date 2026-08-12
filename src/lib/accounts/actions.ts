'use server'

import { revalidatePath } from 'next/cache'
import { requireCapability } from '@/lib/competition/staff-auth'
import { addEntrantByProfile } from '@/lib/competition/service'
import { getActiveSeason } from '@/lib/competition/queries'
import * as prov from './provisioning'
import { buildInitialRoster, type InitialRoster } from './roster'

export interface ActionResult {
  ok?: boolean
  error?: string
  message?: string
}

/** Preview the initial roster (Owner/Admin) before any account is created. */
export async function previewRosterAction(): Promise<InitialRoster> {
  await requireCapability('manage_players')
  return buildInitialRoster()
}

/** Bulk-generate unclaimed accounts for the given profiles. Returns created codes ONCE. */
export async function generateAccountsAction(playerIds: string[]): Promise<prov.GenerateResult & { error?: string }> {
  const actor = await requireCapability('manage_players')
  if (!playerIds.length) return { created: [], skipped: [], error: 'Select at least one player.' }
  const res = await prov.generateAccounts(actor, playerIds)
  revalidatePath('/staff/accounts')
  return res
}

export async function regenerateClaimCodeAction(userId: number): Promise<ActionResult & { code?: string; loginId?: string; expiresAt?: string }> {
  const actor = await requireCapability('manage_players')
  const r = await prov.regenerateClaimCode(actor, userId)
  if (!r.ok) return { error: r.error }
  revalidatePath('/staff/accounts')
  return { ok: true, code: r.code, expiresAt: r.expiresAt }
}

export async function setAccountDisabledAction(userId: number, disabled: boolean): Promise<ActionResult> {
  const actor = await requireCapability('manage_players')
  const r = await prov.setAccountDisabled(actor, userId, disabled)
  if (!r.ok) return { error: r.error }
  revalidatePath('/staff/accounts')
  return { ok: true, message: disabled ? 'Account disabled.' : 'Account restored.' }
}

/** Enroll Player profiles into the active tournament (Tournament 2). Duplicates are skipped. */
export async function enrollSeason2Action(playerIds: string[]): Promise<ActionResult & { enrolled?: number; already?: number }> {
  const actor = await requireCapability('manage_competitions')
  const tournament = await getActiveSeason()
  if (!tournament) return { error: 'There is no active tournament.' }
  let enrolled = 0
  let already = 0
  for (const playerId of [...new Set(playerIds)]) {
    const r = await addEntrantByProfile(actor, tournament.id, playerId)
    if (r.ok && r.already) already++
    else if (r.ok) enrolled++
  }
  revalidatePath('/groups')
  revalidatePath('/')
  revalidatePath('/staff/accounts')
  revalidatePath('/staff/registrations')
  return { ok: true, enrolled, already, message: `Enrolled ${enrolled}; ${already} already entered.` }
}
