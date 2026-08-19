'use server'

import { revalidatePath } from 'next/cache'

import { requireCapability } from '@/lib/competition/staff-auth'
import { addAlias, removeAlias, listAliases } from './aliases'

/**
 * Alias management, as server actions.
 *
 * The work lives in `aliases.ts`, which takes an explicit actor and can therefore also be called
 * from a script. These wrappers add only what needs a request: the capability gate and the cache
 * revalidation.
 *
 * A 'use server' module may only export async functions, so the row type is imported from
 * `aliases.ts` at the call site rather than re-exported here — a `export type` line becomes a
 * runtime binding to something that does not exist and the whole action module fails to evaluate.
 */

export interface AliasActionResult {
  ok: boolean
  error?: string
  aliases?: { id: string; alias: string }[]
}

/** Record another handle for a player, and return the resulting list. */
export async function addAliasAction(playerId: string, raw: string): Promise<AliasActionResult> {
  const actor = await requireCapability('manage_players')
  const res = await addAlias(actor, String(playerId ?? ''), String(raw ?? ''))
  if (!res.ok) return { ok: false, error: res.error }
  revalidatePath('/staff/members')
  return { ok: true, aliases: await listAliases(playerId) }
}

export async function removeAliasAction(playerId: string, aliasId: string): Promise<AliasActionResult> {
  const actor = await requireCapability('manage_players')
  const res = await removeAlias(actor, String(playerId ?? ''), String(aliasId ?? ''))
  if (!res.ok) return { ok: false, error: res.error }
  revalidatePath('/staff/members')
  return { ok: true, aliases: await listAliases(playerId) }
}

/** The current aliases, for a panel that loads them on demand. */
export async function listAliasesAction(playerId: string): Promise<AliasActionResult> {
  await requireCapability('manage_players')
  return { ok: true, aliases: await listAliases(String(playerId ?? '')) }
}
