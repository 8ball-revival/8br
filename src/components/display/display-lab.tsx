'use client'

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { AlertTriangle, Check, RotateCcw, SlidersHorizontal, Trash2, Upload, X } from 'lucide-react'

import { LiveClock } from '@/components/cyber/live-clock'
import { Choice, Section, Slider, SwatchChoice, Toggle } from '@/components/display/controls'
import { DisplayPreview } from '@/components/display/preview'
import {
  ACCEPT_ATTRIBUTE, clearBackground, loadBackground, prepareBackground, saveBackground,
  type StoredBackground,
} from '@/lib/display/background-store'
import { checkAccent, hexToHsl, hslToHex, readableInk, type Hsl } from '@/lib/display/color'
import {
  DISPLAY_DEFAULTS, INTENSITY_FIELDS, applyDisplay, matchedPreset, withIntensity,
  type Background, type BackgroundFit, type BackgroundPosition, type Corners, type DisplaySettings,
  type Frame, type Intensity, type Motion, type SurfaceTone, type Texture,
} from '@/lib/display/settings'
import { useDisplaySettings } from '@/lib/display/store'
import { cn } from '@/lib/utils'

/**
 * Display Lab — every appearance control the site offers, in one drawer.
 *
 * ── What it is allowed to touch ──────────────────────────────────────────────────────────────────
 * The look of this browser, and nothing else. There is no request, no account field and no database
 * write anywhere in this component or anything it calls: a rating, a standing, a bracket and a
 * published post are identical whatever is set here, and two people reading the same page are
 * reading the same facts. The footer's `Stored in this browser only` is a description of the
 * implementation rather than a promise about how something is handled after we receive it, because
 * nothing is ever received.
 *
 * ── Draft, preview, save ─────────────────────────────────────────────────────────────────────────
 * Every control edits a DRAFT. The draft is written to the preview container immediately, so a
 * reader sees the real rendering as they drag; it reaches the page itself only when they ask for it
 * — either by switching the preview to Full Page, or by pressing Save. Closing without saving puts
 * the stored settings back. That separation is why the panel can offer Overdrive and a photographic
 * background without a reader having to undo an experiment they did not commit to.
 *
 * ── Why the panel does not wear the theme ────────────────────────────────────────────────────────
 * The drawer carries `.dl-quiet`, so the frame, texture, depth and pulse settings do not apply to
 * its own chrome. A control panel that restyles itself as you drag its controls is unusable exactly
 * when you most need to read it — and a Glass frame at 200% glow would make the labels on the
 * sliders that set them illegible.
 */

const INTENSITIES: readonly (readonly [Intensity, string])[] = [
  ['clean', 'Clean'], ['subtle', 'Subtle'], ['standard', 'Standard'], ['overdrive', 'Overdrive'], ['custom', 'Custom'],
]

const FRAMES: readonly (readonly [Frame, string])[] = [
  ['minimal', 'Minimal'], ['rails', 'Tech Rails'], ['beveled', 'Beveled'],
  ['neon', 'Neon Edge'], ['broadcast', 'Broadcast'], ['glass', 'Glass'],
]

const CORNERS: readonly (readonly [Corners, string])[] = [
  ['chamfer', 'Chamfer'], ['square', 'Square'], ['round', 'Round'],
]

const TEXTURES: readonly (readonly [Texture, string])[] = [
  ['flat', 'Flat'], ['carbon', 'Carbon'], ['brushed', 'Brushed'], ['frosted', 'Frosted'],
  ['hex', 'Hex Mesh'], ['circuit', 'Circuit'], ['grid', 'Fine Grid'], ['holo', 'Holographic'],
]

const TONES: readonly (readonly [SurfaceTone, string])[] = [
  ['dark', 'Dark'], ['light', 'Light'], ['auto', 'Auto'],
]

