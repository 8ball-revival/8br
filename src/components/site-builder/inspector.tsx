'use client'

/**
 * The properties inspector.
 *
 * ── The point of the field kernel, realised here ─────────────────────────────────────────────────
 * Nothing in this file knows about any specific module. It walks the selected module's `fields` and
 * draws a control per descriptor — which is why adding a field to a module makes it editable with no
 * change here, and why a control can never offer a value the server would reject: both read the same
 * descriptor. The alternative, a hand-written inspector per module, is how a builder ends up with an
 * option that silently fails to save.
 *
 * ── Local echo while typing ──────────────────────────────────────────────────────────────────────
 * Text inputs keep their own state and push to the document on change, but they do NOT re-read the
 * document on every render. The canvas re-renders through the server after a save, and a controlled
 * input reading back from a document that is a save behind would jump the caret to the end of the
 * field mid-sentence.
 */

import { useState } from 'react'
import { ChevronDown, Info, RotateCcw, X } from 'lucide-react'

import { cn } from '@/lib/utils'
import { useEditor } from './editor-store'
import { getModule } from '@/lib/site-builder/registry'
import type { Field, FieldSet } from '@/lib/site-builder/fields'
import { BREAKPOINTS, type Breakpoint, type LayoutDocument } from '@/lib/site-builder/document'
import { isOverridden, resolveLayout } from '@/lib/site-builder/document'
import {
  findModule, findSection, setColumns, setLayout, updateModuleConfig, updateModuleStyle,
  updateModuleVisibility, updateSection,
} from '@/lib/site-builder/operations'
import { describeVisibility, impossibleCombinations } from '@/lib/site-builder/visibility'
import type { LayoutDocument as Doc } from '@/lib/site-builder/document'
import { MediaPicker } from './media-picker'
import { PlayerPicker } from './player-picker'
import { themeContrastPairs } from '@/lib/site-builder/contrast'
import { THEME_TOKENS } from '@/lib/site-builder/theme-tokens'

export function Inspector() {
  const editor = useEditor()
  const selection = editor.selection

  if (!selection) {
    return (
      <Empty
        title="Nothing selected"
        body="Click a module on the page to change its settings, or a section label to change the row it sits in."
      />
    )
  }

  return selection.kind === 'module'
    ? <ModuleInspector moduleId={selection.id} />
    : <SectionInspector sectionId={selection.id} />
}

// ── Module ──────────────────────────────────────────────────────────────────────────────────────

function ModuleInspector({ moduleId }: { moduleId: string }) {
  const editor = useEditor()
  const location = findModule(editor.document, moduleId)
  if (!location) return <Empty title="Module not found" body="It may have been removed. Select something else." />

  const def = getModule(location.module.type)
  if (!def) {
    return (
      <Empty
        title="Unknown module"
        body={`Nothing is registered as "${location.module.type}". Its settings cannot be shown, but the module has been kept and can still be moved or deleted.`}
      />
    )
  }

  const groups = groupFields(def.fields)
  const linked = location.module.reusableId

  return (
    <div className="flex flex-col gap-4">
      <header>
        <p className="eyebrow text-muted-foreground">{def.category}</p>
        <h2 className="font-display text-lg font-black uppercase tracking-tight text-foreground">{def.name}</h2>
        <p className="mt-1 text-xs text-muted-foreground">{def.description}</p>
      </header>

      {/*
        A linked module says so BEFORE it is edited, not after.

        Changing one here changes it on every page that carries it, and finding that out afterwards
        is the worst possible moment. Detaching turns this instance into an ordinary copy that stops
        following the saved one — which is what somebody usually wants when they came here to change
        one page.
      */}
      {linked && (
        <div className="border border-[var(--brcam-teal)] p-2.5">
          <p className="eyebrow text-[var(--brcam-teal)]">Linked module</p>
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
            This follows a saved module. Editing it here changes it everywhere it appears.
          </p>
          <button
            type="button"
            onClick={() => editor.apply((d) => detachModule(d, moduleId), { structural: true })}
            className="mt-2 border border-border px-2 py-1 text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground hover:border-[var(--hot-red)] hover:text-foreground"
          >
            Detach this copy
          </button>
        </div>
      )}

      {def.essential && (
        <p className="border-l-2 border-[var(--gold)] pl-2 text-[11px] text-[var(--gold)]">
          Essential to this page. {def.essential}
        </p>
      )}

      {location.module.type === 'global.theme' && <ThemeContrastReport config={location.module.config} />}

      {groups.map(({ group, entries }) => (
        <Group key={group ?? 'general'} title={group ?? 'Settings'} defaultOpen>
          {entries.map(([key, field]) => (
            <FieldControl
              key={key}
              name={key}
              field={field}
              value={location.module.config[key]}
              siblings={location.module.config}
              onChange={(v) => editor.apply((d) => updateModuleConfig(d, moduleId, { [key]: v }), { structural: true })}
            />
          ))}
        </Group>
      ))}

      <Group title="Size & placement" defaultOpen={false}>
        <ResponsiveLayoutControls moduleId={moduleId} />
      </Group>

      <Group title="Appearance" defaultOpen={false}>
        <StyleControls
          style={location.module.style}
          onChange={(patch) => editor.apply((d) => updateModuleStyle(d, moduleId, patch), { structural: true })}
        />
      </Group>

      <Group title="Visibility" defaultOpen={false}>
        <VisibilityControls
          rule={location.module.visibility}
          onChange={(patch) => editor.apply((d) => updateModuleVisibility(d, moduleId, patch), { structural: true })}
        />
      </Group>
    </div>
  )
}

