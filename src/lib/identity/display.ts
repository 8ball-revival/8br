/**
 * How a competitor is named on screen, everywhere on the site.
 *
 * The CueVerse ID is the identity that actually distinguishes people: the archive has two Mikes in
 * one 2005 group and six or seven different Chis across the years, and a preferred name alone
 * cannot tell them apart. So the ID leads and the preferred name follows it as context.
 *
 * The rules, in one place:
 *   - the CueVerse ID is the primary name whenever there is one;
 *   - the preferred name comes second, and only when it adds something — a name equal to the ID
 *     (ignoring case and surrounding space) is noise, not context;
 *   - with no CueVerse ID, the preferred name is promoted to primary and nothing trails it;
 *   - with neither, callers get an em dash rather than an empty gap.
 *
 * Deliberately dependency-free (no `server-only`) so server components, client components and the
 * verify suites all share exactly one implementation of these rules.
 */

/** An identity as stored anywhere in the app, under any of the field names in use. */
export interface IdentityInput {
  /** The competitive handle — `Player.cueverseId`, or `handle` on the denormalised views. */
  cueverseId?: string | null
  /** The preferred/community name — `Player.primaryName`, or `name`/`displayName` on views. */
  preferredName?: string | null
}

export interface IdentityLines {
  /** What to render large: the CueVerse ID, or the preferred name when there is no ID. */
  primary: string
  /** What to render small beneath it, or null when it would merely repeat the primary. */
  secondary: string | null
}

/** Placeholder for a slot with no identity at all (an unfilled bracket seat, a deleted profile). */
export const NO_IDENTITY = '—'

const clean = (v: string | null | undefined): string => (v ?? '').trim()

/** True when two identity strings name the same thing for display purposes. */
function sameText(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase()
}

/**
 * Split an identity into the two lines every player-facing surface renders.
 *
 * Accepts the field names actually used across the codebase, so callers can pass a bracket slot
 * (`{ name, handle }`), an entrant view (`{ displayName, cueverseId }`) or a profile
 * (`{ primaryName, cueverseId }`) without reshaping it first.
 */
export function identityLines(input: IdentityInput | null | undefined): IdentityLines {
  const id = clean(input?.cueverseId)
  const name = clean(input?.preferredName)

  if (!id) return { primary: name || NO_IDENTITY, secondary: null }
  return { primary: id, secondary: name && !sameText(name, id) ? name : null }
}

/**
 * The same identity on ONE line, for places with no room for two: dropdown options, confirmation
 * prompts, audit messages, `title` attributes, exported columns.
 *
 * Renders as `CueVerseID (Preferred Name)`, or just the ID when the name adds nothing.
 */
export function identityText(input: IdentityInput | null | undefined): string {
  const { primary, secondary } = identityLines(input)
  return secondary ? `${primary} (${secondary})` : primary
}

/**
 * Adapter for the `{ name, handle }` shape used by bracket slots, team members, Swiss pairings and
 * free agents, where `name` holds the preferred name and `handle` the CueVerse ID.
 */
export function fromNameHandle(v: { name?: string | null; handle?: string | null } | null | undefined): IdentityInput {
  return { cueverseId: v?.handle ?? null, preferredName: v?.name ?? null }
}

/**
 * Adapter for the `{ displayName, cueverseId }` shape returned by the entrant/standings views,
 * where `displayName` is the resolved preferred name.
 */
export function fromDisplayName(v: { displayName?: string | null; cueverseId?: string | null } | null | undefined): IdentityInput {
  return { cueverseId: v?.cueverseId ?? null, preferredName: v?.displayName ?? null }
}

/**
 * Search predicate matching either half of an identity, so typing a preferred name still finds a
 * player whose ID is displayed first (and vice versa).
 */
export function matchesIdentity(input: IdentityInput | null | undefined, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return clean(input?.cueverseId).toLowerCase().includes(q) || clean(input?.preferredName).toLowerCase().includes(q)
}
