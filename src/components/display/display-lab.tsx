'use client'

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import {
  AlertTriangle, Check, Image as ImageIcon, Palette, RotateCcw, Sliders,
  SlidersHorizontal, Sparkles, Trash2, Upload, X,
} from 'lucide-react'

import { LiveClock } from '@/components/cyber/live-clock'
import { ColorPicker } from '@/components/display/color-picker'
import { Choice, Disclosure, Slider, Toggle } from '@/components/display/controls'
import { DisplayPreview } from '@/components/display/preview'
import {
  ACCEPT_ATTRIBUTE, clearBackground, loadBackground, prepareBackground, saveBackground,
  type StoredBackground,
} from '@/lib/display/background-store'
import { readableInk } from '@/lib/display/color'
import {
  DISPLAY_DEFAULTS, INTENSITY_FIELDS, matchedPreset, withIntensity,
  type Background, type BackgroundFit, type BackgroundPosition, type Corners, type DisplaySettings,
  type FontChoice, type Frame, type Intensity, type Motion, type SurfaceTone, type Texture,
} from '@/lib/display/settings'
import { useDisplaySettings } from '@/lib/display/store'
import { cn } from '@/lib/utils'

/**
 * Display Lab — every appearance control, in four tabs that each fit on a screen.
 *
 * ── Why tabs, when one scrolling column already worked ───────────────────────────────────────────
 * It worked in the sense that everything was reachable. It did not work in the sense that anybody
 * could find anything: thirty controls in one column meant the reader scrolled past the thing they
 * wanted twice before recognising it, and the panel read as a settings dump rather than as four
 * decisions. Presets, Style, Effects and Background are those decisions, and each is short enough to
 * take in without scrolling — the advanced parts fold away until asked for.
 *
 * ── The height rule ──────────────────────────────────────────────────────────────────────────────
 * The drawer is exactly the viewport. Header, preview, tab bar and footer are fixed; ONLY the active
 * tab's content scrolls. So Reset is always reachable, the preview never scrolls out of sight while
 * you are changing what it shows, and the panel cannot grow a second scrollbar inside the page's.
 *
 * ── Changes apply immediately ────────────────────────────────────────────────────────────────────
 * There is no draft and no Save. Every control writes straight through to the document and to
 * storage, because that is what "preview" means for a setting that only affects this browser: the
 * page IS the preview. The small panel at the top exists for the surfaces the drawer happens to be
 * covering, not as a substitute for the real thing. Reset is the way back.
 *
 * ── What it cannot touch ─────────────────────────────────────────────────────────────────────────
 * Anything real. No request, no account field, no database write: a rating, a standing and a
 * published post are identical whatever is set here.
 */

const TABS = [
  { key: 'presets', label: 'Presets', icon: Sparkles },
  { key: 'style', label: 'Style', icon: Palette },
  { key: 'effects', label: 'Effects', icon: Sliders },
  { key: 'background', label: 'Background', icon: ImageIcon },
] as const
type TabKey = (typeof TABS)[number]['key']

const PRESETS: readonly (readonly [Exclude<Intensity, 'custom'>, string, string])[] = [
  ['off', 'Off', 'Palette and layout only. Nothing lit, nothing moving.'],
  ['subtle', 'Subtle', 'Everything present, nothing loud.'],
  ['standard', 'Standard', 'The site as designed.'],
  ['overdrive', 'Overdrive', 'Too much, on purpose — adds aberration and CRT flicker.'],
]

const FRAMES: readonly (readonly [Frame, string])[] = [
  ['minimal', 'Minimal'], ['rails', 'Tech Rails'], ['beveled', 'Beveled'],
  ['neon', 'Neon Edge'], ['broadcast', 'Broadcast'], ['glass', 'Glass'],
]