/**
 * What the theme you are typing does to legibility, as you type it.
 *
 * ── Why it is here and not a check at publish time ───────────────────────────────────────────────
 * A contrast warning is only useful while the colour is still being chosen. Told at publish time,
 * the answer is "go back and pick a different colour", which is the same work again — and by then
 * the palette has usually been decided around the colour that fails.
 *
 * ── Why unset tokens are resolved to the built-in value ──────────────────────────────────────────
 * A theme that overrides two colours still renders against the other eight. Checking only what was
 * typed would report nothing at all for the most common case, which is one accent changed against a
 * background nobody touched.
 *
 * The ratio is reported, never enforced. An accent that never carries text is allowed to fail, and
 * the row says which pairing it is so that judgement can be made.
 */
function ThemeContrastReport({ config }: { config: Record<string, unknown> }) {
  const resolve = (key: string): string => {
    const set = config[key]
    if (typeof set === 'string' && set.trim()) return set.trim()
    return THEME_TOKENS.find((t) => t.key === key)?.fallback ?? '#000000'
  }
  const pairs = themeContrastPairs(resolve)
  const failing = pairs.filter((p) => p.level === 'fail')

  return (
    <Group title="Contrast" defaultOpen>
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        {failing.length === 0
          ? 'Every pairing the site actually renders passes WCAG AA.'
          : `${failing.length} pairing${failing.length === 1 ? '' : 's'} below WCAG AA. Nothing stops you publishing — but that text will be hard to read.`}
      </p>
      <ul className="flex flex-col gap-px border border-border bg-border">
        {pairs.map((p, i) => (
          <li key={i} className="flex items-center gap-2 bg-[var(--graphite)] px-2 py-1.5">
            <span
              aria-hidden
              className="size-4 shrink-0 border border-[var(--line-strong)]"
              style={{ background: p.ratio === null ? 'transparent' : resolve(pairKey(p)) }}
            />
            <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
              <span className="text-foreground">{p.label}</span> on {p.on}
              {p.large && <span className="text-muted-foreground"> (headings)</span>}
            </span>
            <span className="tabular shrink-0 text-[11px] text-muted-foreground">
              {p.ratio === null ? '—' : `${p.ratio.toFixed(1)}:1`}
            </span>
            <span
              className={cn(
                'shrink-0 border px-1 text-[9px] font-bold uppercase tracking-[0.08em]',
                p.level === 'fail'
                  ? 'border-[var(--hot-red)] text-[var(--hot-red)]'
                  : p.level === 'AA Large'
                    ? 'border-[var(--gold)] text-[var(--gold)]'
                    : 'border-[var(--line-strong)] text-muted-foreground',
              )}
            >
              {p.level ?? '—'}
            </span>
          </li>
        ))}
      </ul>
      <p className="text-[10px] leading-relaxed text-muted-foreground">
        AA is 4.5:1 for body text and 3:1 for headings. Visitors keep their own Display Lab settings
        on top of this, and the admin interface is unaffected by whatever you publish here.
      </p>
    </Group>
  )
}

/** Which token's colour to show in a row's swatch — the thing being read, not the surface. */
function pairKey(p: { label: string }): string {
  switch (p.label) {
    case 'Muted text': return 'muted'
    case 'Accent': return 'accent'
    case 'Gold': return 'gold'
    case 'Highlight': return 'acid'
    default: return 'foreground'
  }
}

// ── Section ─────────────────────────────────────────────────────────────────────────────────────

