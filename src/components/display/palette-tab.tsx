'use client'

import { useMemo, useState } from 'react'
import { RotateCcw, AlertTriangle, TriangleAlert, Check } from 'lucide-react'

import type { DisplaySettings } from '@/lib/display/settings'
import { THEME_GROUPS, THEME_TOKEN_REGISTRY, TOKEN_BY_KEY, type ThemeToken } from '@/lib/theme/registry'
import { THEME_PRESETS, normaliseTokens, isValidTokenValue } from '@/lib/theme/presets'
import { verdictFor, suggestFor, resolveToken, type PairingResult } from '@/lib/theme/contrast'
import { Disclosure, Section } from './controls'
import { cn } from '@/lib/utils'

/**
 * The palette: one control per semantic role, and a live account of what those choices do to
 * legibility.
 *
 * ── Why this is not a wall of pickers ───────────────────────────────────────────────────────────
 * Each control here moves a token that the rest of the stylesheet DERIVES from, so "Panel surface"
 * is not the colour of one panel — it is the colour of every panel, popover and news column at once.
 * The count of controls is therefore small and the reach is total, which is the opposite trade to
 * the one a per-component picker makes.
 *
 * ── Why the contrast readout is part of the same screen ─────────────────────────────────────────
 * A separate accessibility report is a thing people run afterwards, once. Here the ratios move while
 * the colour is being dragged, the failures name the control that caused them, and the publish path
 * is closed while an essential pairing fails. That is the difference between a check and a guard.
 */
export function PaletteTab({
  settings, edit,
}: {
  settings: DisplaySettings
  edit: (patch: Partial<DisplaySettings>) => void
}) {
  const tokens = useMemo(() => normaliseTokens(settings.tokens), [settings.tokens])
  const verdict = useMemo(() => verdictFor(tokens), [tokens])

  const setToken = (key: string, value: string) => {
    const next = { ...tokens }
    if (!value.trim()) delete next[key]
    else next[key] = value.trim().toLowerCase()
    edit({ tokens: next, preset: 'custom' })
  }

  const resetToken = (key: string) => {
    const next = { ...tokens }
    delete next[key]
    edit({ tokens: next, preset: Object.keys(next).length ? 'custom' : 'graphite-signal' })
  }

  const resetGroup = (group: string) => {
    const next = { ...tokens }
    for (const t of THEME_TOKEN_REGISTRY) if (t.group === group) delete next[t.key]
    edit({ tokens: next, preset: Object.keys(next).length ? 'custom' : 'graphite-signal' })
  }

  const applyPreset = (id: string) => {
    const preset = THEME_PRESETS.find((p) => p.id === id)
    if (!preset) return
    edit({ tokens: { ...preset.values }, preset: id })
  }

  const overriddenCount = Object.keys(tokens).length

  return (
    <div className="space-y-3">
      {/* ── Presets ────────────────────────────────────────────────────────────────────────── */}
      <Section title="Starting point" hint="Every preset sets the same tokens. Pick one, then change anything.">
        <div className="grid gap-1.5">
          {THEME_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => applyPreset(p.id)}
              aria-pressed={settings.preset === p.id}
              className={cn(
                'flex items-start gap-2.5 border p-2 text-left transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]',
                settings.preset === p.id
                  ? 'border-[var(--acid)] bg-[var(--accent)]'
                  : 'border-[var(--line)] hover:border-[var(--line-strong)]',
              )}
            >
              <PresetSwatches preset={p.values} />
              <span className="min-w-0 flex-1">
                <span className="block text-[0.72rem] font-semibold text-foreground">{p.name}</span>
                <span className="mt-0.5 block text-[0.66rem] leading-snug text-muted-foreground">{p.blurb}</span>
              </span>
              {settings.preset === p.id && <Check className="mt-0.5 size-3.5 shrink-0 text-[var(--acid)]" aria-hidden />}
            </button>
          ))}
        </div>
      </Section>

      {/* ── Legibility ─────────────────────────────────────────────────────────────────────── */}
      <ContrastReport verdict={verdict} onFix={(r) => setToken(r.blame[0], suggestFor(r) ?? '')} />

      {/* ── The tokens, by role ────────────────────────────────────────────────────────────── */}
      {THEME_GROUPS.map((group) => {
        const inGroup = THEME_TOKEN_REGISTRY.filter((t) => t.group === group.id)
        const changed = inGroup.filter((t) => tokens[t.key]).length
        return (
          <Disclosure
            key={group.id}
            label={`${group.label}${changed ? ` · ${changed} changed` : ''}`}
            hint={group.blurb}
          >
            <div className="space-y-2">
              {changed > 0 && (
                <button
                  type="button"
                  onClick={() => resetGroup(group.id)}
                  className="inline-flex items-center gap-1 text-[0.66rem] font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                >
                  <RotateCcw className="size-3" aria-hidden />
                  Reset this section
                </button>
              )}
              {inGroup.map((token) => (
                <TokenRow
                  key={token.key}
                  token={token}
                  value={tokens[token.key]}
                  effective={resolveToken(token.key, tokens)}
                  failing={verdict.results.filter((r) => r.verdict !== 'pass' && r.blame.includes(token.key))}
                  onChange={(v) => setToken(token.key, v)}
                  onReset={() => resetToken(token.key)}
                />
              ))}
            </div>
          </Disclosure>
        )
      })}

      {overriddenCount > 0 && (
        <button
          type="button"
          onClick={() => edit({ tokens: {}, preset: 'graphite-signal' })}
          className="w-full border border-[var(--line)] py-2 text-[0.66rem] font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:border-[var(--hot-red)] hover:text-[var(--hot-red)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
        >
          Reset the whole palette ({overriddenCount} changed)
        </button>
      )}

      <p className="pt-1 text-[0.66rem] leading-relaxed text-muted-foreground">
        Stored in this browser only. It changes what you see, never what the site records — a
        Season&rsquo;s standings and a player&rsquo;s rating are the same whatever is set here.
      </p>
    </div>
  )
}

