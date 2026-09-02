'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { UPLOAD_MAX_BYTES, UPLOAD_MAX_LABEL, describeBytes } from '@/lib/media/limits'
import {
  AVATAR_SHAPES, AVATAR_SHAPE_LABELS, avatarRadius, type AvatarShape,
} from '@/lib/players/avatar-shape'
import { Trash2, Upload, X } from 'lucide-react'
import {
  DEFAULT_THEME, THEME_FIELDS, THEME_PRESETS, matchPreset, themeVars, validateTheme,
  type ProfileTheme, type ThemeKey,
} from '@/lib/players/theme'
import {
  removeAvatarAction, resetProfileThemeAction,
  saveProfileThemeAction, setAvatarFramingAction, uploadAvatarAction,
} from '@/lib/players/appearance-actions'
import { ProfileAvatar } from './profile-avatar'

/**
 * Edit Profile: a player's own colours and their avatar.
 *
 * ── Only the owner ever sees this ───────────────────────────────────────────────────────────────
 * It is rendered only when the server has already said the viewer may edit, and every action inside
 * it re-establishes that right from the session before writing. The public profile carries no
 * customisation controls at all — this panel is the only place they exist.
 *
 * ── Live preview means the real thing ───────────────────────────────────────────────────────────
 * The preview is not a swatch grid: the editor writes the working theme onto the profile's own root
 * element as it is edited, so what changes is the actual profile behind the panel. Cancel puts the
 * original values back. That is why the same variables drive both — there is no second rendering of
 * the profile to keep in step.
 */