function SectionInspector({ sectionId }: { sectionId: string }) {
  const editor = useEditor()
  const found = findSection(editor.document, sectionId)
  if (!found) return <Empty title="Section not found" body="It may have been removed." />
  const { section } = found

  return (
    <div className="flex flex-col gap-4">
      <header>
        <p className="eyebrow text-muted-foreground">Section</p>
        <h2 className="font-display text-lg font-black uppercase tracking-tight text-foreground">{section.name}</h2>
      </header>

      <Group title="Section" defaultOpen>
        <Labelled label="Name" help="Shown in the editor only. It is not published.">
          <TextInput
            value={section.name}
            onChange={(v) => editor.apply((d) => updateSection(d, sectionId, { name: v }))}
          />
        </Labelled>
        <Labelled label="Width">
          <Select
            value={section.width}
            options={[
              { value: 'wide', label: 'Site width (aligns with the header)' },
              { value: 'full', label: 'Full bleed' },
              { value: 'narrow', label: 'Narrow' },
            ]}
            onChange={(v) => editor.apply((d) => updateSection(d, sectionId, { width: v as typeof section.width }))}
          />
        </Labelled>
      </Group>

      <Group title="Columns" defaultOpen>
        <ColumnControls sectionId={sectionId} />
      </Group>

      <Group title="Appearance" defaultOpen={false}>
        <StyleControls
          style={section.style}
          onChange={(patch) => editor.apply((d) => updateSection(d, sectionId, { style: { ...section.style, ...patch } }))}
        />
      </Group>

      <Group title="Visibility" defaultOpen={false}>
        <VisibilityControls
          rule={section.visibility}
          onChange={(patch) => editor.apply((d) => updateSection(d, sectionId, { visibility: { ...section.visibility, ...patch } }))}
        />
      </Group>
    </div>
  )
}

// ── Field controls ──────────────────────────────────────────────────────────────────────────────

function groupFields(fields: FieldSet): { group: string | undefined; entries: [string, Field][] }[] {
  const map = new Map<string | undefined, [string, Field][]>()
  for (const [key, field] of Object.entries(fields)) {
    const list = map.get(field.group) ?? []
    list.push([key, field])
    map.set(field.group, list)
  }
  return [...map.entries()].map(([group, entries]) => ({ group, entries }))
}

function FieldControl({ name, field, value, siblings, onChange }: {
  name: string
  field: Field
  value: unknown
  siblings: Record<string, unknown>
  onChange: (v: unknown) => void
}) {
  // `showWhen` keeps a panel from presenting options that do nothing — a logo height beside a panel
  // that has no logo reads as a setting that is broken rather than one that is inapplicable.
  if (field.showWhen) {
    const other = siblings[field.showWhen.field]
    if (!field.showWhen.in.includes(other as string | number | boolean)) return null
  }

  switch (field.kind) {
    case 'text':
      return (
        <Labelled label={field.label} help={field.help}>
          {field.multiline
            ? <TextArea value={String(value ?? '')} onChange={onChange} placeholder={field.placeholder} />
            : <TextInput value={String(value ?? '')} onChange={onChange} placeholder={field.placeholder} />}
        </Labelled>
      )
    case 'richText':
      return (
        <Labelled label={field.label} help={field.help ?? 'Basic formatting only. Anything else is removed when saved.'}>
          <TextArea value={String(value ?? '')} onChange={onChange} rows={6} mono />
        </Labelled>
      )
    case 'number':
      return (
        <Labelled label={field.label} help={field.help}>
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={field.min ?? 0}
              max={field.max ?? 100}
              step={field.step ?? 1}
              value={Number(value ?? field.default)}
              onChange={(e) => onChange(Number(e.target.value))}
              className="h-1 flex-1 accent-[var(--hot-red)]"
            />
            <input
              type="number"
              min={field.min}
              max={field.max}
              value={Number(value ?? field.default)}
              onChange={(e) => onChange(Number(e.target.value))}
              className="w-16 border border-border bg-transparent px-1.5 py-1 text-xs text-foreground"
            />
            {field.unit && <span className="text-[10px] uppercase text-muted-foreground">{field.unit}</span>}
          </div>
        </Labelled>
      )
    case 'boolean':
      return (
        <label className="flex items-start gap-2 py-1">
          <input
            type="checkbox"
            checked={Boolean(value)}
            onChange={(e) => onChange(e.target.checked)}
            className="mt-0.5 size-4 accent-[var(--hot-red)]"
          />
          <span>
            <span className="text-xs font-semibold text-foreground">{field.label}</span>
            {field.help && <span className="block text-[11px] text-muted-foreground">{field.help}</span>}
          </span>
        </label>
      )
    case 'select':
      return (
        <Labelled label={field.label} help={field.help}>
          <Select value={String(value ?? field.default)} options={field.options} onChange={onChange} />
        </Labelled>
      )
    case 'multiSelect':
      return (
        <Labelled label={field.label} help={field.help}>
          <div className="flex flex-wrap gap-1">
            {field.options.map((o) => {
              const list = Array.isArray(value) ? value as string[] : []
              const on = list.includes(o.value)
              return (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => onChange(on ? list.filter((v) => v !== o.value) : [...list, o.value])}
                  className={cn(
                    'border px-2 py-1 text-[10px] font-bold uppercase tracking-[0.1em]',
                    on ? 'border-[var(--hot-red)] text-foreground' : 'border-border text-muted-foreground',
                  )}
                >
                  {o.label}
                </button>
              )
            })}
          </div>
        </Labelled>
      )
    case 'color':
      return (
        <Labelled label={field.label} help={field.help}>
          {/*
            `allowEmpty` on every colour field, because every colour field means it.

            A colour whose default is empty is one the site fills in itself, and without a way back
            to empty the only route to "use the built-in" is deleting the text by hand — which most
            people do not realise is allowed. The placeholder names the value that will be used
            instead of a generic example, so an unset field says what unset actually means.
          */}
          <ColorControl
            value={String(value ?? field.default)}
            onChange={onChange}
            allowEmpty={field.default === ''}
            placeholder={THEME_TOKENS.find((t) => t.label === field.label)?.fallback}
          />
        </Labelled>
      )
    case 'media':
      return (
        <Labelled label={field.label} help={field.help}>
          <MediaPicker value={value as number | null} onChange={onChange} />
        </Labelled>
      )
    case 'player':
      return (
        <Labelled label={field.label} help={field.help}>
          <PlayerPicker value={String(value ?? '')} onChange={onChange} />
        </Labelled>
      )
    case 'url':
      return (
        <Labelled label={field.label} help={field.help ?? (field.internalOnly ? 'A path on this site, such as /seasons.' : 'A path on this site, or a full https:// address.')}>
          <TextInput value={String(value ?? '')} onChange={onChange} placeholder={field.internalOnly ? '/seasons' : 'https://…'} />
        </Labelled>
      )
    case 'list':
      return <ListControl name={name} field={field} value={Array.isArray(value) ? value : []} onChange={onChange} />
  }
}