const TEXTURES: readonly (readonly [Texture, string])[] = [
  ['flat', 'Flat'], ['carbon', 'Carbon'], ['brushed', 'Brushed'], ['frosted', 'Frosted'],
  ['hex', 'Hex Mesh'], ['circuit', 'Circuit'], ['grid', 'Fine Grid'], ['holo', 'Holographic'],
]

const BACKGROUNDS: readonly (readonly [Background, string])[] = [
  ['none', 'None'], ['void-grid', 'Void Grid'], ['carbon-weave', 'Carbon Weave'],
  ['data-stream', 'Data Stream'], ['red-circuit', 'Red Circuit'], ['holographic', 'Holographic'],
]

const FONTS: readonly (readonly [FontChoice, string])[] = [
  ['default', 'Site default'], ['grotesk', 'Space Grotesk'], ['inter', 'Inter'], ['mono', 'JetBrains Mono'],
]

const CORNERS: readonly (readonly [Corners, string])[] = [
  ['chamfer', 'Chamfer'], ['square', 'Square'], ['round', 'Round'],
]

const TONES: readonly (readonly [SurfaceTone, string])[] = [
  ['dark', 'Dark'], ['light', 'Light'], ['auto', 'Auto'],
]

const MOTIONS: readonly (readonly [Motion, string])[] = [
  ['off', 'Off'], ['calm', 'Calm'], ['normal', 'Normal'], ['fast', 'Fast'],
]

const FITS: readonly (readonly [BackgroundFit, string])[] = [
  ['cover', 'Cover'], ['contain', 'Contain'], ['tile', 'Tile'],
]

const POSITIONS: readonly (readonly [BackgroundPosition, string])[] = [
  ['top-left', '↖'], ['top', '↑'], ['top-right', '↗'],
  ['left', '←'], ['center', '•'], ['right', '→'],
  ['bottom-left', '↙'], ['bottom', '↓'], ['bottom-right', '↘'],
]