/**
 * One token: what it is, what it looks like, and whether anything it touches has stopped being
 * readable.
 *
 * The text input and the colour input are two views of one value rather than two controls. Typing is
 * how somebody pastes a brand colour; the swatch is how somebody explores. Neither is authoritative,
 * and an unparseable typed value is held locally without being stored, so the page does not flicker
 * through `#f`, `#f0`, `#f0a` while a six-digit colour is being typed.
 */
function TokenRow({
  token, value, effective, failing, onChange, onReset,
}: {
  token: ThemeToken
  value: string | undefined
  effective: string
  failing: PairingResult[]
  onChange: (v: string) => void
  onReset: () => void
}) {
  const [typed, setTyped] = useState<string | null>(null)
  const shown = typed ?? value ?? ''
  const overridden = Boolean(value)
  const blocking = failing.some((f) => f.verdict === 'block')

  return (
    <div className={cn('border p-2', blocking ? 'border-[var(--hot-red)]' : 'border-[var(--line)]')}>
      <div className="flex items-center gap-2">
        <label className="relative size-7 shrink-0 cursor-pointer overflow-hidden border border-[var(--line-strong)]">
          <span className="absolute inset-0" style={{ background: effective }} aria-hidden />
          <input
            type="color"
            value={/^#[0-9a-f]{6}$/i.test(effective) ? effective : '#000000'}
            onChange={(e) => { setTyped(null); onChange(e.target.value) }}
            className="absolute inset-0 cursor-pointer opacity-0"
            aria-label={`${token.label} colour`}
          />
        </label>

        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="truncate text-[0.72rem] font-semibold text-foreground">{token.label}</span>
            {overridden
              ? <span className="shrink-0 rounded-sm bg-[var(--accent)] px-1 text-[0.66rem] font-bold uppercase tracking-wider text-[var(--acid)]">set</span>
              : <span className="shrink-0 text-[0.66rem] font-medium uppercase tracking-wider text-muted-foreground">inherited</span>}
          </span>
          <code className="mt-0.5 block truncate text-[0.66rem] text-muted-foreground">{token.css}</code>
        </span>

        <input
          type="text"
          value={shown}
          placeholder={token.fallback}
          spellCheck={false}
          onChange={(e) => {
            const v = e.target.value
            setTyped(v)
            if (v === '' || isValidTokenValue(v)) { setTyped(null); onChange(v) }
          }}
          onBlur={() => setTyped(null)}
          aria-label={`${token.label} hex value`}
          aria-invalid={typed != null && typed !== '' && !isValidTokenValue(typed)}
          className={cn(
            'w-[5.6rem] shrink-0 border bg-[var(--void)] px-1.5 py-1 font-mono text-[0.66rem] text-foreground',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]',
            typed != null && typed !== '' && !isValidTokenValue(typed)
              ? 'border-[var(--hot-red)]'
              : 'border-[var(--line)]',
          )}
        />

        {overridden && (
          <button
            type="button"
            onClick={() => { setTyped(null); onReset() }}
            aria-label={`Reset ${token.label}`}
            className="shrink-0 p-1 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
          >
            <RotateCcw className="size-3.5" aria-hidden />
          </button>
        )}
      </div>

      <p className="mt-1.5 text-[0.66rem] leading-snug text-muted-foreground">{token.effect}</p>

      {token.cascadesTo && token.cascadesTo.length > 0 && (
        <p className="mt-1 text-[0.66rem] text-muted-foreground/80">
          {token.cascadesTo.length} other {token.cascadesTo.length === 1 ? 'role follows' : 'roles follow'} this.
        </p>
      )}

      {failing.length > 0 && (
        <ul className="mt-1.5 space-y-1">
          {failing.map((f) => (
            <li key={f.id} className={cn('text-[0.66rem]', f.verdict === 'block' ? 'text-[var(--hot-red)]' : 'text-[var(--warning)]')}>
              {f.where}: {f.ratio}:1, needs {f.needed}:1
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** Every pairing the site can render, and whether this palette may be published. */
function ContrastReport({ verdict, onFix }: { verdict: ReturnType<typeof verdictFor>; onFix: (r: PairingResult) => void }) {
  const { blocking, warnings, results } = verdict
  const passing = results.length - blocking.length - warnings.length

  return (
    <Section title="Legibility" hint={`${results.length} pairings checked, including hover, focus and disabled states.`}>
      <div
        className={cn(
          'border p-2',
          blocking.length ? 'border-[var(--hot-red)] bg-[color-mix(in_oklab,var(--hot-red)_8%,transparent)]' : 'border-[var(--line)]',
        )}
        role="status"
      >
        <p className="flex items-center gap-1.5 text-[0.7rem] font-semibold">
          {blocking.length ? (
            <>
              <AlertTriangle className="size-3.5 shrink-0 text-[var(--hot-red)]" aria-hidden />
              <span className="text-[var(--hot-red)]">
                {blocking.length} {blocking.length === 1 ? 'combination makes' : 'combinations make'} essential text unreadable
              </span>
            </>
          ) : (
            <>
              <Check className="size-3.5 shrink-0 text-[var(--success)]" aria-hidden />
              <span className="text-foreground">Everything essential is readable</span>
            </>
          )}
        </p>
        <p className="mt-1 text-[0.66rem] text-muted-foreground">
          {passing} pass · {warnings.length} advisory · {blocking.length} blocking
        </p>
        {blocking.length > 0 && (
          <p className="mt-1 text-[0.66rem] text-muted-foreground">
            A palette cannot be published while any of these fail.
          </p>
        )}
      </div>

      {[...blocking, ...warnings].slice(0, 8).map((r) => {
        const suggestion = suggestFor(r)
        return (
          <div key={r.id} className="mt-1.5 border border-[var(--line)] p-2">
            <p className="flex items-start gap-1.5 text-[0.66rem] font-semibold text-foreground">
              {r.verdict === 'block'
                ? <AlertTriangle className="mt-px size-3 shrink-0 text-[var(--hot-red)]" aria-hidden />
                : <TriangleAlert className="mt-px size-3 shrink-0 text-[var(--warning)]" aria-hidden />}
              {r.where}
            </p>
            <p className="mt-1 flex items-center gap-1.5 text-[0.66rem] text-muted-foreground">
              <span className="inline-block size-3 border border-[var(--line-strong)]" style={{ background: r.bgHex }} aria-hidden />
              <span className="inline-block size-3 border border-[var(--line-strong)]" style={{ background: r.fgHex }} aria-hidden />
              {r.ratio}:1 — needs {r.needed}:1
              <span className="ml-auto">{TOKEN_BY_KEY.get(r.blame[0])?.label} on {TOKEN_BY_KEY.get(r.blame[1])?.label}</span>
            </p>
            {suggestion && (
              <button
                type="button"
                onClick={() => onFix(r)}
                className="mt-1.5 inline-flex items-center gap-1.5 border border-[var(--line-strong)] px-2 py-1 text-[0.66rem] font-semibold uppercase tracking-wider text-foreground transition-colors hover:border-[var(--acid)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
              >
                <span className="inline-block size-2.5 border border-[var(--line-strong)]" style={{ background: suggestion }} aria-hidden />
                Use the nearest readable shade
              </button>
            )}
            {!suggestion && (
              <p className="mt-1 text-[0.66rem] text-muted-foreground">
                No shade of this colour clears it — the surface behind it has to move instead.
              </p>
            )}
          </div>
        )
      })}
    </Section>
  )
}

/** Five swatches from a preset, so a preset is recognisable before it is applied. */
function PresetSwatches({ preset }: { preset: Record<string, string> }) {
  const keys = ['void', 'graphite', 'cleanWhite', 'signal', 'gold']
  return (
    <span className="flex shrink-0 overflow-hidden border border-[var(--line-strong)]" aria-hidden>
      {keys.map((k) => (
        <span key={k} className="size-4" style={{ background: preset[k] ?? TOKEN_BY_KEY.get(k)?.fallback ?? '#000' }} />
      ))}
    </span>
  )
}
