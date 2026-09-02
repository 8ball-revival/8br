import 'server-only'

import { prisma } from '@/lib/prisma'
import { profileSlug } from '@/lib/identity/public-identity'

/**
 * Who holds the record, resolved from the canonical player where one is named.
 *
 * ── Why a player REFERENCE and not two text fields ──────────────────────────────────────────────
 * A CueVerse ID typed into a settings panel is a copy of somebody's identity, and copies go stale:
 * the site already lets a player change their CueVerse ID, and every Season, Tournament and match
 * they appear in follows that change. A record panel with the old handle typed into it would be the
 * one place on the site still calling them by a name they had stopped using.
 *
 * So the panel stores a player id and reads the identity from the Player row, exactly as the rest of
 * the site does — and builds the profile link with the same `profileSlug` every other link uses,
 * rather than inventing a second URL shape.
 *
 * ── Why the text fields still exist ─────────────────────────────────────────────────────────────
 * As a FALLBACK, not as the source. The record may be held by somebody with no account — an archive
 * figure, a guest, a name from a video — and the panel has to be able to say so. It is also what
 * renders if the referenced player is ever removed, so the homepage degrades to the last known name
 * rather than to an empty space.
 */
export interface RecordHolder {
  /** The primary line: a CueVerse ID where there is one. */
  primary: string
  /** The secondary line: a display name, when it says something the primary does not. */
  secondary: string | null
  /** Their profile, when the holder is a real player. */
  href: string | null
  /** True when this came from the Player row rather than from the fallback text. */
  canonical: boolean
}

/** A profile link, or none at all — never a link to a profile that does not exist. */
function linkFor(slug: string | null): string | null {
  return slug === null ? null : `/players/${encodeURIComponent(slug)}`
}

export async function resolveRecordHolder(input: {
  playerId?: string | null
  fallbackCueverseId?: string
  fallbackDisplayName?: string
}): Promise<RecordHolder | null> {
  const fallback = buildFallback(input)
  const id = (input.playerId ?? '').trim()
  if (!id) return fallback

  try {
    const player = await prisma.player.findUnique({
      where: { id },
      select: { id: true, cueverseId: true, primaryName: true },
    })
    if (!player) return fallback

    const primary = player.cueverseId?.trim() || player.primaryName?.trim() || ''
    if (!primary) return fallback

    const name = player.primaryName?.trim() ?? ''
    return {
      primary,
      // Only when it adds something. "sixohtwo" over "sixohtwo" is noise.
      secondary: name && name.toLowerCase() !== primary.toLowerCase() ? name : null,
      href: linkFor(profileSlug(player.cueverseId, player.id)),
      canonical: true,
    }
  } catch (err) {
    /*
      A database fault must not take the homepage down.

      This panel is one row of a page whose other rows are fine, and the fallback text is exactly the
      value somebody typed for this eventuality. Falling back is the whole reason it exists.
    */
    console.error('[home] could not resolve the record holder', err)
    return fallback
  }
}

function buildFallback(input: { fallbackCueverseId?: string; fallbackDisplayName?: string }): RecordHolder | null {
  const primary = (input.fallbackCueverseId ?? '').trim()
  const secondary = (input.fallbackDisplayName ?? '').trim()
  if (!primary && !secondary) return null
  return {
    primary: primary || secondary,
    secondary: primary && secondary && secondary.toLowerCase() !== primary.toLowerCase() ? secondary : null,
    // No link. A name that is not a player has nowhere to go, and a link to a profile that does not
    // exist is worse than no link at all.
    href: null,
    canonical: false,
  }
}

/**
 * Find a player by CueVerse ID, for the bootstrap that seeds the record panel.
 *
 * Used when the homepage layout is created, to turn a configured handle into the reference the panel
 * actually stores. Returns null rather than throwing: a site whose seed data names somebody who has
 * not been imported yet must still bootstrap, and the panel then renders the fallback text.
 */
export async function findPlayerIdByCueverseId(cueverseId: string): Promise<string | null> {
  const handle = cueverseId.trim()
  if (!handle) return null
  try {
    const player = await prisma.player.findFirst({
      where: { cueverseIdNormalized: handle.toLowerCase() },
      select: { id: true },
    })
    return player?.id ?? null
  } catch {
    return null
  }
}
