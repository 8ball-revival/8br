/**
 * Layout modules: the ones that hold other modules.
 *
 * ── What a container does, and what it does not ──────────────────────────────────────────────────
 * A container decides ARRANGEMENT and nothing else. It receives a `Slot` from the renderer and says
 * where its children go; the renderer handles which children exist, whether each is visible, and
 * what happens when one fails. That split is why a bad module inside a set of tabs costs that
 * module rather than the tabs, and why nesting works the same at every depth without any container
 * knowing how deep it is.
 *
 * ── Why the class strings are written out ────────────────────────────────────────────────────────
 * Tailwind compiles the classes it can SEE. `gap-${n}` is invisible to it and produces a class that
 * exists in the markup and nowhere in the stylesheet — a layout that is perfect in development and
 * silently loses its spacing in a production build. Every scale below is a literal array.
 */

import { registerModule, type ModuleRenderProps } from '@/lib/site-builder/registry'
import { cn } from '@/lib/utils'
import { Wide } from '@/components/primitives'
import { mediaUrl } from '@/lib/site-builder/media'
import { ModulePlaceholder } from './content'

const GAP = ['gap-0', 'gap-1', 'gap-2', 'gap-3', 'gap-4', 'gap-5', 'gap-6', 'gap-8', 'gap-10', 'gap-12', 'gap-16'] as const
const PAD = ['p-0', 'p-1', 'p-2', 'p-3', 'p-4', 'p-5', 'p-6', 'p-8', 'p-10', 'p-12', 'p-16'] as const
const step = (table: readonly string[], v: number) => table[Math.min(table.length - 1, Math.max(0, Math.round(v)))]

const ALIGN = { start: 'items-start', center: 'items-center', end: 'items-end', stretch: 'items-stretch' } as const
const JUSTIFY = { start: 'justify-start', center: 'justify-center', end: 'justify-end', between: 'justify-between', around: 'justify-around' } as const

const ALIGN_OPTIONS = [
  { value: 'stretch', label: 'Stretch' }, { value: 'start', label: 'Top' },
  { value: 'center', label: 'Middle' }, { value: 'end', label: 'Bottom' },
]
const JUSTIFY_OPTIONS = [
  { value: 'start', label: 'Start' }, { value: 'center', label: 'Centre' }, { value: 'end', label: 'End' },
  { value: 'between', label: 'Space between' }, { value: 'around', label: 'Space around' },
]

// ── Stack ───────────────────────────────────────────────────────────────────────────────────────

registerModule({
  type: 'layout.stack',
  name: 'Stack',
  category: 'layout',
  icon: 'Rows3',
  description: 'Holds modules in a vertical column.',
  configVersion: 1,
  container: true,
  a11y: {},
  fields: {
    gap: { kind: 'number', label: 'Gap', default: 4, min: 0, max: 10, unit: 'steps' },
    padding: { kind: 'number', label: 'Padding', default: 0, min: 0, max: 10, unit: 'steps' },
    align: { kind: 'select', label: 'Align', default: 'stretch', options: ALIGN_OPTIONS },
  },
  Render: function StackModule({ config, Slot }: ModuleRenderProps<{ gap: number; padding: number; align: keyof typeof ALIGN }>) {
    if (!Slot) return null
    return (
      <div className={cn('flex flex-col', step(GAP, config.gap), step(PAD, config.padding), ALIGN[config.align] ?? ALIGN.stretch)}>
        <Slot />
      </div>
    )
  } as never,
})

// ── Cluster (a wrapping row) ────────────────────────────────────────────────────────────────────

registerModule({
  type: 'layout.cluster',
  name: 'Row',
  category: 'layout',
  icon: 'Columns3',
  description: 'Holds modules side by side, wrapping onto the next line when they run out of room.',
  configVersion: 1,
  container: true,
  a11y: {},
  fields: {
    gap: { kind: 'number', label: 'Gap', default: 3, min: 0, max: 10, unit: 'steps' },
    align: { kind: 'select', label: 'Vertical align', default: 'center', options: ALIGN_OPTIONS },
    justify: { kind: 'select', label: 'Horizontal', default: 'start', options: JUSTIFY_OPTIONS },
    wrap: { kind: 'boolean', label: 'Wrap onto more lines', default: true, help: 'Off keeps everything on one line, which can overflow on a phone.' },
  },
  Render: function ClusterModule({ config, Slot }: ModuleRenderProps<{
    gap: number; align: keyof typeof ALIGN; justify: keyof typeof JUSTIFY; wrap: boolean
  }>) {
    if (!Slot) return null
    return (
      <div className={cn('flex', config.wrap ? 'flex-wrap' : 'flex-nowrap', step(GAP, config.gap), ALIGN[config.align], JUSTIFY[config.justify])}>
        <Slot />
      </div>
    )
  } as never,
})