export function DisplayLab({ className }: { className?: string }) {
  const [settings, save, resetStored] = useDisplaySettings()
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<TabKey>('presets')
  const [background, setBackground] = useState<StoredBackground | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [justReset, setJustReset] = useState(false)

  const drawer = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const titleId = useId()

  /*
   * One writer for every control.
   *
   * Moving any value a preset owns re-derives the preset name — it becomes CUSTOM when the numbers
   * stop matching, and becomes the preset's name again if they are dragged back, so experimenting is
   * not a one-way door out of the presets.
   */
  const edit = useCallback((patch: Partial<DisplaySettings>) => {
    setJustReset(false)
    const next = { ...settings, ...patch }
    if (INTENSITY_FIELDS.some((f) => f in patch)) next.intensity = matchedPreset(next) ?? 'custom'
    save(next)
  }, [settings, save])

  const close = useCallback(() => { setOpen(false); trigger.current?.focus() }, [])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); close(); return }
      if (e.key !== 'Tab' || !drawer.current) return
      const items = drawer.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select, textarea, summary, [tabindex]:not([tabindex="-1"])',
      )
      if (items.length === 0) return
      const first = items[0]
      const last = items[items.length - 1]
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, close])

  useEffect(() => { if (open) drawer.current?.querySelector<HTMLElement>('button')?.focus() }, [open])

  useEffect(() => {
    if (!open) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previous }
  }, [open])

  useEffect(() => { if (open) loadBackground().then(setBackground).catch(() => setBackground(null)) }, [open])

  const resetAll = () => {
    clearBackground().catch(() => { /* nothing stored */ })
    setBackground(null)
    resetStored()
    setUploadError(null)
    setJustReset(true)
  }

  const rememberColour = (hex: string) => {
    const recents = [hex, ...settings.recentColors.filter((c) => c.toLowerCase() !== hex.toLowerCase())].slice(0, 8)
    save({ ...settings, accentMode: 'custom', accentHex: hex, accentInk: readableInk(hex), recentColors: recents })
    setJustReset(false)
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
    if (settings.background === 'custom') edit({ background: 'none' })
  }

  return (
    <>
      <button
        ref={trigger}
        type="button"
        onClick={() => (open ? close() : setOpen(true))}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label="Customize Display"
        title="Customize Display"
        data-testid="display-lab-trigger"
        className={cn(
          'cyber-clip-sm inline-flex size-9 items-center justify-center border border-[var(--hot-red)] bg-[var(--void)]',
          'text-[var(--hot-red)] transition-colors hover:bg-[var(--hot-red)] hover:text-[var(--clean-white)]',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]',
          className,
        )}
      >
        <SlidersHorizontal className="size-4" aria-hidden />
      </button>

      {open && (
        <>
          <div
            className="fixed inset-0 z-[9998] bg-[color-mix(in_oklab,var(--void)_78%,transparent)]"
            onClick={close}
            aria-hidden
          />

          <div
            ref={drawer}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            data-testid="display-lab"
            /*
              `h-dvh`, not `h-screen`. On a phone `100vh` is the viewport WITHOUT the browser chrome,
              so a full-height drawer puts its footer — the Reset button — behind the address bar.
              The dynamic unit tracks the chrome as it collapses.
            */
            className={cn(
              'dl-quiet fixed inset-0 z-[9999] flex h-dvh flex-col bg-[var(--surface)] text-foreground',
              'sm:inset-y-0 sm:left-auto sm:right-0 sm:w-[24rem] sm:border-l sm:border-[var(--line)] lg:w-[27rem]',
            )}
          >
            {/* ── Fixed header ──────────────────────────────────────────────────────────────── */}
            <header className="flex shrink-0 items-center justify-between gap-2 border-b border-[var(--line)] px-4 py-2.5">
              <div className="min-w-0">
                <h2 id={titleId} className="font-display text-sm font-bold uppercase tracking-[0.16em]">Display Lab</h2>
                <p className="text-[0.62rem] text-muted-foreground">Stored in this browser only</p>
              </div>
              <button
                type="button" onClick={close} aria-label="Close Display Lab"
                className="cyber-clip-sm inline-flex size-8 shrink-0 items-center justify-center border border-[var(--line)] text-muted-foreground hover:border-[var(--line-strong)] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
              >
                <X className="size-4" aria-hidden />
              </button>
            </header>

            {/* ── Fixed preview ─────────────────────────────────────────────────────────────── */}
            <div className="shrink-0 border-b border-[var(--line)] px-3 py-2.5">
              <DisplayPreview settings={settings} mode="panel" compact />
            </div>

            {/* ── Fixed tab bar ─────────────────────────────────────────────────────────────── */}
            <div role="tablist" aria-label="Display settings" className="flex shrink-0 border-b border-[var(--line)]">
              {TABS.map(({ key, label, icon: Icon }) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  id={`dl-tab-${key}`}
                  aria-selected={tab === key}
                  aria-controls={`dl-panel-${key}`}
                  onClick={() => setTab(key)}
                  className={cn(
                    'flex flex-1 flex-col items-center gap-0.5 border-b-2 px-1 py-2 text-[0.6rem] font-semibold uppercase tracking-wider transition-colors',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--ring)]',
                    tab === key
                      ? 'border-[var(--acid)] text-[var(--acid)]'
                      : 'border-transparent text-muted-foreground hover:text-foreground',
                  )}
                >
                  <Icon className="size-4" aria-hidden />
                  {label}
                </button>
              ))}
            </div>

            {/* ── The ONLY scrolling region ─────────────────────────────────────────────────── */}
            <div
              role="tabpanel"
              id={`dl-panel-${tab}`}
              aria-labelledby={`dl-tab-${tab}`}
              className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3"
            >
              {tab === 'presets' && <PresetsTab settings={settings} save={save} edit={edit} />}
              {tab === 'style' && <StyleTab settings={settings} edit={edit} onColour={rememberColour} />}
              {tab === 'effects' && <EffectsTab settings={settings} edit={edit} />}
              {tab === 'background' && (
                <BackgroundTab
                  settings={settings} edit={edit}
                  background={background} uploadError={uploadError}
                  fileInput={fileInput} onFile={chooseFile} onRemove={removeImage}
                />
              )}
            </div>

            {/* ── Fixed footer ──────────────────────────────────────────────────────────────── */}
            <footer className="flex shrink-0 items-center justify-between gap-2 border-t border-[var(--line)] px-4 py-2.5">
              <p className="min-w-0 truncate text-[0.62rem] text-muted-foreground">
                {justReset ? 'Back to the site defaults.' : 'Changes apply as you make them.'}
              </p>
              <button
                type="button"
                onClick={resetAll}
                className="cyber-clip-sm inline-flex shrink-0 items-center gap-1.5 border border-[var(--line)] px-3 py-1.5 text-[0.68rem] font-bold uppercase tracking-[0.12em] text-muted-foreground hover:border-[var(--line-strong)] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
              >
                {justReset ? <Check className="size-3.5" aria-hidden /> : <RotateCcw className="size-3.5" aria-hidden />}
                Reset
              </button>
            </footer>
          </div>
        </>
      )}
    </>
  )
}

