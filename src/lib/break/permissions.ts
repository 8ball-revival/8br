import 'server-only'
import { cache } from 'react'

import { currentEditorialActor, type EditorialActor } from '@/lib/editorial/permissions'
import type { BreakActorShape } from './permission-rules'

/**
 * Who is asking.
 *
 * ── Built on the existing resolver, not beside it ────────────────────────────────────────────────
 * `currentEditorialActor` already does the hard parts and does them once: it resolves the canonical
 * Player through the merge service, rejects banned, timed-out, soft-deleted, inactive and
 * management-only accounts, and reads staff roles from the site's own role system. Duplicating that
 * here would mean two places to be wrong about who is suspended, and they would drift.
 *
 * So The Break's actor IS that actor, with one difference in what it means.
 *
 * ── The one difference ───────────────────────────────────────────────────────────────────────────
 * Trusted Author no longer decides whether somebody may post. Under the editorial system it gated
 * publishing, because articles were a small number of long pieces. The Break is a community feed:
 * any signed-in member in good standing posts, and the flag survives only as a label for official
 * contributors and for the migration. It is carried through and never consulted for permission.
 *
 * ── The rules live next door ─────────────────────────────────────────────────────────────────────
 * What an actor MAY DO is in `permission-rules.ts`, which imports nothing and is tested directly.
 * This file only answers who they are.
 */
export type BreakActor = BreakActorShape

export const currentBreakActor = cache(async function currentBreakActor(): Promise<BreakActor | null> {
  const actor: EditorialActor | null = await currentEditorialActor()
  if (!actor) return null
  return {
    playerId: actor.playerId,
    name: actor.name,
    handle: actor.handle,
    isAdmin: actor.isAdmin,
    isOwner: actor.isOwner,
    isTrustedAuthor: actor.isTrustedAuthor,
  }
})

export async function requireBreakActor(): Promise<BreakActor> {
  const a = await currentBreakActor()
  if (!a) throw new Error('You need to be signed in to do that.')
  return a
}

export async function requireBreakModerator(): Promise<BreakActor> {
  const a = await currentBreakActor()
  if (!a?.isAdmin) throw new Error('That action is for moderators.')
  return a
}

export * from './permission-rules'
