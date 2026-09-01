'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/account/auth'
import { resolveStaffAccess } from '@/lib/competition/staff-auth'
import { searchPlayers, type PlayerOption } from '@/lib/players/picker-search'
import { invalidateRankings } from '@/lib/stats/invalidate-rankings'
import { decideEditRights } from './edit-rights'

/**
 * The two things a profile page asks the server for: who may edit it, and who a search term means.
 *
 * ── Authorisation is decided here, never by the button ──────────────────────────────────────────
 * The profile renders an Edit control only for the owner and for staff who hold `manage_players`,
 * and that visibility is worth nothing on its own — a hidden button is a hidden button, not a
 * permission. Every mutation below re-establishes the same right from the session, so calling this
 * action directly, from a console or a script, against a profile that is not yours, fails.
 *
 * `canEditProfileAction` exists so the page can decide what to draw. `updateProfileNameAction` does
 * not trust its answer and works it out again.
 */

/** Everything that grants an edit, worked out from the session and the profile itself. */
async function editRights(playerId: string): Promise<
  { ok: true; actor: { userId: number; username: string }; via: 'owner' | 'staff' }
  | { ok: false; error: string }
> {
  const user = await getCurrentUser()
  const player = await prisma.player.findUnique({
    where: { id: playerId },
    select: { id: true, linkedUserId: true, linkStatus: true },
  })

  // Staff rights are resolved only when they might matter — a signed-out visitor needs no lookup.
  const access = user ? await resolveStaffAccess() : null
  const staff = access?.status === 'ok' && access.actor.can('manage_players')
    ? { userId: access.actor.userId, username: access.actor.username }
    : null

  const verdict = decideEditRights({
    viewerUserId: user ? String(user.id) : null,
    player: player ? { linkedUserId: player.linkedUserId, linkStatus: player.linkStatus } : null,
    staff: Boolean(staff),
  })
  if (!verdict.ok) return verdict
  return verdict.via === 'owner'
    ? { ok: true, via: 'owner', actor: { userId: Number(user!.id), username: user!.username } }
    : { ok: true, via: 'staff', actor: staff! }
}

/** Whether to draw the Edit control. Presentation only — the mutation checks again. */
export async function canEditProfileAction(playerId: string): Promise<boolean> {
  const r = await editRights(playerId)
  return r.ok
}

export interface ProfileEditResult { ok?: boolean; error?: string; name?: string }

/**
 * Change the public name on a profile.
 *
 * The same field `/account` has always edited, reached from the profile instead of from a settings
 * page. It goes through `updateProfile`, so the audit trail, the alias bookkeeping and the identity
 * propagation are the existing ones — this adds a caller, not a second way to rename somebody.
 */
export async function updateProfileNameAction(
  playerId: string,
  preferredName: string,
): Promise<ProfileEditResult> {
  const rights = await editRights(playerId)
  if (!rights.ok) return { error: rights.error }

  const name = preferredName.trim()
  const { validatePreferredName } = await import('@/lib/account/validation')
  const invalid = name ? validatePreferredName(name) : null
  if (invalid) return { error: invalid }

  const player = await prisma.player.findUnique({
    where: { id: playerId },
    select: { cueverseId: true, primaryName: true },
  })
  if (!player) return { error: 'That profile no longer exists.' }

  // A cleared name falls back to the handle, so no public surface is ever left without one.
  const next = name || player.cueverseId || player.primaryName

  const { updateProfile } = await import('@/lib/players/service')
  await updateProfile(rights.actor, playerId, { primaryName: next })

  // Public identity appears in more places than this page.
  for (const p of ['/players', '/rankings', '/seasons', '/tournaments', '/account']) revalidatePath(p)
  if (player.cueverseId) revalidatePath(`/players/${encodeURIComponent(player.cueverseId)}`)
  invalidateRankings()
  return { ok: true, name: next }
}

/**
 * The site-wide player search, for the field in the navigation.
 *
 * A thin pass to `searchPlayers` on purpose. That function already answers by CueVerse ID, name,
 * alias and merged-away identity, case-insensitively and on partial text, and already resolves an
 * old identity to the account that absorbed it. A second implementation here would be a second set
 * of rules about who a name means, and the two would disagree about somebody eventually.
 */
export async function searchPlayersAction(query: string): Promise<PlayerOption[]> {
  return searchPlayers(query, 8)
}