/* ────────────────────────────────────────────────────────────────────────────── Presets ───────── */

function PresetsTab({ settings, save, edit }: {
  settings: DisplaySettings
  save: (s: DisplaySettings) => void
  edit: (patch: Partial<DisplaySettings>) => void
}) {
  return (
    <div className="space-y-3">
      <p className="text-[0.72rem] leading-snug text-muted-foreground">
        Each preset sets the whole atmosphere at once — glow, texture, scanlines, grid, grain and
        aberration together — so they are four genuinely different rooms rather than four brightness
        levels.
      </p>

      <div className="space-y-1.5">
        {PRESETS.map(([key, label, blurb]) => {
          const active = settings.intensity === key
          return (
            <button
              key={key}
              type="button"
              onClick={() => save(withIntensity(settings, key))}
              aria-pressed={active}
              className={cn(
                'flex w-full items-start gap-3 border p-2.5 text-left transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]',
                /*
                  A solid selected surface, not a wash of accent.

                  Translucent acid over graphite does not read as a paler accent - it mixes to olive,
                  which is precisely what `verify-no-brown` exists to catch, and it caught this. The
                  border and the label carry the accent; the ground stays the neutral the rest of the
                  interface uses for a chosen row.
                */
                active ? 'border-[var(--acid)] bg-[var(--selected-surface)]' : 'border-[var(--line)] hover:border-[var(--line-strong)]',
              )}
            >
              {/* A real sample of what the preset does, drawn by the same rules as a full panel. */}
              <span data-dl-scope {...presetAttrs(key)} className="mt-0.5 block shrink-0" aria-hidden>
                <span className="dl-surface block h-9 w-12 bg-[var(--card)]" />
              </span>
              <span className="min-w-0">
                <span className={cn('block text-xs font-bold uppercase tracking-wider', active ? 'text-[var(--acid)]' : 'text-foreground')}>
                  {label}
                </span>
                <span className="mt-0.5 block text-[0.68rem] leading-snug text-muted-foreground">{blurb}</span>
              </span>
            </button>
          )
        })}
      </div>

      {settings.intensity === 'custom' && (
        <p className="border border-[var(--line)] px-2.5 py-2 text-[0.68rem] leading-snug text-muted-foreground">
          <span className="font-semibold text-foreground">Custom.</span> You have moved something away
          from a preset. Choosing one above puts everything back to it.
        </p>
      )}

      {/*
        The claim, kept where somebody will actually meet it.

        This is the tab the panel opens on, so it is the one place a promise about what these
        controls do NOT touch is guaranteed to be read. It is also true by construction: nothing in
        this component or anything it calls makes a request or writes a row.
      */}
      <p className="text-[0.66rem] leading-snug text-muted-foreground">
        Everything here is stored in this browser only. Nothing changes the data — every rating,
        rank and result is the same whichever way this is set, and nobody else sees your settings.
      </p>

      <Disclosure label="Fine tuning" hint="The values a preset sets. Moving one switches to Custom.">
        <Slider label="Glow" value={settings.glow} onChange={(v) => edit({ glow: v })} />
        <Slider label="Border bloom" value={settings.bloom} onChange={(v) => edit({ bloom: v })} />
        <Slider label="Panel lighting" value={settings.panelLight} onChange={(v) => edit({ panelLight: v })} />
        <Slider label="Technical linework" value={settings.linework} onChange={(v) => edit({ linework: v })} />
        <Slider label="Highlight pulse" value={settings.pulse} onChange={(v) => edit({ pulse: v })} />
        <Slider label="Panel depth" value={settings.depth} onChange={(v) => edit({ depth: v })} />
      </Disclosure>
    </div>
  )
}

