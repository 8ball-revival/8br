import 'server-only'
import { prisma } from '@/lib/prisma'
import { formatIdentityLabel, slugifyIdentity } from '@/lib/identity/public-identity'

/**
 * BRIDGE — historical canonical identity → permanent player account.
 *
 * A migrated/linked account "owns" a historical ranking identity through `Player.legacyPlayerId`
 * (which equals the resolveIdentity() canonical id). This does NOT change any statistic: the ranking
 * engine still keys on the canonical id; we only look up the permanent account to render its CURRENT
 * display identity ("Preferred Name (CueVerse ID)") and link to its profile. Additive + read-only.
 */
export interface LinkedDisplay { label: string; slug: string; cueverseId: string | null }

export async function linkedIdentitiesFor(canonicalIds: string[]): Promise<Map<string, LinkedDisplay>> {
  const ids = [...new Set(canonicalIds)].filter(Boolean)
  if (!ids.length) return new Map()
  const players = await prisma.player.findMany({
    where: { legacyPlayerId: { in: ids }, linkedUserId: { not: null } },
    select: { legacyPlayerId: true, primaryName: true, cueverseId: true },
  })
  const m = new Map<string, LinkedDisplay>()
  for (const p of players) {
    if (!p.legacyPlayerId) continue
    m.set(p.legacyPlayerId, {
      label: formatIdentityLabel(p.primaryName, p.cueverseId),
      slug: slugifyIdentity(p.primaryName, p.cueverseId),
      cueverseId: p.cueverseId,
    })
  }
  return m
}

/** Override ranking rows' display name (and mark them resolved) from the linked permanent account. */
export async function applyLinkedIdentities<T extends { id: string; name: string; resolved: boolean }>(rows: T[]): Promise<T[]> {
  const map = await linkedIdentitiesFor(rows.map((r) => r.id))
  if (!map.size) return rows
  return rows.map((r) => {
    const l = map.get(r.id)
    return l ? { ...r, name: l.label, resolved: true } : r
  })
}
