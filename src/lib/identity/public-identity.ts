/**
 * SHARED public-identity helper — the single formatter for how a player appears on every
 * LIVE/current public surface: `Preferred Name (CueVerse ID)`.
 *
 * Rules:
 *  - With a linked profile → `Preferred Name (CueVerse ID)`; the whole label links to the
 *    public profile (when a slug is available).
 *  - CueVerse ID missing → just the Preferred Name.
 *  - Manual/account-less entrant (no profile) → the submitted competition identity, as-is.
 * Email is NEVER part of a public identity. Historical/frozen records are formatted from
 * their as-played values by their own renderers — this helper is for current identity.
 */

export interface PublicIdentity {
  preferredName: string
  cueverseId: string | null
  /** Rendered label: "Preferred Name (CueVerse ID)" or just the name. */
  label: string
  /** Profile slug for /players/<slug>, when the identity resolves to a canonical profile. */
  slug: string | null
}

export function slugifyIdentity(preferredName: string, cueverseId?: string | null): string {
  const base = (cueverseId || preferredName || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return base || 'player'
}

export function formatIdentityLabel(preferredName: string, cueverseId?: string | null): string {
  const name = (preferredName || '').trim()
  const id = (cueverseId || '').trim()
  // Show "Preferred Name (CueVerse ID)" only when the Preferred Name is DISTINCT from the ID.
  // With no (or a duplicate) Preferred Name, fall back to just the CueVerse ID.
  if (name && id && name.toLowerCase() !== id.toLowerCase()) return `${name} (${id})`
  return id || name || 'Unknown'
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