const BACKGROUNDS: readonly (readonly [Background, string])[] = [
  ['none', 'None'], ['void-grid', 'Void Grid'], ['carbon-weave', 'Carbon Weave'], ['data-stream', 'Data Stream'],
  ['red-circuit', 'Red Circuit'], ['holographic', 'Holographic'], ['custom', 'Upload Image'],
]

const FITS: readonly (readonly [BackgroundFit, string])[] = [
  ['cover', 'Cover'], ['contain', 'Contain'], ['tile', 'Tile'],
]

const POSITIONS: readonly (readonly [BackgroundPosition, string])[] = [
  ['top-left', '↖'], ['top', '↑'], ['top-right', '↗'],
  ['left', '←'], ['center', '•'], ['right', '→'],
  ['bottom-left', '↙'], ['bottom', '↓'], ['bottom-right', '↘'],
]

const MOTIONS: readonly (readonly [Motion, string])[] = [
  ['off', 'Off'], ['calm', 'Calm'], ['normal', 'Normal'], ['fast', 'Fast'],
]

export function DisplayLab({ className }: { className?: string }) {
  const [stored, save, resetStored] = useDisplaySettings()
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<DisplaySettings>(stored)
  const [previewMode, setPreviewMode] = useState<'panel' | 'page'>('panel')
  const [dirty, setDirty] = useState(false)
  const [background, setBackground] = useState<StoredBackground | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const drawer = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const titleId = useId()

  /* Opening always starts from what is actually applied, never from an abandoned earlier draft. */
  const openLab = useCallback(() => {
    setDraft(stored)
    setDirty(false)
    setSaved(false)
    setUploadError(null)
    setPreviewMode('panel')
    setOpen(true)
  }, [stored])

  /*
   * Closing puts the STORED settings back on the document.
   *
   * Full Page preview writes the draft to <html> without persisting it, so without this a reader who
   * previewed Overdrive and then closed the drawer would be left looking at a setting they never
   * agreed to, with no obvious way back. Reverting on close is what makes previewing safe enough to
   * be worth offering.
   */
  const closeLab = useCallback(() => {
    applyDisplay(document.documentElement, stored)
    setOpen(false)
    trigger.current?.focus()
  }, [stored])

  const edit = useCallback((patch: Partial<DisplaySettings>) => {
    setDraft((current) => {
      const next = { ...current, ...patch }
      /*
       * Moving any advanced value re-derives the preset name. It becomes CUSTOM when the numbers no
       * longer match a preset, and — just as importantly — becomes the preset's name again if they
       * are dragged back, so experimenting is not a one-way door out of the presets.
       */
      if (INTENSITY_FIELDS.some((f) => f in patch)) next.intensity = matchedPreset(next) ?? 'custom'
      return next
    })
    setDirty(true)
    setSaved(false)
  }, [])

  /* The draft reaches the page only while Full Page preview is on. Otherwise the page is untouched. */
  useEffect(() => {
    if (!open) return
    applyDisplay(document.documentElement, previewMode === 'page' ? draft : stored)
  }, [open, previewMode, draft, stored])

  useEffect(() => { if (open) loadBackground().then(setBackground).catch(() => setBackground(null)) }, [open])

  /*
   * Escape closes, and Tab is trapped.
   *
   * A drawer that covers the page but leaves Tab free sends a keyboard reader into the navigation
   * behind it, with no way to tell they have left and no way back except Shift-Tab through
   * everything. The trap is the drawer's own focusable elements, recomputed on each Tab because the
   * panel's contents change as sections appear.
   */
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); closeLab(); return }
      if (e.key !== 'Tab' || !drawer.current) return
      const items = drawer.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])',
      )
      if (items.length === 0) return
      const first = items[0]
      const last = items[items.length - 1]
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, closeLab])

  /* Focus moves into the drawer on open, so the first Tab is inside it rather than behind it. */
  useEffect(() => {
    if (open) drawer.current?.querySelector<HTMLElement>('button')?.focus()
  }, [open])

  /* The page behind a full-screen sheet must not scroll under it. */
  useEffect(() => {
    if (!open) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previous }
  }, [open])

  const commit = () => {
    save(draft)
    setDirty(false)
    setSaved(true)
  }

  const resetAll = () => {
    /* Reset means the official appearance, which includes forgetting an uploaded image. */
    clearBackground().catch(() => { /* nothing stored */ })
    setBackground(null)
    resetStored()
    setDraft(DISPLAY_DEFAULTS)
    setDirty(false)
    setSaved(true)
    setUploadError(null)
  }

  const chooseFile = async (file: File | undefined) => {
    if (!file) return
    setUploadError(null)
    try {
      const prepared = await prepareBackground(file)
      await saveBackground(prepared)
      setBackground(prepared)
      edit({ background: 'custom' })
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : 'That image could not be used.')
    }
  }

  const removeImage = async () => {
    await clearBackground()
    setBackground(null)
    if (draft.background === 'custom') edit({ background: 'none' })
  }

  return (
    <>
      <button
        ref={trigger}
        type="button"
        onClick={open ? closeLab : openLab}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label="Customize Display"
        title="Customize Display"
        data-testid="display-lab-trigger"
        className={cn(
          'cyber-clip-sm inline-flex size-9 items-center justify-center border transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]',
          open
            ? 'border-[var(--hot-red)] bg-[var(--void)] text-[var(--hot-red)]'
            : 'border-[var(--hot-red)] bg-[var(--void)] text-[var(--hot-red)] hover:bg-[var(--hot-red)] hover:text-[var(--clean-white)]',
          className,
        )}
      >
        <SlidersHorizontal className="size-4" aria-hidden />
      </button>

      {open && (
        <>
          {/* The scrim. Clicking it closes, which is the gesture people try first on a drawer. */}
          <div
            className="fixed inset-0 z-[9998] bg-[color-mix(in_oklab,var(--void)_78%,transparent)]"
            onClick={closeLab}
            aria-hidden
          />

          <div
            ref={drawer}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            data-testid="display-lab"
            className={cn(
              /*
               * Full screen on a phone, a full-height drawer on a desktop. Not a floating popover:
               * this holds thirty controls and a live preview, and a popover either clips them or
               * grows until it covers the page anyway without any of a drawer's affordances.
               */
              'dl-quiet fixed inset-0 z-[9999] flex flex-col bg-[var(--surface)] text-foreground',
              'sm:inset-y-0 sm:left-auto sm:right-0 sm:w-[26rem] sm:border-l sm:border-[var(--line)]',
              'lg:w-[30rem]',
            )}
          >
            <header className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-[var(--line)] bg-[var(--surface)] px-4 py-3 sm:px-5">
              <div className="min-w-0">
                <h2 id={titleId} className="font-display text-sm font-bold uppercase tracking-[0.16em] text-foreground">
                  Display Lab
                </h2>
                <p className="text-[0.66rem] text-muted-foreground">Stored in this browser only</p>
              </div>
              <button
                type="button"
                onClick={closeLab}
                aria-label="Close Display Lab"
                className="cyber-clip-sm inline-flex size-8 shrink-0 items-center justify-center border border-[var(--line)] text-muted-foreground transition-colors hover:border-[var(--line-strong)] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
              >
                <X className="size-4" aria-hidden />
              </button>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
              {/* ── Preview ─────────────────────────────────────────────────────────────────── */}
              <Section
                title="Live Preview"
                hint="The real rendering, not a mock-up. Nothing here is saved until you press Save."
              >
                <Choice
                  value={previewMode}
                  onChange={setPreviewMode}
                  options={[['panel', 'Panel Only'], ['page', 'Full Page']] as const}
                  columns={2}
                />
                <DisplayPreview settings={draft} mode={previewMode} />
              </Section>

              {/* ── Intensity ───────────────────────────────────────────────────────────────── */}
              <Section
                title="Intensity"
                hint="How much light, depth and linework the interface carries. Moving any slider below switches to Custom."
              >
                <Choice
                  value={draft.intensity}
                  onChange={(v) => { if (v !== 'custom') { setDraft(withIntensity(draft, v)); setDirty(true); setSaved(false) } }}
                  options={INTENSITIES}
                  columns={3}
                  hint="Custom appears on its own once you change a value."
                />
                <Slider label="Glow" value={draft.glow} onChange={(v) => edit({ glow: v })} />
                <Slider label="Border Bloom" value={draft.bloom} onChange={(v) => edit({ bloom: v })} />
                <Slider label="Panel Lighting" value={draft.panelLight} onChange={(v) => edit({ panelLight: v })} />
                <Slider label="Technical Linework" value={draft.linework} onChange={(v) => edit({ linework: v })} />
                <Slider label="Grid Strength" value={draft.gridStrength} onChange={(v) => edit({ gridStrength: v })} />
                <Slider label="Scanline Strength" value={draft.scanStrength} onChange={(v) => edit({ scanStrength: v })} />
                <Slider label="Highlight Pulse" value={draft.pulse} onChange={(v) => edit({ pulse: v })} />
              </Section>

              {/* ── Colour ──────────────────────────────────────────────────────────────────── */}
              <ColourLab draft={draft} edit={edit} />

              {/* ── Structure ───────────────────────────────────────────────────────────────── */}
              <Section title="Frame" hint="Applies to every shared panel — Competition History, News, Rankings, Achievements, Season and Tournament summaries. Dense tables and small controls stay plain.">
                <SwatchChoice
                  value={draft.frame}
                  onChange={(v) => edit({ frame: v })}
                  options={FRAMES}
                  renderSwatch={(frame) => (
                    <span data-dl-frame={frame} className="block" aria-hidden>
                      <span className="dl-surface block h-9 w-full bg-[var(--card)]" />
                    </span>
                  )}
                />
                <Choice label="Corners" value={draft.corners} onChange={(v) => edit({ corners: v })} options={CORNERS} columns={3} />
              </Section>

              {/* ── Surface ─────────────────────────────────────────────────────────────────── */}
              <Section title="Surface Texture">
                <SwatchChoice
                  value={draft.texture}
                  onChange={(v) => edit({ texture: v })}
                  options={TEXTURES}
                  renderSwatch={(texture) => (
                    <span
                      data-dl-texture={texture}
                      data-dl-frame="minimal"
                      className="block"
                      style={{
                        // The strip previews the reader's OWN strength and scale, not a fixed sample.
                        ['--dl-texture-strength' as string]: String(draft.textureStrength / 100),
                        ['--dl-texture-scale' as string]: String(draft.textureScale / 100),
                      }}
                      aria-hidden
                    >
                      <span className="dl-surface block h-9 w-full bg-[var(--card)]" />
                    </span>
                  )}
                />
                <Slider label="Texture Strength" value={draft.textureStrength} onChange={(v) => edit({ textureStrength: v })} max={100} />
                <Slider label="Texture Scale" value={draft.textureScale} onChange={(v) => edit({ textureScale: v })} min={50} max={200} />
                <Choice
                  label="Surface Tone" value={draft.surfaceTone} onChange={(v) => edit({ surfaceTone: v })}
                  options={TONES} columns={3}
                  hint="How far panels lift away from the page behind them. Auto follows your system setting."
                />
              </Section>

              {/* ── Background ──────────────────────────────────────────────────────────────── */}
              <Section title="Background">
                <Choice value={draft.background} onChange={(v) => edit({ background: v })} options={BACKGROUNDS} columns={2} />

                {draft.background === 'custom' && (
                  <div className="space-y-3 border border-[var(--line)] p-3">
                    <input
                      ref={fileInput}
                      type="file"
                      accept={ACCEPT_ATTRIBUTE}
                      className="sr-only"
                      onChange={(e) => { void chooseFile(e.target.files?.[0]); e.target.value = '' }}
                    />
                    <button
                      type="button"
                      onClick={() => fileInput.current?.click()}
                      className="cyber-clip-sm inline-flex min-h-9 w-full items-center justify-center gap-2 border border-[var(--acid)] px-3 py-2 text-[0.7rem] font-bold uppercase tracking-wider text-[var(--acid)] transition-colors hover:bg-[var(--acid)] hover:text-[var(--acid-ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                    >
                      <Upload className="size-3.5" aria-hidden />
                      {background ? 'Choose a different image' : 'Choose an image'}
                    </button>

                    {background && (
                      <div className="flex items-center justify-between gap-2 text-[0.68rem] text-muted-foreground">
                        <span className="min-w-0 truncate">
                          {background.name} · {background.width}×{background.height} · {(background.bytes / 1024).toFixed(0)} KB
                        </span>
                        <button
                          type="button"
                          onClick={() => void removeImage()}
                          className="inline-flex shrink-0 items-center gap-1 text-[var(--hot-red)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                        >
                          <Trash2 className="size-3" aria-hidden />
                          Remove
                        </button>
                      </div>
                    )}

                    {uploadError && (
                      <p role="alert" className="flex items-start gap-1.5 text-[0.68rem] leading-snug text-[var(--hot-red)]">
                        <AlertTriangle className="mt-px size-3 shrink-0" aria-hidden />
                        {uploadError}
                      </p>
                    )}

                    <p className="text-[0.66rem] leading-snug text-muted-foreground">
                      The image stays in this browser. It is never uploaded, never attached to an account, and
                      is re-encoded here so any camera and location data in the file is discarded.
                    </p>

                    <Choice label="Fit" value={draft.bgFit} onChange={(v) => edit({ bgFit: v })} options={FITS} columns={3} />

                    <div>
                      <p className="text-[0.7rem] font-semibold uppercase tracking-wider text-muted-foreground">Alignment</p>
                      <div className="mt-1.5 grid w-fit grid-cols-3 gap-1">
                        {POSITIONS.map(([value, glyph]) => (
                          <button
                            key={value}
                            type="button"
                            onClick={() => edit({ bgPosition: value })}
                            aria-pressed={draft.bgPosition === value}
                            aria-label={value.replace('-', ' ')}
                            className={cn(
                              'flex size-8 items-center justify-center border text-xs transition-colors',
                              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]',
                              draft.bgPosition === value
                                ? 'border-[var(--acid)] bg-[var(--acid)] text-[var(--acid-ink)]'
                                : 'border-[var(--line)] text-muted-foreground hover:border-[var(--line-strong)]',
                            )}
                          >
                            <span aria-hidden>{glyph}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {draft.background !== 'none' && (
                  <>
                    <Slider label="Opacity" value={draft.bgOpacity} onChange={(v) => edit({ bgOpacity: v })} max={100} />
                    <Slider label="Blur" value={draft.bgBlur} onChange={(v) => edit({ bgBlur: v })} max={40} step={1} suffix="px" />
                    <Slider
                      label="Darken" value={draft.bgDarken} onChange={(v) => edit({ bgDarken: v })} max={90}
                      hint="A neutral layer between the background and the text. Raise it if anything is hard to read."
                    />
                  </>
                )}
              </Section>

              {/* ── Effects ─────────────────────────────────────────────────────────────────── */}
              <Section title="Effects">
                <Slider label="Panel Depth" value={draft.depth} onChange={(v) => edit({ depth: v })} />
                <Choice
                  label="Motion" value={draft.motion} onChange={(v) => edit({ motion: v })} options={MOTIONS} columns={4}
                  hint="A system reduced-motion setting always wins over this."
                />
                <div className="space-y-1">
                  <Toggle label="Scanlines" on={draft.scanlines} onChange={(v) => edit({ scanlines: v })} />
                  <Toggle label="Grid" on={draft.grid} onChange={(v) => edit({ grid: v })} />
                  <Toggle label="Film grain" on={draft.grain} onChange={(v) => edit({ grain: v })} />
                  <Toggle
                    label="Chromatic aberration" on={draft.aberration} onChange={(v) => edit({ aberration: v })}
                    hint="Headings only. It is never applied to body text."
                  />
                  <Toggle label="Vignette" on={draft.vignette} onChange={(v) => edit({ vignette: v })} />
                  <Toggle label="Border pulse" on={draft.borderPulse} onChange={(v) => edit({ borderPulse: v })} />
                  <Toggle label="Live indicator pulse" on={draft.livePulse} onChange={(v) => edit({ livePulse: v })} />
                </div>
              </Section>

              {/* ── System status ───────────────────────────────────────────────────────────── */}
              <Section title="System Status" hint="Only that the page is being served now — it says nothing about competitions being in progress.">
                <LiveClock className="flex items-center" />
              </Section>

              <p className="px-4 pb-5 text-[0.68rem] leading-snug text-muted-foreground sm:px-5">
                Everything here is stored in this browser only. Nothing changes the data — every rating,
                rank and result is the same whichever way this is set, and nobody else sees your settings.
              </p>
            </div>

            <footer className="sticky bottom-0 z-10 flex items-center gap-2 border-t border-[var(--line)] bg-[var(--surface)] px-4 py-3 sm:px-5">
              <button
                type="button"
                onClick={commit}
                className="cyber-clip-sm inline-flex min-h-10 flex-1 items-center justify-center gap-2 bg-[var(--acid)] px-4 text-[0.72rem] font-bold uppercase tracking-[0.12em] text-[var(--acid-ink)] transition-colors hover:bg-[var(--acid-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
              >
                {saved && !dirty ? <Check className="size-3.5" aria-hidden /> : null}
                {saved && !dirty ? 'Saved' : 'Save Custom'}
              </button>
              <button
                type="button"
                onClick={resetAll}
                className="cyber-clip-sm inline-flex min-h-10 items-center justify-center gap-2 border border-[var(--line)] px-3 text-[0.72rem] font-bold uppercase tracking-[0.12em] text-muted-foreground transition-colors hover:border-[var(--line-strong)] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
              >
                <RotateCcw className="size-3.5" aria-hidden />
                Reset
              </button>
            </footer>
          </div>
        </>
      )}
    </>
  )
}

/**
 * Colour Lab — a free choice of accent, with the one constraint that keeps it usable.
 *
 * The four locked accent buttons are gone. In their place: hue, saturation and lightness, an exact
 * hex field for somebody who already knows the colour they want, and saved swatches. What is NOT
 * offered is a choice of text colour on the accent, because that is not a preference — it is whether
 * the navigation bar can be read, and it is measured rather than picked.
 */
function ColourLab({ draft, edit }: {
  draft: DisplaySettings
  edit: (patch: Partial<DisplaySettings>) => void
}) {
  const hexId = useId()
  const [hsl, setHsl] = useState<Hsl>(() => hexToHsl(draft.accentHex) ?? { h: 0, s: 0, l: 96 })
  const [typed, setTyped] = useState(draft.accentHex)

  /*
   * The HSL sliders keep their own state, and this is not redundancy.
   *
   * Hue is not recoverable from a hex once saturation reaches zero — every grey is hue 0 — so
   * deriving the slider positions from the stored colour would silently reset the hue to red the
   * moment somebody dragged saturation down, and dragging it back up would return the wrong colour.
   * The sliders hold the position; the hex holds the result.
   */
  const applyHsl = (next: Hsl) => {
    setHsl(next)
    const hex = hslToHex(next)
    setTyped(hex)
    edit({ accentMode: 'custom', accentHex: hex, accentInk: readableInk(hex) })
  }

  const applyHex = (hex: string) => {
    const parsed = hexToHsl(hex)
    if (!parsed) return
    setHsl(parsed)
    edit({ accentMode: 'custom', accentHex: hex.toLowerCase(), accentInk: readableInk(hex) })
  }

  const check = checkAccent(draft.accentHex)
  const custom = draft.accentMode === 'custom'

  return (
    <Section
      title="Colour Lab"
      hint="The accent colours structure — chrome, selection borders, technical lines and interactive highlights. It never recolours what a colour MEANS: danger, success, warning, championship gold and qualification keep their own."
    >
      <div className="flex items-stretch gap-3">
        <div
          className="size-16 shrink-0 border border-[var(--line)]"
          style={{ backgroundColor: draft.accentHex }}
          aria-hidden
        />
        <div className="flex min-w-0 flex-1 flex-col justify-center gap-1">
          <label htmlFor={hexId} className="text-[0.7rem] font-semibold uppercase tracking-wider text-muted-foreground">
            Hex
          </label>
          <input
            id={hexId}
            type="text"
            value={typed}
            spellCheck={false}
            onChange={(e) => { setTyped(e.target.value); applyHex(e.target.value) }}
            className="tabular w-full border border-[var(--line)] bg-[var(--void)] px-2 py-1.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
          />
          <p className="text-[0.66rem] text-muted-foreground">
            Text on this colour: {check.ratio.toFixed(1)}:1
          </p>
        </div>
      </div>

      <Slider label="Hue" value={hsl.h} onChange={(h) => applyHsl({ ...hsl, h })} max={360} step={1} suffix="°" />
      <Slider label="Saturation" value={hsl.s} onChange={(s) => applyHsl({ ...hsl, s })} max={100} step={1} />
      <Slider label="Lightness" value={hsl.l} onChange={(l) => applyHsl({ ...hsl, l })} max={100} step={1} />

      {!check.passes && (
        <div role="alert" className="border border-[var(--warning)] p-2.5">
          <p className="flex items-start gap-1.5 text-[0.7rem] leading-snug text-[var(--warning)]">
            <AlertTriangle className="mt-px size-3.5 shrink-0" aria-hidden />
            <span>
              Text on this colour measures {check.ratio.toFixed(1)}:1, below the 4.5:1 needed to read
              comfortably. The navigation bar and buttons use it as a background.
            </span>
          </p>
          {check.suggestion && (
            <button
              type="button"
              onClick={() => applyHex(check.suggestion as string)}
              className="mt-2 inline-flex items-center gap-2 border border-[var(--warning)] px-2 py-1 text-[0.68rem] font-semibold uppercase tracking-wider text-[var(--warning)] transition-colors hover:bg-[var(--warning)] hover:text-[var(--void)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
            >
              <span className="size-3 border border-current" style={{ backgroundColor: check.suggestion }} aria-hidden />
              Use the nearest readable shade
            </button>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => {
            if (draft.swatches.includes(draft.accentHex)) return
            edit({ swatches: [draft.accentHex, ...draft.swatches].slice(0, 12) })
          }}
          className="cyber-clip-sm border border-[var(--line)] px-2 py-1 text-[0.68rem] font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:border-[var(--line-strong)] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
        >
          Save Swatch
        </button>
        {custom && (
          <button
            type="button"
            onClick={() => {
              edit({ accentMode: 'default', accentHex: DISPLAY_DEFAULTS.accentHex, accentInk: DISPLAY_DEFAULTS.accentInk })
              setHsl(hexToHsl(DISPLAY_DEFAULTS.accentHex) ?? { h: 0, s: 0, l: 96 })
              setTyped(DISPLAY_DEFAULTS.accentHex)
            }}
            className="cyber-clip-sm border border-[var(--line)] px-2 py-1 text-[0.68rem] font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:border-[var(--line-strong)] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
          >
            Site Default
          </button>
        )}
      </div>

      {draft.swatches.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {draft.swatches.map((hex) => (
            <button
              key={hex}
              type="button"
              onClick={() => applyHex(hex)}
              aria-label={`Use ${hex}`}
              title={hex}
              className={cn(
                'size-7 border transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]',
                draft.accentHex === hex ? 'border-[var(--acid)]' : 'border-[var(--line)]',
              )}
              style={{ backgroundColor: hex }}
            />
          ))}
        </div>
      )}
    </Section>
  )
}