// ── Responsive grid ─────────────────────────────────────────────────────────────────────────────

const COLS_DESKTOP = ['', 'lg:grid-cols-1', 'lg:grid-cols-2', 'lg:grid-cols-3', 'lg:grid-cols-4', 'lg:grid-cols-5', 'lg:grid-cols-6'] as const
const COLS_TABLET = ['', 'md:grid-cols-1', 'md:grid-cols-2', 'md:grid-cols-3', 'md:grid-cols-4'] as const
const COLS_MOBILE = ['', 'grid-cols-1', 'grid-cols-2'] as const

registerModule({
  type: 'layout.grid',
  name: 'Grid',
  category: 'layout',
  icon: 'LayoutGrid',
  description: 'An even grid with its own column count per device.',
  configVersion: 1,
  container: true,
  a11y: {},
  fields: {
    desktop: { kind: 'number', label: 'Columns on desktop', default: 3, min: 1, max: 6 },
    tablet: { kind: 'number', label: 'Columns on tablet', default: 2, min: 1, max: 4 },
    mobile: { kind: 'number', label: 'Columns on mobile', default: 1, min: 1, max: 2 },
    gap: { kind: 'number', label: 'Gap', default: 4, min: 0, max: 10, unit: 'steps' },
  },
  Render: function GridModule({ config, Slot }: ModuleRenderProps<{ desktop: number; tablet: number; mobile: number; gap: number }>) {
    if (!Slot) return null
    return (
      <div className={cn('grid', COLS_MOBILE[config.mobile] ?? 'grid-cols-1', COLS_TABLET[config.tablet], COLS_DESKTOP[config.desktop], step(GAP, config.gap))}>
        <Slot />
      </div>
    )
  } as never,
})

// ── Columns with explicit ratios ────────────────────────────────────────────────────────────────

registerModule({
  type: 'layout.columns',
  name: 'Columns',
  category: 'layout',
  icon: 'Columns2',
  description: 'Two or three columns with proportions you choose. Collapses to one on a phone.',
  configVersion: 1,
  container: true,
  maxChildren: 3,
  a11y: {},
  fields: {
    ratio: {
      kind: 'select', label: 'Proportions', default: '58-42',
      help: 'The site already uses 58/42 and 55/45 — matching one keeps a new row looking like the rest.',
      options: [
        { value: '50-50', label: '50 / 50' }, { value: '58-42', label: '58 / 42' },
        { value: '42-58', label: '42 / 58' }, { value: '55-45', label: '55 / 45' },
        { value: '66-34', label: '2 / 1' }, { value: '34-66', label: '1 / 2' },
        { value: '33-33-33', label: 'Three equal' }, { value: '50-25-25', label: '2 / 1 / 1' },
      ],
    },
    gap: { kind: 'number', label: 'Gap', default: 4, min: 0, max: 10, unit: 'steps' },
    align: { kind: 'select', label: 'Align', default: 'stretch', options: ALIGN_OPTIONS },
    stackBelow: {
      kind: 'select', label: 'Stack below', default: 'lg',
      options: [{ value: 'md', label: 'Phones' }, { value: 'lg', label: 'Phones and tablets' }],
    },
  },
  Render: function ColumnsModule({ config, Slot }: ModuleRenderProps<{
    ratio: string; gap: number; align: keyof typeof ALIGN; stackBelow: string
  }>) {
    if (!Slot) return null
    const parts = config.ratio.split('-').map(Number).filter((n) => n > 0)
    const template = parts.map((n) => `minmax(0,${n}fr)`).join(' ')
    return (
      <div
        className={cn('sb-grid grid', step(GAP, config.gap), ALIGN[config.align])}
        style={{
          // The same custom-property mechanism the section grid uses, so an arbitrary ratio works
          // and the breakpoint still decides when to collapse.
          [config.stackBelow === 'md' ? '--sb-cols-tablet' : '--sb-cols-desktop']: template,
          '--sb-cols-desktop': template,
        } as React.CSSProperties}
      >
        <Slot />
      </div>
    )
  } as never,
})

