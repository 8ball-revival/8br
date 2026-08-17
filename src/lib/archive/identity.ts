/**
 * Turning archive handles into CueVerse IDs.
 *
 * The 8BRCAM archive recorded people by their Yahoo Messenger handle, typed by hand over ten
 * years. Those handles do not all satisfy `validateCueverseId` — some are email addresses, some
 * carry bookkeeping markers the archivists appended, some are blank.
 *
 * The rule followed here is that an archive handle may be RESHAPED but never MERGED. Two archive
 * player ids always produce two different CueVerse IDs, even when their handles clean up to the
 * same string, because collapsing them would silently fuse two people's competition history. Where
 * a genuine duplicate exists it is a decision for a human, made later through the merge tool.
 */

/** Placeholder handles that carry no identity and should be treated as missing. */
const EMPTY_HANDLES = new Set(['', 'n/a', 'na', 'none', 'unknown', '-', '?', 'null'])

/**
 * Names the archivists used for an empty slot rather than a person: "TBD" for a group place nobody
 * filled, "-" for an unknown bracket opponent.
 *
 * Judged on the NAME only. A missing handle is common and means nothing — "disco" played four
 * matches with `n/a` in the handle column and is plainly a real person.
 */
const PLACEHOLDER_NAME = /^\s*(tbd|tba|bye|vacant|empty|open|unknown|n\/?a|none|\?+|-+)\s*$/i

/**
 * True when this archive row is a slot filler, not a competitor.
 *
 * These must not become member accounts: they would appear in the members list, the rankings and
 * the player pages as people who never existed.
 */
export function isPlaceholderArchivePlayer(name: string | null | undefined): boolean {
  return PLACEHOLDER_NAME.test((name ?? '').trim())
}

/** Mirrors CUEVERSE_RE in lib/account/validation — kept in sync deliberately. */
const CUEVERSE_RE = /^[a-z0-9_.\-]{2,40}$/i

export interface ArchivePlayerInput {
  /** Archive player id, e.g. "P0027". Always present and always unique. */
  playerId: string
  /** Raw `primary_ym` handle from players.csv; may be blank or malformed. */
  handle: string | null | undefined
  /** Archive display name, e.g. "luis". */
  name: string | null | undefined
}

export interface ArchiveIdentity {
  playerId: string
  /** The CueVerse ID to create the account under. Always valid, always unique. */
  cueverseId: string
  /** Preferred Name for the profile; null when the archive had no usable name. */
  preferredName: string | null
  /** The untouched archive handle, for reporting. */
  rawHandle: string
  /** How the id was arrived at — drives the import report. */
  origin: 'handle' | 'reshaped' | 'archive-id' | 'disambiguated'
}

/**
 * Reshape a single handle into something `validateCueverseId` accepts.
 *
 * Markers are preserved rather than deleted: `"ii_comp_ii (wc)"` becomes `ii_comp_ii-wc`, not
 * `ii_comp_ii`. Deleting the marker is what fuses two archive people into one id.
 */
export function reshapeHandle(handle: string | null | undefined): string | null {
  let v = (handle ?? '').trim()
  if (EMPTY_HANDLES.has(v.toLowerCase())) return null

  // An email in the handle column means the Yahoo id is the local part.
  if (v.includes('@')) v = v.split('@', 1)[0]

  v = v.replace(/\s*\(([^)]*)\)/g, '-$1') // "(wc)" -> "-wc"
  v = v.replace(/\s*-\s*/g, '-') //          " - x" -> "-x"
  v = v.replace(/\s+/g, '.') //              internal spaces
  v = v.replace(/[^A-Za-z0-9_.\-]/g, '') //  apostrophes and the rest
  v = v.replace(/-{2,}/g, '-').replace(/\.{2,}/g, '.')
  v = v.replace(/^[.\-]+|[.\-]+$/g, '')

  if (v.length < 2) return null
  return v.slice(0, 40)
}

/** True when a string is already a legal CueVerse ID. */
export function isValidCueverseId(v: string): boolean {
  return CUEVERSE_RE.test(v)
}

/**
 * Build the archive-wide identity map.
 *
 * Processed in archive-player-id order so the output is deterministic: re-running the import
 * produces exactly the same CueVerse IDs, which is what makes the import safely repeatable.
 *
 * Deliberately takes NO database input. The map is a pure function of the archive, so importing
 * twice yields the same ids both times. Collisions with accounts that already exist on the site are
 * a separate concern, resolved at creation time — folding them in here would make the ids depend on
 * whatever happened to be in the database when the import ran.
 *
 * @param players every archive participant
 */
export function buildArchiveIdentityMap(players: ArchivePlayerInput[]): Map<string, ArchiveIdentity> {
  const used = new Set<string>()

  const out = new Map<string, ArchiveIdentity>()
  const ordered = [...players].sort((a, b) => a.playerId.localeCompare(b.playerId))

  for (const p of ordered) {
    const raw = (p.handle ?? '').trim()
    const reshaped = reshapeHandle(raw)

    let candidate = reshaped
    let origin: ArchiveIdentity['origin'] =
      reshaped === null ? 'archive-id' : reshaped === raw ? 'handle' : 'reshaped'

    // No usable handle at all: the archive player id is itself a stable, unique identifier.
    if (candidate === null) candidate = p.playerId.toLowerCase()

    // Two archive people whose handles clean up the same way. Keep both, distinguished by the
    // archive id, and flag it so the pair can be reviewed for a real merge later.
    if (used.has(candidate.toLowerCase())) {
      const suffix = `-${p.playerId.toLowerCase()}`
      candidate = candidate.slice(0, 40 - suffix.length) + suffix
      origin = 'disambiguated'
    }

    used.add(candidate.toLowerCase())
    const name = (p.name ?? '').trim()
    out.set(p.playerId, {
      playerId: p.playerId,
      cueverseId: candidate,
      preferredName: name ? name.slice(0, 40) : null,
      rawHandle: raw,
      origin,
    })
  }
  return out
}

/**
 * Archive accounts get a deliberately undeliverable address.
 *
 * `.invalid` is reserved by RFC 2606 and can never resolve, so importing ten years of handles can
 * never send mail to a real person who happens to own the matching address.
 */
export function archiveEmailFor(cueverseId: string): string {
  return `${cueverseId.toLowerCase()}@archive.8br.invalid`
}

/** True for an address minted by {@link archiveEmailFor}. */
export function isArchiveEmail(email: string | null | undefined): boolean {
  return /@archive\.8br\.invalid$/i.test((email ?? '').trim())
}

/**
 * The id to fall back to when an archive id is already held by somebody on the site.
 *
 * Appending the archive player id keeps the two apart without guessing which one is "right"; the
 * pair can be reviewed and merged by hand afterwards.
 */
export function disambiguatedId(cueverseId: string, archivePlayerId: string): string {
  const suffix = `-${archivePlayerId.toLowerCase()}`
  return cueverseId.slice(0, 40 - suffix.length) + suffix
}