/**
 * A repeating group of fields.
 *
 * Items can be added, removed and reordered. Reordering is buttons rather than drag: the inspector
 * is a narrow column that is itself inside a scrolling panel, and dragging inside it fights the
 * scroll on exactly the devices where it is hardest to recover from.
 */
function ListControl({ name, field, value, onChange }: {
  name: string
  field: Extract<Field, { kind: 'list' }>
  value: unknown[]
  onChange: (v: unknown[]) => void
}) {
  const [open, setOpen] = useState<number | null>(0)
  const label = field.itemLabel ?? 'Item'

  const update = (index: number, key: string, v: unknown) => {
    const next = value.map((item, i) => (i === index ? { ...(item as object), [key]: v } : item))
    onChange(next)
  }
  const move = (index: number, delta: -1 | 1) => {
    const target = index + delta
    if (target < 0 || target >= value.length) return
    const next = [...value]
    ;[next[index], next[target]] = [next[target], next[index]]
    onChange(next)
    setOpen(target)
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="eyebrow text-muted-foreground">{field.label}</p>
      {value.map((item, i) => (
        <div key={i} className="border border-border">
          <div className="flex items-center justify-between gap-1 bg-[var(--graphite)] px-2 py-1.5">
            <button
              type="button"
              onClick={() => setOpen(open === i ? null : i)}
              className="flex flex-1 items-center gap-1 text-left text-[11px] font-bold uppercase tracking-[0.1em] text-foreground"
            >
              <ChevronDown className={cn('size-3 transition-transform', open === i && 'rotate-180')} aria-hidden />
              {label} {i + 1}
            </button>
            <button type="button" onClick={() => move(i, -1)} aria-label={`Move ${label} ${i + 1} up`} className="px-1 text-muted-foreground hover:text-foreground">↑</button>
            <button type="button" onClick={() => move(i, 1)} aria-label={`Move ${label} ${i + 1} down`} className="px-1 text-muted-foreground hover:text-foreground">↓</button>
            <button
              type="button"
              onClick={() => onChange(value.filter((_, j) => j !== i))}
              aria-label={`Remove ${label} ${i + 1}`}
              className="px-1 text-muted-foreground hover:text-[var(--hot-red)]"
            >
              <X className="size-3" aria-hidden />
            </button>
          </div>
          {open === i && (
            <div className="flex flex-col gap-2 p-2">
              {Object.entries(field.of).map(([key, sub]) => (
                <FieldControl
                  key={key}
                  name={`${name}.${i}.${key}`}
                  field={sub}
                  value={(item as Record<string, unknown>)?.[key]}
                  siblings={(item as Record<string, unknown>) ?? {}}
                  onChange={(v) => update(i, key, v)}
                />
              ))}
            </div>
          )}
        </div>
      ))}
      {(field.max === undefined || value.length < field.max) && (
        <button
          type="button"
          onClick={() => {
            const blank: Record<string, unknown> = {}
            for (const [key, sub] of Object.entries(field.of)) blank[key] = sub.default
            onChange([...value, blank])
            setOpen(value.length)
          }}
          className="border border-dashed border-border px-2 py-1.5 text-[11px] font-bold uppercase tracking-[0.1em] text-muted-foreground hover:border-[var(--hot-red)] hover:text-foreground"
        >
          Add {label.toLowerCase()}
        </button>
      )}
    </div>
  )
}