// ── Split panel ─────────────────────────────────────────────────────────────────────────────────

registerModule({
  type: 'layout.split',
  name: 'Split panel',
  category: 'layout',
  icon: 'SplitSquareHorizontal',
  description: 'Two panels separated by a diagonal seam, like the competition marquee.',
  configVersion: 1,
  container: true,
  maxChildren: 2,
  a11y: {},
  layoutDefaults: { span: 12 },
  fields: {
    angle: { kind: 'number', label: 'Diagonal angle', default: 6, min: 0, max: 30, unit: '%', help: 'Zero is a straight vertical split.' },
    ratio: { kind: 'number', label: 'Left panel width', default: 50, min: 20, max: 80, unit: '%' },
    minHeight: { kind: 'number', label: 'Minimum height', default: 320, min: 120, max: 900, unit: 'px' },
    leftBackground: { kind: 'color', label: 'Left background', default: 'var(--graphite)' },
    rightBackground: { kind: 'color', label: 'Right background', default: 'var(--card)' },
  },
  Render: function SplitModule({ config, Slot }: ModuleRenderProps<{
    angle: number; ratio: number; minHeight: number; leftBackground: string; rightBackground: string
  }>) {
    if (!Slot) return null
    const lean = config.angle
    const seam = config.ratio
    // Each panel clears the seam at its WORST point, not its average — content anywhere past the
    // leaning edge sits inside the clipped region for part of its height and vanishes.
    const leftClip = `polygon(0 0, ${seam + lean}% 0, ${seam - lean}% 100%, 0 100%)`
    const rightClip = `polygon(${seam + lean}% 0, 100% 0, 100% 100%, ${seam - lean}% 100%)`
    return (
      <section className="sb-split cyber-clip relative isolate w-full overflow-hidden border border-[var(--line-strong)]" style={{ minHeight: `${config.minHeight}px` }}>
        <div className="sb-split-stage grid">
          <div
            className="sb-split-panel flex flex-col justify-center"
            style={{ clipPath: leftClip, background: config.leftBackground, paddingRight: `${100 - seam + lean}%` }}
          >
            <Slot index={0} />
          </div>
          <div
            className="sb-split-panel flex flex-col justify-center"
            style={{ clipPath: rightClip, background: config.rightBackground, paddingLeft: `${seam + lean}%` }}
          >
            <Slot index={1} />
          </div>
        </div>
      </section>
    )
  } as never,
})

// ── Container / breakout ────────────────────────────────────────────────────────────────────────

registerModule({
  type: 'layout.container',
  name: 'Container',
  category: 'layout',
  icon: 'Square',
  description: 'A frame with its own width, padding, background and border.',
  configVersion: 1,
  container: true,
  a11y: {},
  fields: {
    width: {
      kind: 'select', label: 'Width', default: 'inherit',
      options: [
        { value: 'inherit', label: 'As placed' },
        { value: 'site', label: 'Site width (aligns with the header)' },
        { value: 'narrow', label: 'Narrow (reading width)' },
        { value: 'full', label: 'Full bleed' },
      ],
    },
    padding: { kind: 'number', label: 'Padding', default: 4, min: 0, max: 10, unit: 'steps' },
    background: { kind: 'color', label: 'Background', default: '' },
    border: { kind: 'select', label: 'Border', default: 'none', options: [{ value: 'none', label: 'None' }, { value: 'thin', label: 'Thin' }, { value: 'strong', label: 'Strong' }, { value: 'accent', label: 'Accent' }] },
    clip: { kind: 'boolean', label: 'Clipped corners', default: false, help: 'The site’s cut-corner treatment.' },
  },
  Render: function ContainerModule({ config, Slot }: ModuleRenderProps<{
    width: string; padding: number; background: string; border: string; clip: boolean
  }>) {
    if (!Slot) return null
    const border = { none: '', thin: 'border border-border', strong: 'border border-[var(--line-strong)]', accent: 'border border-[var(--hot-red)]' }[config.border] ?? ''
    const inner = (
      <div
        className={cn(step(PAD, config.padding), border, config.clip && 'cyber-clip', config.background && 'dl-surface')}
        style={config.background ? { background: config.background } : undefined}
      >
        <Slot />
      </div>
    )
    if (config.width === 'site') return <Wide>{inner}</Wide>
    if (config.width === 'narrow') return <div className="mx-auto w-full max-w-3xl">{inner}</div>
    if (config.width === 'full') return <div className="w-full">{inner}</div>
    return inner
  } as never,
})

