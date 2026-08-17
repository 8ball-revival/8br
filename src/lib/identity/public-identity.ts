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

export function slugifyIdentity(preferredName: string, cueverseId?: string | null): string {
  const base = (cueverseId || preferredName || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return base || 'player'
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
