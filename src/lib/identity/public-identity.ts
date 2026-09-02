import { identityText, NO_IDENTITY } from './display'

/**
 * SHARED public-identity helper — the single formatter for how a player appears on every
 * LIVE/current public surface: `CueVerse ID (Preferred Name)`.
 *
 * The ID leads because it is the half that actually identifies someone. Preferred names collide
 * constantly in the archive — two Mikes in one 2005 group, half a dozen Chis across the years —
 * and a name on its own cannot be told apart at a glance.
 *
 * Rules (shared with `./display`, which this delegates to):
 *  - With a CueVerse ID → `CueVerse ID (Preferred Name)`, the name dropped when it merely
 *    repeats the ID; the whole label links to the public profile when a slug is available.
 *  - CueVerse ID missing → just the Preferred Name.
 *  - Manual/account-less entrant (no profile) → the submitted competition identity, as-is.
 * Email is NEVER part of a public identity. Historical/frozen records are formatted from
 * their as-played values by their own renderers — this helper is for current identity.
 */

export interface PublicIdentity {
  preferredName: string
  cueverseId: string | null
  /** Rendered label: "CueVerse ID (Preferred Name)", or just the ID when the name adds nothing. */
  label: string
  /** Profile slug for /players/<slug>, when the identity resolves to a canonical profile. */
  slug: string | null
}

/**
 * The route parameter for a player's public profile, or null when there is nothing to link to.
 *
 * ── Why this cannot prettify anything ───────────────────────────────────────────────────────────
 * `/players/[cueverse]` resolves its parameter by looking for a player whose `id` matches it, or
 * whose `cueverseId` matches it case-insensitively. It does not un-slugify, and there is nothing it
 * could un-slugify to: a lossy transformation has no inverse.
 *
 * So a slug must be a value the lookup will actually find. The previous version lowercased and
 * replaced every character outside `[a-z0-9]` with a hyphen, which round-trips only for handles
 * that are pure letters and digits. Everything else pointed at a profile that does not exist:
 *
 *     "da_leo"            ->  /players/da-leo          404
 *     "pool.stick"        ->  /players/pool-stick      404
 *     "1_exterminate_1"   ->  /players/1-exterminate-1 404
 *     "🔥 ₲ØĐⱠł₭Ɇ₊⊹"       ->  /players/player          404  (everything stripped, then a fallback)
 *
 * On this database that was 388 of 521 players — underscores and full stops are ordinary in a
 * handle, so the common case was broken and the all-symbol name was only its loudest form. The
 * `'player'` fallback was the worst part: it invented a destination rather than admitting there
 * was none.
 *
 * The handle is returned as it is stored, and the caller encodes it. Where a player has no handle
 * the id is used instead — the route accepts that too, so somebody who never set a CueVerse ID
 * still gets a profile that opens.
 */
export function profileSlug(cueverseId?: string | null, playerId?: string | null): string | null {
  return (cueverseId ?? '').trim() || (playerId ?? '').trim() || null
}

export function formatIdentityLabel(preferredName: string, cueverseId?: string | null): string {
  const label = identityText({ cueverseId, preferredName })
  return label === NO_IDENTITY ? 'Unknown' : label
}

/** Build a PublicIdentity from resolved profile/registration parts. */
export function resolvePublicIdentity(input: {
  preferredName?: string | null
  cueverseId?: string | null
  slug?: string | null
}): PublicIdentity {
  const preferredName = (input.preferredName || '').trim() || (input.cueverseId || '').trim()
  const cueverseId = input.cueverseId?.trim() || null
  return {
    preferredName,
    cueverseId,
    label: formatIdentityLabel(preferredName, cueverseId),
    slug: input.slug ?? null,
  }
}