// ── Card grid ───────────────────────────────────────────────────────────────────────────────────

registerModule({
  type: 'layout.cardGrid',
  name: 'Card grid',
  category: 'layout',
  icon: 'LayoutPanelTop',
  description: 'An auto-fitting grid of equal cards.',
  configVersion: 1,
  container: true,
  a11y: {},
  fields: {
    minWidth: { kind: 'number', label: 'Minimum card width', default: 260, min: 140, max: 480, unit: 'px', help: 'Cards fit as many per row as this allows, so it needs no column count.' },
    gap: { kind: 'number', label: 'Gap', default: 4, min: 0, max: 10, unit: 'steps' },
  },
  Render: function CardGridModule({ config, Slot }: ModuleRenderProps<{ minWidth: number; gap: number }>) {
    if (!Slot) return null
    return (
      <div
        className={cn('grid', step(GAP, config.gap))}
        style={{ gridTemplateColumns: `repeat(auto-fit, minmax(min(${config.minWidth}px, 100%), 1fr))` }}
      >
        <Slot />
      </div>
    )
  } as never,
})

// ── Sticky rail ─────────────────────────────────────────────────────────────────────────────────

registerModule({
  type: 'layout.sticky',
  name: 'Sticky region',
  category: 'layout',
  icon: 'Pin',
  description: 'Stays in view as the page scrolls past it. Only on screens tall enough for it.',
  configVersion: 1,
  container: true,
  a11y: {},
  fields: {
    offset: { kind: 'number', label: 'Distance from the top', default: 16, min: 0, max: 200, unit: 'px' },
  },
  Render: function StickyModule({ config, Slot }: ModuleRenderProps<{ offset: number }>) {
    if (!Slot) return null
    // Sticky only above the large breakpoint: on a phone a sticky column covers the content it is
    // meant to sit beside, and there is no room for both.
    return (
      <div className="lg:sticky" style={{ top: `${config.offset}px` }}>
        <Slot />
      </div>
    )
  } as never,
})

// ── Background layer ────────────────────────────────────────────────────────────────────────────

registerModule({
  type: 'layout.background',
  name: 'Background layer',
  category: 'layout',
  icon: 'Image',
  description: 'Puts an image or colour behind whatever you place inside it.',
  configVersion: 1,
  container: true,
  a11y: {},
  fields: {
    mediaId: { kind: 'media', label: 'Image', default: null },
    colour: { kind: 'color', label: 'Colour behind the image', default: 'var(--graphite)' },
    overlay: { kind: 'number', label: 'Darken', default: 40, min: 0, max: 90, unit: '%', help: 'Text over a photograph needs this to stay readable.' },
    position: {
      kind: 'select', label: 'Focus', default: 'center',
      options: [{ value: 'center', label: 'Centre' }, { value: 'top', label: 'Top' }, { value: 'bottom', label: 'Bottom' }],
    },
    minHeight: { kind: 'number', label: 'Minimum height', default: 280, min: 80, max: 900, unit: 'px' },
    padding: { kind: 'number', label: 'Padding', default: 6, min: 0, max: 10, unit: 'steps' },
  },
  Render: async function BackgroundModule({ config, Slot }: ModuleRenderProps<{
    mediaId: number | null; colour: string; overlay: number; position: string; minHeight: number; padding: number
  }>) {
    if (!Slot) return null
    const media = await mediaUrl(config.mediaId)
    return (
      <div
        className={cn('relative isolate overflow-hidden', step(PAD, config.padding))}
        style={{
          minHeight: `${config.minHeight}px`,
          background: config.colour,
          ...(media ? {
            backgroundImage: `url(${JSON.stringify(media.url)})`,
            backgroundSize: 'cover',
            backgroundPosition: config.position,
          } : {}),
        }}
      >
        {config.overlay > 0 && (
          <span aria-hidden className="pointer-events-none absolute inset-0" style={{ background: `rgba(0,0,0,${config.overlay / 100})` }} />
        )}
        <div className="relative">
          <Slot />
        </div>
      </div>
    )
  } as never,
})

