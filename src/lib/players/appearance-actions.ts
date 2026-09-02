'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/account/auth'
import { resolveStaffAccess } from '@/lib/competition/staff-auth'
import { decideEditRights } from './edit-rights'
import { DEFAULT_THEME, THEME_KEYS, validateTheme, type ProfileTheme, type ThemeKey } from './theme'
import { MediaError } from '@/lib/media/validate'
import { MAX_ZOOM, MIN_ZOOM } from './avatar-fit'
import { asAvatarShape, type AvatarShape } from './avatar-shape'

/**
 * Changing how a profile looks: its colours, and its avatar.
 *
 * ── One authorisation rule, reused ──────────────────────────────────────────────────────────────
 * Both actions go through `decideEditRights`, the same rule that already governs the display name.
 * A profile may be changed by the account VERIFIED as owning it, or by staff holding
 * `manage_players`, and by nobody else — including the signed-in member on the next profile along.
 * The rule is re-established from the session inside every action, so a direct POST is refused the
 * same way a hidden button would have been.
 *
 * ── Nothing here trusts the client ──────────────────────────────────────────────────────────────
 * Colours are parsed as strict hex and contrast-checked before they are stored; an avatar's format
 * is decided from its leading bytes, never from its filename or its declared type.
 */

async function rights(playerId: string) {
  const user = await getCurrentUser()
  const player = await prisma.player.findUnique({
    where: { id: playerId },
    select: { linkedUserId: true, linkStatus: true },
  })
  const access = user ? await resolveStaffAccess() : null
  const staff = access?.status === 'ok' && access.actor.can('manage_players')
  const verdict = decideEditRights({
    viewerUserId: user ? String(user.id) : null,
    player: player ? { linkedUserId: player.linkedUserId, linkStatus: player.linkStatus } : null,
    staff: Boolean(staff),
  })
  return { verdict, userId: user ? Number(user.id) : null }
}

/** Everything a profile page needs to re-render after its appearance changed. */
async function revalidateProfile(playerId: string) {
  const p = await prisma.player.findUnique({ where: { id: playerId }, select: { cueverseId: true } })
  if (p?.cueverseId) revalidatePath(`/players/${encodeURIComponent(p.cueverseId)}`)
  revalidatePath(`/players/${encodeURIComponent(playerId)}`)
}

export interface ThemeSaveResult {
  ok?: boolean
  error?: string
  /** Per-field messages, so the editor can mark the offending swatch. */
  fieldErrors?: Partial<Record<ThemeKey, string>>
  theme?: ProfileTheme
}

/** Store a player's chosen colours, after checking they are colours and that they can be read. */
export async function saveProfileThemeAction(
  playerId: string,
  input: Partial<Record<ThemeKey, string>>,
): Promise<ThemeSaveResult> {
  const { verdict } = await rights(playerId)
  if (!verdict.ok) return { error: verdict.error }

  const checked = validateTheme(input)
  if (!checked.ok || !checked.theme) {
    return {
      error: 'Some of those colours could not be used.',
      fieldErrors: checked.errors,
    }
  }

  const theme = checked.theme
  await prisma.playerProfileTheme.upsert({
    where: { playerId },
    create: { playerId, ...theme },
    update: theme,
  })
  await revalidateProfile(playerId)
  return { ok: true, theme }
}

/**
 * Reset to default.
 *
 * The row is deleted rather than overwritten with the default values, so "no theme" and "the theme
 * that happens to match the default" stay distinguishable — and so a future change to the default
 * reaches every profile that never chose one.
 */
export async function resetProfileThemeAction(playerId: string): Promise<ThemeSaveResult> {
  const { verdict } = await rights(playerId)
  if (!verdict.ok) return { error: verdict.error }
  await prisma.playerProfileTheme.deleteMany({ where: { playerId } })
  await revalidateProfile(playerId)
  return { ok: true, theme: DEFAULT_THEME }
}

export interface AvatarResult {
  ok?: boolean
  error?: string
  filename?: string | null
  url?: string | null
  /** The stored picture's own dimensions, so the editor knows how far it can be zoomed back out. */
  width?: number | null
  height?: number | null
}

/**
 * Store an uploaded avatar.
 *
 * The bytes arrive as FormData because that is what a file input produces; everything after that is
 * the project's existing media path — signature sniffing, size ceilings, EXIF-stripping re-encode
 * for stills, and pass-through for anything animated so a GIF or animated WebP stays animated.
 *
 * The file is NOT cropped here. The crop is `object-fit`/`object-position` at display time, which is
 * what lets an animated avatar be framed without being flattened into a single frame first.
 */