// ── Layout, style and visibility ────────────────────────────────────────────────────────────────

function ResponsiveLayoutControls({ moduleId }: { moduleId: string }) {
  const editor = useEditor()
  const location = findModule(editor.document, moduleId)
  if (!location) return null
  const bp = editor.breakpoint
  const resolved = resolveLayout(location.module.layout, bp)
  const overridden = isOverridden(location.module.layout, bp, 'span')

  return (
    <div className="flex flex-col gap-3">
      <BreakpointTabs />
      <div className="flex items-center justify-between">
        <p className="text-[11px] text-muted-foreground">
          {bp === 'desktop'
            ? 'Desktop is the base. Tablet and mobile follow it unless you change them here.'
            : overridden
              ? `Set for ${bp} only.`
              : `Inherited from ${bp === 'mobile' ? 'tablet or desktop' : 'desktop'}.`}
        </p>
        {bp !== 'desktop' && overridden && (
          <button
            type="button"
            onClick={() => editor.apply((d) => setLayout(d, moduleId, bp, 'span', undefined))}
            className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground hover:text-foreground"
          >
            <RotateCcw className="size-3" aria-hidden /> Reset
          </button>
        )}
      </div>
      <Labelled label="Columns spanned">
        <div className="flex items-center gap-2">
          <input
            type="range"
            min={1}
            max={bp === 'desktop' ? 12 : bp === 'tablet' ? 8 : 4}
            value={resolved.span ?? 1}
            onChange={(e) => editor.apply((d) => setLayout(d, moduleId, bp, 'span', Number(e.target.value)))}
            className="h-1 flex-1 accent-[var(--hot-red)]"
          />
          <span className="tabular w-8 text-xs text-foreground">{resolved.span ?? 1}</span>
        </div>
      </Labelled>
      <Labelled label="Minimum height" help="Zero lets the module take its natural height.">
        <div className="flex items-center gap-2">
          <input
            type="range" min={0} max={200}
            value={resolved.minHeight ?? 0}
            onChange={(e) => editor.apply((d) => setLayout(d, moduleId, bp, 'minHeight', Number(e.target.value)))}
            className="h-1 flex-1 accent-[var(--hot-red)]"
          />
          <span className="tabular w-8 text-xs text-foreground">{resolved.minHeight ?? 0}</span>
        </div>
      </Labelled>
    </div>
  )
}

function ColumnControls({ sectionId }: { sectionId: string }) {
  const editor = useEditor()
  const found = findSection(editor.document, sectionId)
  if (!found) return null
  const bp = editor.breakpoint
  const current = found.section.columns[bp] ?? found.section.columns.desktop
  const overridden = bp !== 'desktop' && found.section.columns[bp] !== undefined

  const presets: { label: string; ratios: number[] }[] = [
    { label: '1', ratios: [1] },
    { label: '50 / 50', ratios: [50, 50] },
    { label: '58 / 42', ratios: [58, 42] },
    { label: '55 / 45', ratios: [55, 45] },
    { label: '2 / 1', ratios: [2, 1] },
    { label: '1 / 2', ratios: [1, 2] },
    { label: '3 equal', ratios: [1, 1, 1] },
    { label: '4 equal', ratios: [1, 1, 1, 1] },
  ]

  return (
    <div className="flex flex-col gap-3">
      <BreakpointTabs />
      <div className="flex flex-wrap gap-1">
        {presets.map((p) => {
          const active = current.length === p.ratios.length && current.every((n, i) => n === p.ratios[i])
          return (
            <button
              key={p.label}
              type="button"
              onClick={() => editor.apply((d) => setColumns(d, sectionId, bp, p.ratios))}
              className={cn(
                'border px-2 py-1 text-[10px] font-bold uppercase tracking-[0.1em]',
                active ? 'border-[var(--hot-red)] text-foreground' : 'border-border text-muted-foreground hover:text-foreground',
              )}
            >
              {p.label}
            </button>
          )
        })}
      </div>
      {bp !== 'desktop' && (
        <p className="text-[11px] text-muted-foreground">
          {overridden ? `Set for ${bp} only.` : `Inherited from desktop. Choosing a ratio here overrides it.`}
          {overridden && (
            <button
              type="button"
              onClick={() => editor.apply((d) => setColumns(d, sectionId, bp, undefined))}
              className="ml-2 underline underline-offset-2 hover:text-foreground"
            >
              Reset to inherited
            </button>
          )}
        </p>
      )}
    </div>
  )
}