/** The attributes a preset would produce, for its thumbnail. */
function presetAttrs(key: Exclude<Intensity, 'custom'>) {
  const v = withIntensity(DISPLAY_DEFAULTS, key)
  return {
    'data-dl-frame': 'minimal',
    'data-dl-corners': 'chamfer',
    'data-dl-texture': 'carbon',
    style: {
      ['--dl-glow' as string]: String(v.glow / 100),
      ['--dl-bloom' as string]: String(v.bloom / 100),
      ['--dl-panel-light' as string]: String(v.panelLight / 100),
      ['--dl-linework' as string]: String(v.linework / 100),
      ['--dl-depth' as string]: String(v.depth / 100),
      ['--dl-texture-strength' as string]: String(v.textureStrength / 100),
      ['--dl-texture-scale' as string]: '1',
    },
  }
}

/* ────────────────────────────────────────────────────────────────────────────── Style ─────────── */

function StyleTab({ settings, edit, onColour }: {
  settings: DisplaySettings
  edit: (patch: Partial<DisplaySettings>) => void
  onColour: (hex: string) => void
}) {
  return (
    <div className="space-y-4">
      <section>
        <h3 className="mb-1.5 text-[0.66rem] font-bold uppercase tracking-[0.16em] text-[var(--acid)]">Accent colour</h3>
        <ColorPicker
          value={settings.accentHex}
          recents={settings.recentColors}
          swatches={settings.swatches}
          onChange={(hex) => edit({ accentMode: 'custom', accentHex: hex, accentInk: readableInk(hex) })}
          onCommit={onColour}
        />
        <p className="mt-1.5 text-[0.66rem] leading-snug text-muted-foreground">
          Colours structure only. Danger, success, warning, championship gold and qualification keep
          their own — a colour that means something is not a preference.
        </p>
        {settings.accentMode === 'custom' && (
          <button
            type="button"
            onClick={() => edit({ accentMode: 'default', accentHex: DISPLAY_DEFAULTS.accentHex, accentInk: DISPLAY_DEFAULTS.accentInk })}
            className="mt-2 border border-[var(--line)] px-2 py-1 text-[0.66rem] font-semibold uppercase tracking-wider text-muted-foreground hover:border-[var(--line-strong)] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
          >
            Back to the site colour
          </button>
        )}
      </section>

      <section>
        <h3 className="mb-1.5 text-[0.66rem] font-bold uppercase tracking-[0.16em] text-[var(--acid)]">Panel frame</h3>
        <Thumbs
          options={FRAMES}
          value={settings.frame}
          onChange={(v) => edit({ frame: v })}
          render={(frame) => (
            <span data-dl-frame={frame} data-dl-texture={settings.texture} className="block" aria-hidden>
              <span className="dl-surface block h-8 w-full bg-[var(--card)]" />
            </span>
          )}
        />
      </section>

      <section>
        <h3 className="mb-1.5 text-[0.66rem] font-bold uppercase tracking-[0.16em] text-[var(--acid)]">Surface texture</h3>
        <Thumbs
          options={TEXTURES}
          value={settings.texture}
          onChange={(v) => edit({ texture: v })}
          render={(texture) => (
            <span
              data-dl-texture={texture} data-dl-frame="minimal" className="block" aria-hidden
              style={{
                ['--dl-texture-strength' as string]: String(Math.max(settings.textureStrength, 25) / 100),
                ['--dl-texture-scale' as string]: String(settings.textureScale / 100),
              }}
            >
              <span className="dl-surface block h-8 w-full bg-[var(--card)]" />
            </span>
          )}
        />
        <div className="mt-2 space-y-3">
          <Slider label="Texture strength" value={settings.textureStrength} onChange={(v) => edit({ textureStrength: v })} max={100} />
          <Slider label="Texture scale" value={settings.textureScale} onChange={(v) => edit({ textureScale: v })} min={50} max={200} />
        </div>
      </section>

      <section>
        <h3 className="mb-1.5 text-[0.66rem] font-bold uppercase tracking-[0.16em] text-[var(--acid)]">Typeface</h3>
        <div className="space-y-1">
          {FONTS.map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => edit({ fontFamily: key })}
              aria-pressed={settings.fontFamily === key}
              className={cn(
                'flex w-full items-center justify-between gap-2 border px-2.5 py-1.5 text-left transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]',
                settings.fontFamily === key ? 'border-[var(--acid)]' : 'border-[var(--line)] hover:border-[var(--line-strong)]',
              )}
            >
              <span className={cn('text-xs font-semibold', settings.fontFamily === key ? 'text-[var(--acid)]' : 'text-foreground')}>{label}</span>
              {/* The sample is set in the face itself, so the choice is made by looking. */}
              <span
                aria-hidden
                className="truncate text-[0.7rem] text-muted-foreground"
                style={{ fontFamily: fontSample(key) }}
              >
                Season 9 · 1,842
              </span>
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-[0.66rem] leading-snug text-muted-foreground">
          Body text only. Headings and numeric columns keep their own faces — a standings table that
          stops being tabular stops lining up.
        </p>
      </section>

      <Disclosure label="Corners and surface tone">
        <Choice label="Corners" value={settings.corners} onChange={(v) => edit({ corners: v })} options={CORNERS} columns={3} />
        <Choice
          label="Surface tone" value={settings.surfaceTone} onChange={(v) => edit({ surfaceTone: v })}
          options={TONES} columns={3}
          hint="How far panels lift off the page behind them. Auto follows your system setting."
        />
      </Disclosure>
    </div>
  )
}