export function AppearanceEditor({
  playerId, playerName, onClose, initialTheme, initialAvatarUrl, initialFraming,
}: {
  playerId: string
  playerName: string
  onClose: () => void
  /*
    The appearance as the server rendered it.

    The panel used to open empty and then ask the server for these over a Server Action, so opening
    it meant waiting for a round trip before a single control was usable — on a cold instance, long
    enough to look broken. Every one of these values is already on the page: the profile behind the
    panel is drawn from them. Passing them in makes the panel open at once, and they cannot be
    staler than the page they came from.
  */
  initialTheme: ProfileTheme
  initialAvatarUrl: string | null
  initialFraming: { focalX: number; focalY: number; zoom: number; shape: AvatarShape }
}) {
  const [theme, setTheme] = useState<ProfileTheme>(initialTheme)
  /** What the profile looked like when the editor opened, for Cancel. */
  const original = useRef<ProfileTheme>(initialTheme)
  const [avatarUrl, setAvatarUrl] = useState<string | null>(initialAvatarUrl)
  const [framing, setFraming] = useState(initialFraming)
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<ThemeKey, string>>>({})
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const [pending, start] = useTransition()
  const fileRef = useRef<HTMLInputElement>(null)

  /*
    Which preset is showing, if any.

    Derived from the working theme rather than remembered separately: adjusting one swatch by hand
    should stop the preset reading as selected, and a stored theme that happens to equal a preset
    should show it as selected even though nobody clicked it this session.
  */
  const activePreset = matchPreset(theme)


  /*
    Paint the working theme onto the live profile.

    `.pf-root` is the profile's own wrapper, so this is the same element the server rendered the
    stored theme onto — the preview IS the profile, not a copy of it.
  */
  useEffect(() => {
    const root = document.querySelector<HTMLElement>('.pf-root')
    if (!root) return
    const vars = themeVars(theme)
    for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v)
  }, [theme])

  /** Restore what was there when the editor opened, then close. */
  const cancel = () => {
    const root = document.querySelector<HTMLElement>('.pf-root')
    if (root) {
      const vars = themeVars(original.current)
      for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v)
    }
    onClose()
  }

  const save = () => {
    // Checked here for an instant message, and again on the server, which is the check that counts.
    const local = validateTheme(theme)
    if (!local.ok) {
      setFieldErrors(local.errors)
      setMessage({ ok: false, text: 'Some colours need adjusting before this can be saved.' })
      return
    }
    start(async () => {
      const r = await saveProfileThemeAction(playerId, theme)
      if (r.error) {
        setFieldErrors(r.fieldErrors ?? {})
        setMessage({ ok: false, text: r.error })
        return
      }
      setFieldErrors({})
      original.current = r.theme ?? theme
      setMessage({ ok: true, text: 'Profile colours saved.' })
    })
  }

  const reset = () => {
    start(async () => {
      const r = await resetProfileThemeAction(playerId)
      if (r.error) { setMessage({ ok: false, text: r.error }); return }
      setTheme(DEFAULT_THEME)
      original.current = DEFAULT_THEME
      setFieldErrors({})
      setMessage({ ok: true, text: 'Reset to the default theme.' })
    })
  }

  const upload = (file: File) => {
    /*
      Weighed here, before it is sent.

      Not politeness: a file over the Server Action's body limit is refused by the framework itself,
      which throws rather than returning — the panel gets no chance to say anything and the whole
      page falls into the error boundary. That is exactly what a 1.4 MB avatar did. Checking first
      turns the one failure this panel cannot otherwise report into an ordinary sentence.
    */
    if (file.size > UPLOAD_MAX_BYTES) {
      setMessage({
        ok: false,
        text: `That image is ${describeBytes(file.size)}. The most that can be uploaded is ${UPLOAD_MAX_LABEL}.`,
      })
      return
    }

    const form = new FormData()
    form.set('file', file)
    start(async () => {
      /*
        Nothing from here may reach the error boundary. An upload is one control on a panel; if it
        fails, the panel says so and the profile behind it stays exactly where it was.
      */
      try {
        const r = await uploadAvatarAction(playerId, form)
        if (r.error) { setMessage({ ok: false, text: r.error }); return }
        setAvatarUrl(r.url ?? null)
        // The crop starts again for the new picture; the frame is a preference and stays put.
        setFraming((f) => ({ ...f, focalX: 50, focalY: 50, zoom: 100 }))
        setMessage({ ok: true, text: 'Avatar updated.' })
      } catch {
        setMessage({ ok: false, text: 'That image could not be uploaded. Try again.' })
      }
    })
  }

  const saveFraming = (next: typeof framing) => {
    setFraming(next)
    start(async () => { await setAvatarFramingAction(playerId, next) })
  }

  const removeAvatar = () => {
    start(async () => {
      const r = await removeAvatarAction(playerId)
      if (r.error) { setMessage({ ok: false, text: r.error }); return }
      setAvatarUrl(null)
      setMessage({ ok: true, text: 'Avatar removed. The monogram is back.' })
    })
  }

  return (
    <section
      aria-label="Edit profile appearance"
      className="pf-panel pf-reveal mb-3"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="pf-heading">Edit Profile</h2>
        <button type="button" onClick={cancel} className="pf-btn inline-flex items-center gap-1.5 px-2.5 py-1.5">
          <X className="size-3.5" aria-hidden />
          Close
        </button>
      </div>

      {/*
        No loading state, deliberately.

        The panel used to render "Loading your settings…" until a Server Action returned the values
        it needed. They arrive as props now, from the same server render that drew the profile, so
        there is no moment at which this panel exists without them and nothing to wait for.
      */}
      <div className="mt-4 grid gap-6 lg:grid-cols-[18rem_minmax(0,1fr)]">
        {/* ── Avatar ─────────────────────────────────────────────────────────────────────── */}
        <div>
          <h3 className="pf-label">Avatar</h3>
          <div className="mt-2 flex items-center gap-3">
            <ProfileAvatar name={playerName} src={avatarUrl} framing={framing} />
            <div className="flex flex-col gap-2">
              <button type="button" onClick={() => fileRef.current?.click()} className="pf-btn inline-flex items-center gap-1.5 px-2.5 py-1.5" disabled={pending}>
                <Upload className="size-3.5" aria-hidden />
                {avatarUrl ? 'Replace' : 'Upload'}
              </button>
              {avatarUrl && (
                <button type="button" onClick={removeAvatar} className="pf-btn inline-flex items-center gap-1.5 px-2.5 py-1.5" disabled={pending}>
                  <Trash2 className="size-3.5" aria-hidden />
                  Remove
                </button>
              )}
            </div>
          </div>
          <input
            ref={fileRef}
            type="file"
            // A hint for the picker only. The server decides the real type from the file's bytes.
            accept="image/jpeg,image/png,image/webp,image/avif,image/gif"
            className="sr-only"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = '' }}
          />
          <p className="mt-2 text-xs" style={{ color: 'var(--pf-muted)' }}>
            JPG, PNG, WebP, AVIF or GIF, up to {UPLOAD_MAX_LABEL}. Animated GIFs and WebP keep
            their animation.
          </p>

          {/*
            The frame, offered whether or not there is a picture.

            It applies to the monogram too — a player with no avatar still has a shape on their
            profile — so hiding this with the sliders would hide a choice that is doing something.
          */}
          <div className="mt-3">
            <h3 className="pf-label">Frame</h3>
            <div className="mt-1.5 flex gap-2" role="group" aria-label="Avatar frame">
              {AVATAR_SHAPES.map((shape) => (
                <button
                  key={shape}
                  type="button"
                  onClick={() => saveFraming({ ...framing, shape })}
                  aria-pressed={framing.shape === shape}
                  disabled={pending}
                  className="pf-preset pf-press"
                >
                  {/* The swatch is the shape itself, which says more than its name does. */}
                  <span
                    aria-hidden
                    className="pf-shape-swatch"
                    style={{ borderRadius: avatarRadius(shape) }}
                  />
                  {AVATAR_SHAPE_LABELS[shape]}
                </button>
              ))}
            </div>
          </div>

          {avatarUrl && (
            <div className="mt-3 space-y-3">
              <Slider label="Horizontal" value={framing.focalX} min={0} max={100}
                onChange={(v) => saveFraming({ ...framing, focalX: v })} />
              <Slider label="Vertical" value={framing.focalY} min={0} max={100}
                onChange={(v) => saveFraming({ ...framing, focalY: v })} />
              <Slider label="Zoom" value={framing.zoom} min={100} max={300} suffix="%"
                onChange={(v) => saveFraming({ ...framing, zoom: v })} />
              <p className="text-xs" style={{ color: 'var(--pf-muted)' }}>
                Repositioning only changes how the picture is framed. The uploaded file is kept as
                it is, which is what lets an animated avatar stay animated.
              </p>
            </div>
          )}
        </div>

        {/* ── Colours ────────────────────────────────────────────────────────────────────── */}
        <div>
          <h3 className="pf-label">Colours</h3>
          <p className="mt-1 text-xs" style={{ color: 'var(--pf-muted)' }}>
            These apply to this profile only. Changes preview live behind this panel.
          </p>

          {/*
            Presets first.

            Setting seven colours by hand is a job; most people want a different profile, not a
            palette exercise. A preset simply fills the fields below, so it can then be adjusted
            and is saved by the same path with the same server-side contrast check.
          */}
          <div className="mt-3">
            <p className="pf-label">Presets</p>
            <div role="group" aria-label="Colour presets" className="mt-1.5 flex flex-wrap gap-2">
              {THEME_PRESETS.map((preset) => {
                const active = activePreset === preset.id
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => setTheme(preset.theme)}
                    aria-pressed={active}
                    className="pf-preset pf-press"
                    // The swatch IS the preset, so it is drawn from the preset's own values.
                    style={{
                      ['--sw-accent' as string]: preset.theme.accent,
                      ['--sw-accent-2' as string]: preset.theme.accentSecondary,
                      ['--sw-panel' as string]: preset.theme.panelSurface,
                      ['--sw-border' as string]: preset.theme.border,
                    }}
                  >
                    <span aria-hidden className="pf-preset-swatch" />
                    {preset.name}
                  </button>
                )
              })}
            </div>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {THEME_FIELDS.map(({ key, label, hint }) => (
              <div key={key}>
                <label htmlFor={`theme-${key}`} className="pf-label block">{label}</label>
                <div className="mt-1 flex items-center gap-2">
                  <input
                    id={`theme-${key}`}
                    type="color"
                    value={theme[key]}
                    onChange={(e) => setTheme({ ...theme, [key]: e.target.value })}
                    className="size-8 cursor-pointer border bg-transparent p-0"
                    style={{ borderColor: 'var(--pf-border)' }}
                  />
                  <input
                    aria-label={`${label} hex value`}
                    value={theme[key]}
                    onChange={(e) => setTheme({ ...theme, [key]: e.target.value })}
                    spellCheck={false}
                    className="w-24 border px-2 py-1 font-mono text-xs"
                    style={{ background: 'var(--pf-surface)', borderColor: 'var(--pf-border)', color: 'var(--pf-text)' }}
                  />
                </div>
                <p className="mt-1 text-[0.68rem]" style={{ color: 'var(--pf-muted)' }}>{hint}</p>
                {fieldErrors[key] && (
                  <p className="mt-1 text-[0.68rem] text-destructive">{fieldErrors[key]}</p>
                )}
              </div>
            ))}
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" onClick={save} disabled={pending} className="pf-btn pf-press px-3 py-1.5">
              {pending ? 'Saving…' : 'Save'}
            </button>
            <button type="button" onClick={cancel} className="pf-btn pf-press px-3 py-1.5">Cancel</button>
            {/*
              The one place colours can be put back. It used to be duplicated as a button on the
              public profile beside Edit; a control that changes a saved setting belongs in the
              editor that saves it, not in the header everyone sees.
            */}
            <button type="button" onClick={reset} disabled={pending} className="pf-btn pf-press px-3 py-1.5">
              Default Colours
            </button>
          </div>
          {message && (
            <p aria-live="polite" className="mt-2 text-xs" style={{ color: message.ok ? 'var(--pf-accent)' : undefined }}>
              <span className={message.ok ? '' : 'text-destructive'}>{message.text}</span>
            </p>
          )}
        </div>
      </div>
    </section>
  )
}

function Slider({ label, value, min, max, suffix, onChange }: {
  label: string
  value: number
  min: number
  max: number
  suffix?: string
  onChange: (v: number) => void
}) {
  return (
    <div>
      <label className="pf-label flex items-center justify-between">
        <span>{label}</span>
        <span>{value}{suffix ?? '%'}</span>
      </label>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 w-full"
        style={{ accentColor: 'var(--pf-accent)' }}
      />
    </div>
  )
}