function BreakpointTabs() {
  const editor = useEditor()
  return (
    <div role="tablist" aria-label="Breakpoint" className="flex border border-border">
      {BREAKPOINTS.map((b) => (
        <button
          key={b}
          role="tab"
          aria-selected={editor.breakpoint === b}
          onClick={() => editor.setBreakpoint(b)}
          className={cn(
            'flex-1 px-2 py-1 text-[10px] font-bold uppercase tracking-[0.1em] transition',
            editor.breakpoint === b ? 'bg-[var(--hot-red)] text-white' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {b}
        </button>
      ))}
    </div>
  )
}

function StyleControls({ style, onChange }: {
  style: import('@/lib/site-builder/document').StyleOverrides
  onChange: (patch: import('@/lib/site-builder/document').StyleOverrides) => void
}) {
  return (
    <div className="flex flex-col gap-3">
      <StepSlider label="Padding across" value={style.paddingX} onChange={(v) => onChange({ paddingX: v })} />
      <StepSlider label="Padding down" value={style.paddingY} onChange={(v) => onChange({ paddingY: v })} />
      <StepSlider label="Gap" value={style.gap} onChange={(v) => onChange({ gap: v })} />
      <Labelled label="Border">
        <Select
          value={style.border ?? 'none'}
          options={[{ value: 'none', label: 'None' }, { value: 'thin', label: 'Thin' }, { value: 'strong', label: 'Strong' }, { value: 'accent', label: 'Accent' }]}
          onChange={(v) => onChange({ border: v as never })}
        />
      </Labelled>
      <Labelled label="Corners">
        <Select
          value={style.radius ?? 'none'}
          options={[{ value: 'none', label: 'Square' }, { value: 'clip', label: 'Clipped (site style)' }, { value: 'sm', label: 'Slightly rounded' }, { value: 'md', label: 'Rounded' }]}
          onChange={(v) => onChange({ radius: v as never })}
        />
      </Labelled>
      <Labelled label="Depth">
        <Select
          value={style.shadow ?? 'none'}
          options={[{ value: 'none', label: 'Flat' }, { value: 'soft', label: 'Soft shadow' }, { value: 'glow', label: 'Glow' }]}
          onChange={(v) => onChange({ shadow: v as never })}
        />
      </Labelled>
      <Labelled label="Text alignment">
        <Select
          value={style.textAlign ?? 'left'}
          options={[{ value: 'left', label: 'Left' }, { value: 'center', label: 'Centre' }, { value: 'right', label: 'Right' }]}
          onChange={(v) => onChange({ textAlign: v as never })}
        />
      </Labelled>
      <Labelled label="Background" help="A site token keeps this in step with the theme. A custom colour does not.">
        <ColorControl value={style.background ?? ''} onChange={(v) => onChange({ background: v as string })} allowEmpty />
      </Labelled>
    </div>
  )
}

function VisibilityControls({ rule, onChange }: {
  rule: import('@/lib/site-builder/document').VisibilityRule
  onChange: (patch: import('@/lib/site-builder/document').VisibilityRule) => void
}) {
  const warnings = impossibleCombinations(rule)
  return (
    <div className="flex flex-col gap-3">
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={!!rule.hidden} onChange={(e) => onChange({ hidden: e.target.checked })} className="size-4 accent-[var(--hot-red)]" />
        <span className="text-xs font-semibold text-foreground">Hide this temporarily</span>
      </label>

      <Labelled label="Hide on" help="Breakpoint visibility is applied with CSS, so it is exact at any width.">
        <div className="flex gap-1">
          {BREAKPOINTS.map((b) => {
            const on = rule.hideOn?.includes(b) ?? false
            return (
              <button
                key={b}
                type="button"
                onClick={() => {
                  const list = new Set(rule.hideOn ?? [])
                  if (on) list.delete(b); else list.add(b)
                  onChange({ hideOn: [...list] as Breakpoint[] })
                }}
                className={cn(
                  'flex-1 border px-2 py-1 text-[10px] font-bold uppercase tracking-[0.1em]',
                  on ? 'border-[var(--hot-red)] text-foreground' : 'border-border text-muted-foreground',
                )}
              >
                {b}
              </button>
            )
          })}
        </div>
      </Labelled>

      <ScheduleControl rule={rule} onChange={onChange} />

      <p className="border-l-2 border-[var(--line-strong)] pl-2 text-[11px] text-muted-foreground">
        {describeVisibility(rule)}
      </p>
      {warnings.map((w) => (
        <p key={w} className="border-l-2 border-[var(--gold)] pl-2 text-[11px] text-[var(--gold)]">{w}</p>
      ))}
    </div>
  )
}

/** The scheduling condition, given its own control because it is the one people actually reach for. */
function ScheduleControl({ rule, onChange }: {
  rule: import('@/lib/site-builder/document').VisibilityRule
  onChange: (patch: import('@/lib/site-builder/document').VisibilityRule) => void
}) {
  const window = rule.conditions?.find((c) => c.subject === 'dateWindow')
  const others = (rule.conditions ?? []).filter((c) => c.subject !== 'dateWindow')
  const set = (from?: string | null, to?: string | null) => {
    if (!from && !to) { onChange({ conditions: others }); return }
    onChange({ conditions: [...others, { subject: 'dateWindow', from: from ?? null, to: to ?? null }] })
  }
  const toLocal = (iso?: string | null) => (iso ? new Date(iso).toISOString().slice(0, 16) : '')

  return (
    <Labelled label="Show between" help="Leave either side empty for an open-ended window.">
      <div className="flex flex-col gap-1">
        <input
          type="datetime-local"
          value={toLocal(window?.from)}
          onChange={(e) => set(e.target.value ? new Date(e.target.value).toISOString() : null, window?.to)}
          className="border border-border bg-transparent px-2 py-1 text-xs text-foreground"
        />
        <input
          type="datetime-local"
          value={toLocal(window?.to)}
          onChange={(e) => set(window?.from, e.target.value ? new Date(e.target.value).toISOString() : null)}
          className="border border-border bg-transparent px-2 py-1 text-xs text-foreground"
        />
      </div>
    </Labelled>
  )
}

// ── Primitives ──────────────────────────────────────────────────────────────────────────────────

function Group({ title, defaultOpen = true, children }: { title: string; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section className="border border-border">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full items-center justify-between bg-[var(--graphite)] px-2.5 py-2 text-left"
      >
        <span className="eyebrow text-foreground">{title}</span>
        <ChevronDown className={cn('size-3.5 text-muted-foreground transition-transform', open && 'rotate-180')} aria-hidden />
      </button>
      {open && <div className="flex flex-col gap-3 p-2.5">{children}</div>}
    </section>
  )
}

function Labelled({ label, help, children }: { label: string; help?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">{label}</span>
      {children}
      {help && (
        <span className="flex items-start gap-1 text-[11px] leading-snug text-muted-foreground">
          <Info className="mt-px size-3 shrink-0" aria-hidden />
          {help}
        </span>
      )}
    </div>
  )
}

/**
 * A text input that echoes locally.
 *
 * It seeds from the document and then owns its value until the document changes underneath it for a
 * different reason (an undo, a revision restore). Without the local copy the caret jumps to the end
 * on every server re-render, which makes editing a sentence in the middle impossible.
 */
function TextInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const [local, setLocal] = useState(value)
  const [focused, setFocused] = useState(false)
  /*
    Adjusted during render rather than in an effect.

    The field owns its value while focused, so the caret does not jump to the end when the server
    re-renders the canvas mid-sentence. When it is NOT focused it must follow the document, which
    changes on undo, on a revision restore and on a replace. React's documented way to express that
    is to compare against the previous prop during render and set state there; an effect would run a
    frame later and flash the stale value.
  */
  const [lastValue, setLastValue] = useState(value)
  if (!focused && value !== lastValue) {
    setLastValue(value)
    setLocal(value)
  }
  return (
    <input
      type="text"
      value={local}
      placeholder={placeholder}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onChange={(e) => { setLocal(e.target.value); onChange(e.target.value) }}
      className="w-full border border-border bg-transparent px-2 py-1.5 text-xs text-foreground focus:border-[var(--hot-red)] focus:outline-none"
    />
  )
}

function TextArea({ value, onChange, rows = 3, mono, placeholder }: {
  value: string; onChange: (v: string) => void; rows?: number; mono?: boolean; placeholder?: string
}) {
  const [local, setLocal] = useState(value)
  const [focused, setFocused] = useState(false)
  // Same reasoning as TextInput above.
  const [lastValue, setLastValue] = useState(value)
  if (!focused && value !== lastValue) {
    setLastValue(value)
    setLocal(value)
  }
  return (
    <textarea
      value={local}
      rows={rows}
      placeholder={placeholder}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onChange={(e) => { setLocal(e.target.value); onChange(e.target.value) }}
      className={cn(
        'w-full resize-y border border-border bg-transparent px-2 py-1.5 text-xs text-foreground focus:border-[var(--hot-red)] focus:outline-none',
        mono && 'font-mono',
      )}
    />
  )
}

function Select({ value, options, onChange }: {
  value: string; options: { value: string; label: string }[]; onChange: (v: string) => void
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full border border-border bg-[var(--graphite)] px-2 py-1.5 text-xs text-foreground focus:border-[var(--hot-red)] focus:outline-none"
    >
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  )
}

function StepSlider({ label, value, onChange }: { label: string; value: number | undefined; onChange: (v: number) => void }) {
  return (
    <Labelled label={label}>
      <div className="flex items-center gap-2">
        <input
          type="range" min={0} max={10}
          value={value ?? 0}
          onChange={(e) => onChange(Number(e.target.value))}
          className="h-1 flex-1 accent-[var(--hot-red)]"
        />
        <span className="tabular w-6 text-xs text-foreground">{value ?? 0}</span>
      </div>
    </Labelled>
  )
}

/**
 * Colour: site tokens first, a custom value second.
 *
 * The tokens are offered as swatches because a colour chosen from the site's own palette stays
 * correct when the theme changes, and a hex does not. The custom field exists, but it is the
 * secondary path rather than the default one.
 */
const TOKEN_SWATCHES = [
  { value: 'var(--graphite)', label: 'Graphite' },
  { value: 'var(--card)', label: 'Card' },
  { value: 'var(--hot-red)', label: 'Red' },
  { value: 'var(--gold)', label: 'Gold' },
  { value: 'var(--acid)', label: 'Acid' },
  { value: 'var(--brcam-teal)', label: 'Teal' },
]

function ColorControl({ value, onChange, allowEmpty, placeholder }: {
  value: string
  onChange: (v: string) => void
  allowEmpty?: boolean
  /** The colour that will be used when this is left empty, so the field can say so. */
  placeholder?: string
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap gap-1">
        {allowEmpty && (
          <button
            type="button"
            onClick={() => onChange('')}
            className={cn('border px-2 py-1 text-[10px] uppercase', value === '' ? 'border-[var(--hot-red)] text-foreground' : 'border-border text-muted-foreground')}
          >
            None
          </button>
        )}
        {TOKEN_SWATCHES.map((t) => (
          <button
            key={t.value}
            type="button"
            title={t.label}
            aria-label={t.label}
            onClick={() => onChange(t.value)}
            className={cn('size-6 border', value === t.value ? 'border-[var(--hot-red)] ring-1 ring-[var(--hot-red)]' : 'border-border')}
            style={{ background: t.value }}
          />
        ))}
      </div>
      <input
        type="text"
        value={value}
        placeholder={placeholder ? `${placeholder} (built in)` : '#101418'}
        onChange={(e) => onChange(e.target.value)}
        className="w-full border border-border bg-transparent px-2 py-1 font-mono text-[11px] text-foreground placeholder:text-muted-foreground focus:border-[var(--hot-red)] focus:outline-none"
      />
    </div>
  )
}

function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex flex-col gap-1 border border-dashed border-border p-4">
      <p className="eyebrow text-foreground">{title}</p>
      <p className="text-xs leading-relaxed text-muted-foreground">{body}</p>
    </div>
  )
}

export type { LayoutDocument }


/**
 * Turn a linked instance into an ordinary copy.
 *
 * Only the link is removed; the settings stay exactly as they were, so the page looks identical the
 * moment after detaching and only stops CHANGING with the saved module.
 */
function detachModule(doc: Doc, moduleId: string): Doc {
  const next = structuredClone(doc)
  const found = findModule(next, moduleId)
  if (!found) return doc
  found.module.reusableId = null
  return next
}