function fontSample(key: FontChoice): string {
  if (key === 'grotesk') return 'var(--font-display)'
  if (key === 'inter') return 'var(--font-inter), sans-serif'
  if (key === 'mono') return 'var(--font-mono)'
  return 'inherit'
}

/* ───────────────────────────────────────────────────────────────────────────── Effects ────────── */

function EffectsTab({ settings, edit }: {
  settings: DisplaySettings
  edit: (patch: Partial<DisplaySettings>) => void
}) {
  return (
    <div className="space-y-4">
      <div>
        <Slider
          label="Glow" value={settings.glow} onChange={(v) => edit({ glow: v })}
          hint="Every lit shadow in the interface, from none at 0% to a genuine bloom at 200%."
        />
        {/* A live read-out of what the number means, so the slider is not judged through a drawer. */}
        <div className="mt-1.5 flex items-center gap-1.5" aria-hidden>
          {[0, 50, 100, 150, 200].map((n) => (
            <span key={n} data-dl-scope className="flex-1" style={{ ['--dl-glow' as string]: String(n / 100) }}>
              <span
                className="block h-6 w-full border border-[var(--acid)]"
                style={{ boxShadow: 'var(--glow-yellow)' }}
              />
              <span className={cn('mt-0.5 block text-center text-[0.55rem] tabular', settings.glow === n ? 'text-[var(--acid)]' : 'text-muted-foreground')}>{n}</span>
            </span>
          ))}
        </div>
      </div>

      <section className="space-y-3">
        <h3 className="text-[0.66rem] font-bold uppercase tracking-[0.16em] text-[var(--acid)]">Overlays</h3>
        {/*
          Strengths, not switches. Zero is off, so a slider that looks like it should do something
          always does — the old pairing of a checkbox and a separate amount could disagree, and when
          it did the amount silently lost.
        */}
        <Slider label="Scanlines" value={settings.scanStrength} onChange={(v) => edit({ scanStrength: v })} />
        <Slider label="Grid" value={settings.gridStrength} onChange={(v) => edit({ gridStrength: v })} />
        <Slider label="Film grain" value={settings.grainStrength} onChange={(v) => edit({ grainStrength: v })} />
        <Slider
          label="Chromatic aberration" value={settings.aberrationStrength} max={100}
          onChange={(v) => edit({ aberrationStrength: v })}
          hint="Display headings only. Never applied to body text."
        />
        <Slider
          label="CRT flicker" value={settings.flickerStrength} max={100}
          onChange={(v) => edit({ flickerStrength: v })}
          hint="Capped well short of a strobe, even at 100%."
        />
      </section>

      <Disclosure label="Motion and extras" hint="A system reduced-motion setting always wins over these.">
        <Choice label="Motion" value={settings.motion} onChange={(v) => edit({ motion: v })} options={MOTIONS} columns={4} />
        <Toggle label="Vignette" on={settings.vignette} onChange={(v) => edit({ vignette: v })} />
        <Toggle label="Border pulse" on={settings.borderPulse} onChange={(v) => edit({ borderPulse: v })} />
        <Toggle label="Live indicator pulse" on={settings.livePulse} onChange={(v) => edit({ livePulse: v })} />
      </Disclosure>

      <Disclosure label="System status" hint="Only that the page is being served now.">
        <LiveClock className="flex items-center" />
      </Disclosure>
    </div>
  )
}

