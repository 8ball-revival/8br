import 'server-only'
import { prisma } from '@/lib/prisma'
import { recordAudit, type Actor } from '@/lib/competition/audit'

/**
 * Historical handles a player has also been known by.
 *
 * Aliases exist so that search, entrant matching and archive reconciliation still find somebody
 * under a name they used years ago. They are recorded automatically on a rename; this is the manual
 * path, for the far more common case where an old handle was never captured because the rename
 * happened before the site did.
 *
 * ── A key and a spelling, not one doing both ─────────────────────────────────────────────────────
 * `alias` is the MATCH key: lower-cased, punctuation removed, the form every lookup compares. That
 * normalisation is the point — `Big_Nav` and `bignav` have to be one alias, not two that each match
 * half the time.
 *
 * It was also the label, and that was the bug. Recording `fsm_brian` stored `fsmbrian` and the
 * spelling was gone for good, so "Previously known as" listed match keys instead of handles.
 * `aliasDisplay` now carries what the person actually typed, and nothing ever matches on it.
 *
 * Rows written before that column existed have no spelling to recover, so they fall back to the key
 * — which is what they already displayed. Correcting one is a manual edit, not a migration.
 */

/** The stored form of an alias: lowercase, letters and digits only. */
export function aliasKey(raw: string): string {
  return raw.trim().toLowerCase().replace(/[^a-z0-9]/g, '')
}

export interface AliasRow {
  id: string
  /** The match key: lower-cased, letters and digits only. */
  alias: string
  /** What to show a reader: the spelling as recorded, or the key when there is no spelling. */
  display: string
}

/** The spelling to show for an alias row, falling back to the key for rows written before it. */
export function aliasDisplayOf(row: { alias: string; aliasDisplay?: string | null }): string {
  return row.aliasDisplay?.trim() || row.alias
}

export async function listAliases(playerId: string): Promise<AliasRow[]> {
  const rows = await prisma.playerAlias.findMany({
    where: { playerId },
    select: { id: true, alias: true, aliasDisplay: true },
    orderBy: { alias: 'asc' },
  })
  return rows.map((r) => ({ id: r.id, alias: r.alias, display: aliasDisplayOf(r) }))
}

/**
 * Record another handle for this player.
 *
 * Refuses an alias already claimed by somebody ELSE rather than silently moving it: two players
 * answering to one handle makes every lookup that uses it ambiguous, and the resulting mis-matched
 * result is far harder to find than an error message here.
 *
 * Re-adding an alias the player already has succeeds quietly — it is already true.
 */
export async function addAlias(
  actor: Actor,
  playerId: string,
  raw: string,
): Promise<{ ok: boolean; error?: string; alias?: string }> {
  const alias = aliasKey(raw)
  // Kept exactly as typed apart from surrounding space, and never used to match anything.
  const aliasDisplay = raw.trim()
  if (!alias) return { ok: false, error: 'Enter a handle to record as an alias.' }
  if (alias.length > 64) return { ok: false, error: 'That handle is too long to record.' }

  const player = await prisma.player.findUnique({
    where: { id: playerId },
    select: { id: true, cueverseId: true, primaryName: true },
  })
  if (!player) return { ok: false, error: 'That player no longer exists.' }

  // An alias identical to the player's current handle records nothing anyone can use.
  if (aliasKey(player.cueverseId ?? '') === alias) {
    return { ok: false, error: 'That is already their CueVerse ID.' }
  }

  const claimed = await prisma.playerAlias.findFirst({
    where: { alias },
    select: { playerId: true, player: { select: { cueverseId: true, primaryName: true } } },
  })
  if (claimed && claimed.playerId !== playerId) {
    const who = claimed.player.cueverseId || claimed.player.primaryName || 'another player'
    return { ok: false, error: `That handle is already recorded for ${who}.` }
  }
  if (claimed) return { ok: true, alias }

  await prisma.playerAlias.create({ data: { playerId, alias, aliasDisplay } })
  await recordAudit(actor, {
    action: 'player.alias.add',
    entity: 'Player',
    entityId: playerId,
    newValue: { alias, aliasDisplay },
  }).catch(() => {})

  return { ok: true, alias }
}

/** Remove an alias. Scoped to the player it belongs to, so an id from a stale page cannot reach another. */
export async function removeAlias(
  actor: Actor,
  playerId: string,
  aliasId: string,
): Promise<{ ok: boolean; error?: string }> {
  const row = await prisma.playerAlias.findUnique({
    where: { id: aliasId },
    select: { id: true, alias: true, playerId: true },
  })
  if (!row || row.playerId !== playerId) return { ok: false, error: 'That alias no longer exists.' }

  await prisma.playerAlias.delete({ where: { id: aliasId } })
  await recordAudit(actor, {
    action: 'player.alias.remove',
    entity: 'Player',
    entityId: playerId,
    oldValue: { alias: row.alias },
  }).catch(() => {})

  return { ok: true }
}