export async function uploadAvatarAction(playerId: string, form: FormData): Promise<AvatarResult> {
  const { verdict } = await rights(playerId)
  if (!verdict.ok) return { error: verdict.error }

  const file = form.get('file')
  if (!(file instanceof File) || file.size === 0) return { error: 'Choose an image to upload.' }

  const bytes = Buffer.from(await file.arrayBuffer())

  try {
    const { storePastedMedia } = await import('@/lib/media/service')
    const stored = await storePastedMedia({
      bytes,
      filename: file.name,
      alt: 'Player profile avatar',
      uploaderPlayerId: playerId,
    })

    const previous = await prisma.player.findUnique({
      where: { id: playerId },
      select: { avatarFilename: true },
    })

    await prisma.player.update({
      where: { id: playerId },
      data: {
        avatarFilename: stored.filename,
        avatarUpdatedAt: new Date(),
        // Recorded now, while they are known: the frame cannot offer "show all of it" without them.
        avatarWidth: stored.width ?? null,
        avatarHeight: stored.height ?? null,
        // A new picture starts centred and unzoomed; the previous framing described a different image.
        // The crop starts again for a new picture; `avatarShape` is deliberately untouched, being a
      // preference about the frame rather than anything about the file inside it.
      avatarFocalX: 50, avatarFocalY: 50, avatarZoom: 100,
      },
    })

    /*
      The replaced file is left in storage rather than deleted here.

      Deletion is the project's orphan sweep's job — it already knows how to ask whether a file is
      still referenced anywhere before removing it, and racing that from an upload action is how a
      file still shown on a cached page gets pulled out from under it.
    */
    void previous

    await revalidateProfile(playerId)
    return {
      ok: true, filename: stored.filename, url: stored.url,
      width: stored.width ?? null, height: stored.height ?? null,
    }
  } catch (e) {
    if (e instanceof MediaError) return { error: e.message }
    console.error('[avatar] upload failed', e)
    return { error: 'That image could not be stored. Try again.' }
  }
}

/** Where the crop sits, and how far in. Presentation only — the stored file is untouched. */
export async function setAvatarFramingAction(
  playerId: string,
  framing: { focalX: number; focalY: number; zoom: number; shape: AvatarShape },
): Promise<AvatarResult> {
  const { verdict } = await rights(playerId)
  if (!verdict.ok) return { error: verdict.error }

  // Clamped rather than rejected: these come from sliders, and a value outside the range is a bug
  // in the client, not something to make somebody re-do.
  const clamp = (n: number, lo: number, hi: number) =>
    Math.min(hi, Math.max(lo, Number.isFinite(n) ? Math.round(n) : lo))

  await prisma.player.update({
    where: { id: playerId },
    data: {
      avatarFocalX: clamp(framing.focalX, 0, 100),
      avatarFocalY: clamp(framing.focalY, 0, 100),
      // The floor is the shape of the picture, not a constant: a tall one can come back further
      // than a square one before it has shown all of itself. MIN_ZOOM is only the backstop.
      avatarZoom: clamp(framing.zoom, MIN_ZOOM, MAX_ZOOM),
      // Narrowed rather than trusted: this arrives from a client and ends up in a style.
      avatarShape: asAvatarShape(framing.shape),
    },
  })
  await revalidateProfile(playerId)
  return { ok: true }
}

/** Remove the avatar, returning the profile to its generated monogram. */
export async function removeAvatarAction(playerId: string): Promise<AvatarResult> {
  const { verdict } = await rights(playerId)
  if (!verdict.ok) return { error: verdict.error }

  await prisma.player.update({
    where: { id: playerId },
    data: {
      avatarFilename: null, avatarUpdatedAt: new Date(), avatarFocalX: 50, avatarFocalY: 50, avatarZoom: 100,
      // Cleared with the picture they described. The frame shape is a preference and stays.
      avatarWidth: null, avatarHeight: null,
    },
  })
  await revalidateProfile(playerId)
  return { ok: true, filename: null, url: null }
}

/** The current appearance, for the editor to open with. */
export async function getProfileAppearanceAction(playerId: string): Promise<{
  theme: ProfileTheme
  usingDefault: boolean
  avatarUrl: string | null
  shape: AvatarShape
  width: number | null
  height: number | null
  focalX: number
  focalY: number
  zoom: number
} | null> {
  const { verdict } = await rights(playerId)
  if (!verdict.ok) return null

  const [player, theme] = await Promise.all([
    prisma.player.findUnique({
      where: { id: playerId },
      select: {
        avatarFilename: true, avatarFocalX: true, avatarFocalY: true, avatarZoom: true,
        avatarUpdatedAt: true, avatarShape: true, avatarWidth: true, avatarHeight: true,
      },
    }),
    prisma.playerProfileTheme.findUnique({ where: { playerId } }),
  ])
  if (!player) return null

  const resolved = { ...DEFAULT_THEME }
  if (theme) for (const key of THEME_KEYS) resolved[key] = theme[key]

  return {
    theme: resolved,
    usingDefault: !theme,
    avatarUrl: player.avatarFilename ? `/api/media/file/${player.avatarFilename}` : null,
    focalX: player.avatarFocalX,
    focalY: player.avatarFocalY,
    zoom: player.avatarZoom,
    shape: asAvatarShape(player.avatarShape),
    width: player.avatarWidth,
    height: player.avatarHeight,
  }
}