/* ────────────────────────────────────────────────────────────────────────── Background ────────── */

function BackgroundTab({ settings, edit, background, uploadError, fileInput, onFile, onRemove }: {
  settings: DisplaySettings
  edit: (patch: Partial<DisplaySettings>) => void
  background: StoredBackground | null
  uploadError: string | null
  fileInput: React.RefObject<HTMLInputElement | null>
  onFile: (f: File | undefined) => void
  onRemove: () => void
}) {
  return (
    <div className="space-y-4">
      <Thumbs
        options={BACKGROUNDS}
        value={settings.background}
        onChange={(v) => edit({ background: v })}
        render={(bg) => (
          <span data-dl-bg={bg} className="block" aria-hidden>
            <span className="dl-bg-thumb block h-9 w-full" />
          </span>
        )}
      />

      <section>
        <h3 className="mb-1.5 text-[0.66rem] font-bold uppercase tracking-[0.16em] text-[var(--acid)]">Your own image</h3>
        <input
          ref={fileInput} type="file" accept={ACCEPT_ATTRIBUTE} className="sr-only"
          onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = '' }}
        />
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          className="cyber-clip-sm inline-flex min-h-9 w-full items-center justify-center gap-2 border border-[var(--acid)] px-3 py-2 text-[0.68rem] font-bold uppercase tracking-wider text-[var(--acid)] hover:bg-[var(--acid)] hover:text-[var(--acid-ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
        >
          <Upload className="size-3.5" aria-hidden />
          {background ? 'Choose a different image' : 'Choose an image'}
        </button>

        {background && (
          <div className="mt-1.5 flex items-center justify-between gap-2 text-[0.66rem] text-muted-foreground">
            <span className="min-w-0 truncate">
              {background.name} · {background.width}×{background.height} · {(background.bytes / 1024).toFixed(0)} KB
            </span>
            <button
              type="button" onClick={onRemove}
              className="inline-flex shrink-0 items-center gap-1 text-[var(--hot-red)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
            >
              <Trash2 className="size-3" aria-hidden /> Remove
            </button>
          </div>
        )}

        {uploadError && (
          <p role="alert" className="mt-1.5 flex items-start gap-1.5 text-[0.66rem] leading-snug text-[var(--hot-red)]">
            <AlertTriangle className="mt-px size-3 shrink-0" aria-hidden />
            {uploadError}
          </p>
        )}

        <p className="mt-1.5 text-[0.66rem] leading-snug text-muted-foreground">
          Kept in this browser only. Never uploaded, never attached to an account, and re-encoded here
          so any camera and location data in the file is discarded.
        </p>
      </section>

      {settings.background !== 'none' && (
        <section className="space-y-3">
          <h3 className="text-[0.66rem] font-bold uppercase tracking-[0.16em] text-[var(--acid)]">Adjust</h3>
          <Slider label="Opacity" value={settings.bgOpacity} onChange={(v) => edit({ bgOpacity: v })} max={100} />
          <Slider label="Blur" value={settings.bgBlur} onChange={(v) => edit({ bgBlur: v })} max={40} step={1} suffix="px" />
          <Slider
            label="Overlay darkness" value={settings.bgDarken} onChange={(v) => edit({ bgDarken: v })} max={90}
            hint="A neutral layer between the picture and the text. Raise it if anything is hard to read."
          />

          {settings.background === 'custom' && (
            <Disclosure label="Fit and position">
              <Choice label="Fit" value={settings.bgFit} onChange={(v) => edit({ bgFit: v })} options={FITS} columns={3} />
              <div>
                <p className="text-[0.66rem] font-semibold uppercase tracking-wider text-muted-foreground">Alignment</p>
                <div className="mt-1.5 grid w-fit grid-cols-3 gap-1">
                  {POSITIONS.map(([value, glyph]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => edit({ bgPosition: value })}
                      aria-pressed={settings.bgPosition === value}
                      aria-label={value.replace('-', ' ')}
                      className={cn(
                        'flex size-8 items-center justify-center border text-xs transition-colors',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]',
                        settings.bgPosition === value
                          ? 'border-[var(--acid)] bg-[var(--acid)] text-[var(--acid-ink)]'
                          : 'border-[var(--line)] text-muted-foreground hover:border-[var(--line-strong)]',
                      )}
                    >
                      <span aria-hidden>{glyph}</span>
                    </button>
                  ))}
                </div>
              </div>
            </Disclosure>
          )}
        </section>
      )}
    </div>
  )
}

/* ───────────────────────────────────────────────────────────────────────────── shared ─────────── */

/** A grid of visual choices. The thumbnail is the label; the word underneath only confirms it. */
function Thumbs<T extends string>({ options, value, onChange, render }: {
  options: readonly (readonly [T, string])[]
  value: T
  onChange: (v: T) => void
  render: (v: T) => React.ReactNode
}) {
  return (
    <div className="grid grid-cols-3 gap-1.5">
      {options.map(([key, label]) => (
        <button
          key={key}
          type="button"
          onClick={() => onChange(key)}
          aria-pressed={value === key}
          className={cn(
            'flex flex-col gap-1 border p-1 text-left transition-colors',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]',
            value === key ? 'border-[var(--acid)]' : 'border-[var(--line)] hover:border-[var(--line-strong)]',
          )}
        >
          {render(key)}
          <span className={cn('truncate text-[0.58rem] font-semibold uppercase tracking-wider', value === key ? 'text-[var(--acid)]' : 'text-muted-foreground')}>
            {label}
          </span>
        </button>
      ))}
    </div>
  )
}