// ── Tabs ────────────────────────────────────────────────────────────────────────────────────────

registerModule({
  type: 'layout.tabs',
  name: 'Tabs',
  category: 'layout',
  icon: 'PanelTop',
  description: 'One panel visible at a time. Each child is a tab.',
  configVersion: 1,
  container: true,
  maxChildren: 6,
  a11y: { requiresLabel: true },
  fields: {
    labels: {
      kind: 'list', label: 'Tab labels', itemLabel: 'Tab', max: 6,
      default: [{ label: 'One' }, { label: 'Two' }],
      of: { label: { kind: 'text', label: 'Label', default: 'Tab', maxLength: 40 } },
    },
    heading: { kind: 'text', label: 'Accessible name', default: 'Tabbed content', maxLength: 80, help: 'Not shown; announced to screen readers so the group is not unlabelled.' },
  },
  Render: function TabsModule({ config, instance, Slot }: ModuleRenderProps<{ labels: { label: string }[]; heading: string }>) {
    if (!Slot) return null
    const count = instance.children?.length ?? 0
    if (!count) return <ModulePlaceholder label="Tabs" hint="Add modules inside this — each one becomes a tab." />
    /*
      Radio inputs and CSS, not JavaScript.

      Tabs on a server-rendered page do not need a client component: a radio group with sibling
      selectors switches panels with no script at all, which means the tabs work before hydration and
      keep working if it never happens. Keyboard support comes free with radios.
    */
    return (
      <section className="sb-tabs" aria-label={config.heading}>
        <div className="flex flex-wrap gap-px border-b border-border" role="tablist">
          {Array.from({ length: count }, (_, i) => (
            <label key={i} className="sb-tab-label cursor-pointer px-3 py-2 text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
              <input type="radio" name={`tabs-${instance.id}`} defaultChecked={i === 0} className="sr-only" />
              {config.labels[i]?.label || `Tab ${i + 1}`}
            </label>
          ))}
        </div>
        <div className="sb-tab-panels pt-4">
          {Array.from({ length: count }, (_, i) => (
            <div key={i} className="sb-tab-panel">
              <Slot index={i} />
            </div>
          ))}
        </div>
      </section>
    )
  } as never,
})

// ── Accordion ───────────────────────────────────────────────────────────────────────────────────

registerModule({
  type: 'layout.accordion',
  name: 'Accordion',
  category: 'layout',
  icon: 'ChevronsUpDown',
  description: 'Collapsible sections. Each child is one panel.',
  configVersion: 1,
  container: true,
  maxChildren: 12,
  a11y: {},
  fields: {
    labels: {
      kind: 'list', label: 'Panel titles', itemLabel: 'Panel', max: 12,
      default: [{ label: 'First' }, { label: 'Second' }],
      of: { label: { kind: 'text', label: 'Title', default: 'Panel', maxLength: 80 } },
    },
    openFirst: { kind: 'boolean', label: 'Open the first one', default: true },
    exclusive: { kind: 'boolean', label: 'Only one open at a time', default: false },
  },
  Render: function AccordionModule({ config, instance, Slot }: ModuleRenderProps<{
    labels: { label: string }[]; openFirst: boolean; exclusive: boolean
  }>) {
    if (!Slot) return null
    const count = instance.children?.length ?? 0
    if (!count) return <ModulePlaceholder label="Accordion" hint="Add modules inside this — each one becomes a panel." />
    return (
      <div className="flex flex-col gap-px">
        {Array.from({ length: count }, (_, i) => (
          // <details> rather than a client component, for the same reason as the tabs: it works
          // before hydration, and the browser already handles the keyboard.
          <details
            key={i}
            name={config.exclusive ? `acc-${instance.id}` : undefined}
            open={config.openFirst && i === 0}
            className="border border-border"
          >
            <summary className="cursor-pointer bg-[var(--graphite)] px-3 py-2 text-xs font-bold uppercase tracking-[0.12em] text-foreground">
              {config.labels[i]?.label || `Panel ${i + 1}`}
            </summary>
            <div className="p-3">
              <Slot index={i} />
            </div>
          </details>
        ))}
      </div>
    )
  } as never,
})
