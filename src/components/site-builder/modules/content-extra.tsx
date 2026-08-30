/**
 * The rest of the content catalogue.
 *
 * Everything here is a plain server component: no client JavaScript reaches a public visitor from
 * any of it. Where something looks like it needs a script — a countdown, a carousel — it is built
 * from what the server already knows or from CSS, because a page that only works after hydration is
 * a page that flickers on arrival and breaks entirely if a chunk fails.
 *
 * They reuse the site's own type scale, HUD eyebrow treatment, clipped corners and tokens, so a
 * module placed here looks like the hand-written pages rather than like page-builder output.
 */

import Image from 'next/image'
import { ArrowRight, ArrowUpRight, Quote as QuoteIcon } from 'lucide-react'
import * as Icons from 'lucide-react'

import { cn } from '@/lib/utils'
import { registerModule, type ModuleRenderProps } from '@/lib/site-builder/registry'
import { mediaUrl } from '@/lib/site-builder/media'
import { isExternalUrl } from '@/lib/site-builder/urls'
import { SafeLink, ModulePlaceholder } from './content'

const ALIGN_CLASS = { left: 'text-left', center: 'text-center', right: 'text-right' } as const
const ALIGN_FIELD = {
  kind: 'select' as const, label: 'Alignment', default: 'left',
  options: [{ value: 'left', label: 'Left' }, { value: 'center', label: 'Centre' }, { value: 'right', label: 'Right' }],
}

/** Resolve a lucide icon by name, falling back rather than throwing on a typo. */
function Icon({ name, className }: { name: string; className?: string }) {
  const map = Icons as unknown as Record<string, React.ComponentType<{ className?: string }>>
  const Cmp = map[name] ?? Icons.Dot
  return <Cmp className={className} />
}

// ── Eyebrow ─────────────────────────────────────────────────────────────────────────────────────

registerModule({
  type: 'content.eyebrow',
  name: 'Eyebrow label',
  category: 'content',
  icon: 'Tag',
  description: 'The small tracked label the site uses above a heading.',
  configVersion: 1,
  a11y: {},
  fields: {
    text: { kind: 'text', label: 'Text', default: 'Label', maxLength: 60 },
    tone: {
      kind: 'select', label: 'Tone', default: 'muted',
      options: [{ value: 'muted', label: 'Muted' }, { value: 'accent', label: 'Accent' }, { value: 'gold', label: 'Gold' }],
    },
    align: ALIGN_FIELD,
  },
  Render: function EyebrowModule({ config }: ModuleRenderProps<{ text: string; tone: string; align: keyof typeof ALIGN_CLASS }>) {
    const tone = { muted: 'text-muted-foreground', accent: 'text-[var(--hot-red)]', gold: 'text-[var(--gold)]' }[config.tone] ?? 'text-muted-foreground'
    return <p className={cn('eyebrow', tone, ALIGN_CLASS[config.align])}>{config.text}</p>
  } as never,
})

// ── Logo ────────────────────────────────────────────────────────────────────────────────────────

registerModule({
  type: 'content.logo',
  name: 'Logo',
  category: 'content',
  icon: 'Sparkles',
  description: 'A brand mark, from the media library or a file already on the site.',
  configVersion: 1,
  a11y: { requiresLabel: true },
  fields: {
    mediaId: { kind: 'media', label: 'From the media library', default: null },
    path: { kind: 'url', label: 'Or a file path', default: '', internalOnly: true, help: 'Such as /assets/branding/wcc-logo.png.' },
    alt: { kind: 'text', label: 'Alt text', default: '', maxLength: 200, help: 'The organisation’s name. Required unless it is purely decorative.' },
    height: { kind: 'number', label: 'Height', default: 64, min: 16, max: 320, unit: 'px' },
    href: { kind: 'url', label: 'Links to', default: '' },
    align: ALIGN_FIELD,
  },
  Render: async function LogoModule({ config }: ModuleRenderProps<{
    mediaId: number | null; path: string; alt: string; height: number; href: string; align: keyof typeof ALIGN_CLASS
  }>) {
    const uploaded = await mediaUrl(config.mediaId)
    const src = uploaded?.url || config.path
    if (!src) return <ModulePlaceholder label="Logo" hint="Choose an image, or give a file path." />
    const img = (
      <Image
        src={src}
        alt={config.alt}
        width={uploaded?.width ?? 512}
        height={uploaded?.height ?? 512}
        className="w-auto object-contain"
        style={{ height: `${config.height}px` }}
      />
    )
    const justify = config.align === 'center' ? 'justify-center' : config.align === 'right' ? 'justify-end' : 'justify-start'
    return (
      <div className={cn('flex', justify)}>
        {config.href ? <SafeLink href={config.href}>{img}</SafeLink> : img}
      </div>
    )
  } as never,
})

// ── Button group ────────────────────────────────────────────────────────────────────────────────

const BUTTON_STYLES = {
  primary: 'bg-[var(--hot-red)] text-white hover:brightness-110',
  outline: 'border border-[var(--line-strong)] text-foreground hover:border-[var(--hot-red)]',
  ghost: 'text-foreground underline-offset-4 hover:underline',
} as const

registerModule({
  type: 'content.buttonGroup',
  name: 'Button group',
  category: 'content',
  icon: 'MousePointerClick',
  description: 'Several calls to action side by side.',
  configVersion: 1,
  a11y: {},
  fields: {
    align: ALIGN_FIELD,
    buttons: {
      kind: 'list', label: 'Buttons', itemLabel: 'Button', max: 4,
      default: [{ label: 'Find out more', href: '/', variant: 'primary', newTab: false }],
      of: {
        label: { kind: 'text', label: 'Label', default: 'Button', maxLength: 60 },
        href: { kind: 'url', label: 'Destination', default: '/' },
        variant: { kind: 'select', label: 'Style', default: 'primary', options: [{ value: 'primary', label: 'Primary' }, { value: 'outline', label: 'Outline' }, { value: 'ghost', label: 'Text only' }] },
        newTab: { kind: 'boolean', label: 'New tab', default: false },
      },
    },
  },
  Render: function ButtonGroupModule({ config }: ModuleRenderProps<{
    align: keyof typeof ALIGN_CLASS
    buttons: { label: string; href: string; variant: keyof typeof BUTTON_STYLES; newTab: boolean }[]
  }>) {
    if (!config.buttons.length) return <ModulePlaceholder label="Button group" hint="Add a button in the inspector." />
    const justify = config.align === 'center' ? 'justify-center' : config.align === 'right' ? 'justify-end' : 'justify-start'
    return (
      <div className={cn('flex flex-wrap items-center gap-2', justify)}>
        {config.buttons.map((b, i) => (
          <SafeLink
            key={i}
            href={b.href}
            newTab={b.newTab}
            className={cn(
              'inline-flex min-h-[44px] items-center gap-2 whitespace-nowrap px-5 py-2.5 text-xs font-bold uppercase tracking-[0.14em] transition',
              BUTTON_STYLES[b.variant] ?? BUTTON_STYLES.primary,
            )}
          >
            {b.label}
            {isExternalUrl(b.href) ? <ArrowUpRight className="size-4" aria-hidden /> : <ArrowRight className="size-4" aria-hidden />}
          </SafeLink>
        ))}
      </div>
    )
  } as never,
})

// ── Icon link list ──────────────────────────────────────────────────────────────────────────────

registerModule({
  type: 'content.iconLinks',
  name: 'Icon links',
  category: 'content',
  icon: 'Link2',
  description: 'Links with an icon each — social accounts, contacts, quick destinations.',
  configVersion: 1,
  a11y: { requiresLabel: true },
  fields: {
    label: { kind: 'text', label: 'Accessible name', default: 'Links', maxLength: 60 },
    layout: { kind: 'select', label: 'Arrangement', default: 'row', options: [{ value: 'row', label: 'Row' }, { value: 'column', label: 'Column' }] },
    showText: { kind: 'boolean', label: 'Show the labels', default: true, help: 'Off shows icons only. The label is still announced to screen readers.' },
    items: {
      kind: 'list', label: 'Links', itemLabel: 'Link', max: 12,
      default: [{ icon: 'Globe', label: 'Website', href: '/', newTab: false }],
      of: {
        icon: { kind: 'text', label: 'Icon name', default: 'Globe', maxLength: 40, help: 'Any lucide.dev icon name, such as Twitter, Youtube, Mail.' },
        label: { kind: 'text', label: 'Label', default: 'Link', maxLength: 60 },
        href: { kind: 'url', label: 'Destination', default: '/' },
        newTab: { kind: 'boolean', label: 'New tab', default: false },
      },
    },
  },
  Render: function IconLinksModule({ config }: ModuleRenderProps<{
    label: string; layout: string; showText: boolean
    items: { icon: string; label: string; href: string; newTab: boolean }[]
  }>) {
    if (!config.items.length) return <ModulePlaceholder label="Icon links" hint="Add a link in the inspector." />
    return (
      <nav aria-label={config.label}>
        <ul className={cn('flex gap-x-4 gap-y-2', config.layout === 'column' ? 'flex-col' : 'flex-row flex-wrap items-center')}>
          {config.items.map((item, i) => (
            <li key={i}>
              <SafeLink
                href={item.href}
                newTab={item.newTab}
                className="inline-flex items-center gap-2 text-sm text-foreground underline-offset-4 hover:underline"
              >
                <Icon name={item.icon} className="size-4 shrink-0" />
                <span className={config.showText ? '' : 'sr-only'}>{item.label}</span>
              </SafeLink>
            </li>
          ))}
        </ul>
      </nav>
    )
  } as never,
})

// ── Quote ───────────────────────────────────────────────────────────────────────────────────────

registerModule({
  type: 'content.quote',
  name: 'Quote',
  category: 'content',
  icon: 'Quote',
  description: 'A pull quote with an attribution.',
  configVersion: 1,
  a11y: {},
  fields: {
    text: { kind: 'text', label: 'Quote', default: 'Something worth repeating.', maxLength: 600, multiline: true },
    attribution: { kind: 'text', label: 'Who said it', default: '', maxLength: 120 },
    detail: { kind: 'text', label: 'Context', default: '', maxLength: 120, help: 'A season, a match, a date.' },
    size: { kind: 'select', label: 'Size', default: 'lg', options: [{ value: 'md', label: 'Medium' }, { value: 'lg', label: 'Large' }] },
  },
  Render: function QuoteModule({ config }: ModuleRenderProps<{ text: string; attribution: string; detail: string; size: string }>) {
    return (
      <figure className="border-l-2 border-[var(--hot-red)] pl-4">
        <QuoteIcon className="mb-2 size-5 text-[var(--hot-red)]" aria-hidden />
        <blockquote className={cn('font-display font-bold leading-snug text-foreground', config.size === 'lg' ? 'text-xl sm:text-2xl' : 'text-base sm:text-lg')}>
          {config.text}
        </blockquote>
        {(config.attribution || config.detail) && (
          <figcaption className="mt-2 text-xs text-muted-foreground">
            {config.attribution && <span className="font-semibold text-foreground">{config.attribution}</span>}
            {config.attribution && config.detail && ' · '}
            {config.detail}
          </figcaption>
        )}
      </figure>
    )
  } as never,
})

// ── Single stat ─────────────────────────────────────────────────────────────────────────────────

registerModule({
  type: 'content.stat',
  name: 'Stat',
  category: 'content',
  icon: 'Hash',
  description: 'One figure with a label. Type the value, or use a data module for anything the registry knows.',
  configVersion: 1,
  a11y: {},
  fields: {
    label: { kind: 'text', label: 'Label', default: 'Seasons', maxLength: 60 },
    value: { kind: 'text', label: 'Value', default: '50', maxLength: 24 },
    detail: { kind: 'text', label: 'Detail', default: '', maxLength: 80 },
    size: { kind: 'select', label: 'Size', default: 'lg', options: [{ value: 'md', label: 'Medium' }, { value: 'lg', label: 'Large' }, { value: 'xl', label: 'Extra large' }] },
    align: ALIGN_FIELD,
  },
  Render: function StatModule({ config }: ModuleRenderProps<{ label: string; value: string; detail: string; size: string; align: keyof typeof ALIGN_CLASS }>) {
    const size = { md: 'text-xl', lg: 'text-3xl', xl: 'text-5xl' }[config.size] ?? 'text-3xl'
    return (
      <div className={ALIGN_CLASS[config.align]}>
        <p className="eyebrow text-muted-foreground">{config.label}</p>
        <p className={cn('tabular font-display font-black text-foreground', size)}>{config.value}</p>
        {config.detail && <p className="mt-0.5 text-xs text-muted-foreground">{config.detail}</p>}
      </div>
    )
  } as never,
})

// ── Announcement ────────────────────────────────────────────────────────────────────────────────

const TONE_STYLES = {
  accent: 'border-[var(--hot-red)] bg-[var(--graphite)]',
  gold: 'border-[var(--gold)] bg-[var(--graphite)]',
  teal: 'border-[var(--brcam-teal)] bg-[var(--graphite)]',
  neutral: 'border-[var(--line-strong)] bg-[var(--graphite)]',
} as const

registerModule({
  type: 'content.announcement',
  name: 'Announcement',
  category: 'content',
  icon: 'Megaphone',
  description: 'A titled announcement with a call to action. Schedule it from the Visibility panel.',
  configVersion: 1,
  a11y: { landmark: true },
  fields: {
    eyebrow: { kind: 'text', label: 'Eyebrow', default: '', maxLength: 60 },
    title: { kind: 'text', label: 'Title', default: 'Something is happening', maxLength: 160 },
    body: { kind: 'text', label: 'Body', default: '', maxLength: 400, multiline: true },
    ctaLabel: { kind: 'text', label: 'Button label', default: '', maxLength: 60 },
    ctaHref: { kind: 'url', label: 'Button destination', default: '' },
    newTab: { kind: 'boolean', label: 'Open in a new tab', default: false },
    tone: { kind: 'select', label: 'Tone', default: 'accent', options: Object.keys(TONE_STYLES).map((v) => ({ value: v, label: v[0].toUpperCase() + v.slice(1) })) },
    align: ALIGN_FIELD,
  },
  Render: function AnnouncementModule({ config }: ModuleRenderProps<{
    eyebrow: string; title: string; body: string; ctaLabel: string; ctaHref: string; newTab: boolean
    tone: keyof typeof TONE_STYLES; align: keyof typeof ALIGN_CLASS
  }>) {
    return (
      <section
        aria-label={config.title}
        className={cn('dl-surface cyber-clip border p-5 lg:p-6', TONE_STYLES[config.tone] ?? TONE_STYLES.accent, ALIGN_CLASS[config.align])}
      >
        {config.eyebrow && <p className="eyebrow mb-1 text-muted-foreground">{config.eyebrow}</p>}
        <h2 className="font-display text-xl font-black uppercase tracking-tight text-foreground sm:text-2xl">{config.title}</h2>
        {config.body && <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">{config.body}</p>}
        {config.ctaLabel && config.ctaHref && (
          <SafeLink
            href={config.ctaHref}
            newTab={config.newTab}
            className="mt-4 inline-flex min-h-[44px] items-center gap-2 bg-[var(--hot-red)] px-5 py-2.5 text-xs font-bold uppercase tracking-[0.14em] text-white hover:brightness-110"
          >
            {config.ctaLabel}
            {isExternalUrl(config.ctaHref) ? <ArrowUpRight className="size-4" aria-hidden /> : <ArrowRight className="size-4" aria-hidden />}
          </SafeLink>
        )}
      </section>
    )
  } as never,
})

// ── Feature card ────────────────────────────────────────────────────────────────────────────────

registerModule({
  type: 'content.featureCard',
  name: 'Feature card',
  category: 'content',
  icon: 'SquareStack',
  description: 'A card with an optional image, heading, copy and link. Use several inside a card grid.',
  configVersion: 1,
  a11y: {},
  fields: {
    mediaId: { kind: 'media', label: 'Image', default: null },
    alt: { kind: 'text', label: 'Alt text', default: '', maxLength: 200 },
    eyebrow: { kind: 'text', label: 'Eyebrow', default: '', maxLength: 50 },
    title: { kind: 'text', label: 'Title', default: 'Feature', maxLength: 120 },
    body: { kind: 'text', label: 'Body', default: '', maxLength: 300, multiline: true },
    href: { kind: 'url', label: 'Links to', default: '' },
    ctaLabel: { kind: 'text', label: 'Link label', default: '', maxLength: 40 },
  },
  Render: async function FeatureCardModule({ config }: ModuleRenderProps<{
    mediaId: number | null; alt: string; eyebrow: string; title: string; body: string; href: string; ctaLabel: string
  }>) {
    const media = await mediaUrl(config.mediaId)
    const inner = (
      <>
        {media && (
          <span className="relative block aspect-video w-full overflow-hidden">
            <Image src={media.url} alt={config.alt} width={media.width ?? 800} height={media.height ?? 450} className="h-full w-full object-cover" />
          </span>
        )}
        <span className="flex flex-1 flex-col gap-1 p-4">
          {config.eyebrow && <span className="eyebrow text-muted-foreground">{config.eyebrow}</span>}
          <span className="font-display text-base font-black uppercase tracking-tight text-foreground">{config.title}</span>
          {config.body && <span className="text-xs leading-relaxed text-muted-foreground">{config.body}</span>}
          {config.ctaLabel && (
            <span className="mt-2 inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--hot-red)]">
              {config.ctaLabel} <ArrowRight className="size-3" aria-hidden />
            </span>
          )}
        </span>
      </>
    )
    const className = 'dl-surface cyber-clip flex h-full flex-col overflow-hidden border border-border bg-card transition hover:border-[var(--hot-red)]'
    return config.href
      ? <SafeLink href={config.href} className={className}>{inner}</SafeLink>
      : <div className={className}>{inner}</div>
  } as never,
})

// ── Hero ────────────────────────────────────────────────────────────────────────────────────────

registerModule({
  type: 'content.hero',
  name: 'Hero',
  category: 'content',
  icon: 'Presentation',
  description: 'A large opening block with a headline, copy and calls to action.',
  configVersion: 1,
  a11y: { headingLevel: 2 },
  layoutDefaults: { span: 12 },
  fields: {
    eyebrow: { kind: 'text', label: 'Eyebrow', default: '', maxLength: 60 },
    title: { kind: 'text', label: 'Headline', default: 'Headline', maxLength: 160 },
    body: { kind: 'text', label: 'Copy', default: '', maxLength: 500, multiline: true },
    mediaId: { kind: 'media', label: 'Background image', default: null },
    overlay: { kind: 'number', label: 'Darken the image', default: 55, min: 0, max: 90, unit: '%' },
    minHeight: { kind: 'number', label: 'Minimum height', default: 320, min: 160, max: 800, unit: 'px' },
    align: ALIGN_FIELD,
    primaryLabel: { kind: 'text', label: 'Primary button', default: '', maxLength: 50 },
    primaryHref: { kind: 'url', label: 'Primary destination', default: '' },
    secondaryLabel: { kind: 'text', label: 'Secondary button', default: '', maxLength: 50 },
    secondaryHref: { kind: 'url', label: 'Secondary destination', default: '' },
  },
  Render: async function HeroModule({ config }: ModuleRenderProps<{
    eyebrow: string; title: string; body: string; mediaId: number | null; overlay: number; minHeight: number
    align: keyof typeof ALIGN_CLASS; primaryLabel: string; primaryHref: string; secondaryLabel: string; secondaryHref: string
  }>) {
    const media = await mediaUrl(config.mediaId)
    const items = config.align === 'center' ? 'items-center' : config.align === 'right' ? 'items-end' : 'items-start'
    return (
      <section
        className={cn('dl-surface cyber-clip relative isolate flex flex-col justify-center overflow-hidden border border-[var(--line-strong)] p-6 sm:p-10', items, ALIGN_CLASS[config.align])}
        style={{
          minHeight: `${config.minHeight}px`,
          ...(media ? { backgroundImage: `url(${JSON.stringify(media.url)})`, backgroundSize: 'cover', backgroundPosition: 'center' } : { background: 'var(--graphite)' }),
        }}
      >
        {media && config.overlay > 0 && (
          <span aria-hidden className="pointer-events-none absolute inset-0" style={{ background: `rgba(0,0,0,${config.overlay / 100})` }} />
        )}
        <div className="relative max-w-3xl">
          {config.eyebrow && <p className="eyebrow mb-2 text-muted-foreground">{config.eyebrow}</p>}
          <h2 className="font-display text-3xl font-black uppercase leading-[0.95] tracking-tight text-foreground sm:text-4xl lg:text-5xl">{config.title}</h2>
          {config.body && <p className="mt-3 text-sm leading-relaxed text-muted-foreground sm:text-base">{config.body}</p>}
          {(config.primaryLabel || config.secondaryLabel) && (
            <div className={cn('mt-5 flex flex-wrap gap-2', config.align === 'center' && 'justify-center', config.align === 'right' && 'justify-end')}>
              {config.primaryLabel && config.primaryHref && (
                <SafeLink href={config.primaryHref} className="inline-flex min-h-[44px] items-center gap-2 bg-[var(--hot-red)] px-5 py-2.5 text-xs font-bold uppercase tracking-[0.14em] text-white hover:brightness-110">
                  {config.primaryLabel} <ArrowRight className="size-4" aria-hidden />
                </SafeLink>
              )}
              {config.secondaryLabel && config.secondaryHref && (
                <SafeLink href={config.secondaryHref} className="inline-flex min-h-[44px] items-center gap-2 border border-[var(--line-strong)] px-5 py-2.5 text-xs font-bold uppercase tracking-[0.14em] text-foreground hover:border-[var(--hot-red)]">
                  {config.secondaryLabel}
                </SafeLink>
              )}
            </div>
          )}
        </div>
      </section>
    )
  } as never,
})

// ── Call to action ──────────────────────────────────────────────────────────────────────────────

registerModule({
  type: 'content.cta',
  name: 'Call to action',
  category: 'content',
  icon: 'Zap',
  description: 'A compact band with a line of copy and one button.',
  configVersion: 1,
  a11y: {},
  layoutDefaults: { span: 12 },
  fields: {
    text: { kind: 'text', label: 'Text', default: 'Ready to take part?', maxLength: 200 },
    label: { kind: 'text', label: 'Button label', default: 'Get started', maxLength: 50 },
    href: { kind: 'url', label: 'Destination', default: '/' },
    newTab: { kind: 'boolean', label: 'New tab', default: false },
    tone: { kind: 'select', label: 'Tone', default: 'accent', options: Object.keys(TONE_STYLES).map((v) => ({ value: v, label: v[0].toUpperCase() + v.slice(1) })) },
  },
  Render: function CtaModule({ config }: ModuleRenderProps<{ text: string; label: string; href: string; newTab: boolean; tone: keyof typeof TONE_STYLES }>) {
    return (
      <div className={cn('cyber-clip flex flex-wrap items-center justify-between gap-4 border p-4 sm:p-5', TONE_STYLES[config.tone] ?? TONE_STYLES.accent)}>
        <p className="font-display text-base font-black uppercase tracking-tight text-foreground sm:text-lg">{config.text}</p>
        <SafeLink
          href={config.href}
          newTab={config.newTab}
          className="inline-flex min-h-[44px] shrink-0 items-center gap-2 bg-[var(--hot-red)] px-5 py-2.5 text-xs font-bold uppercase tracking-[0.14em] text-white hover:brightness-110"
        >
          {config.label} <ArrowRight className="size-4" aria-hidden />
        </SafeLink>
      </div>
    )
  } as never,
})

// ── Countdown ───────────────────────────────────────────────────────────────────────────────────

registerModule({
  type: 'content.countdown',
  name: 'Countdown',
  category: 'content',
  icon: 'Timer',
  description: 'Days remaining until a date. Server-rendered, so it needs no JavaScript.',
  configVersion: 1,
  a11y: {},
  fields: {
    title: { kind: 'text', label: 'Title', default: 'Season 1 begins', maxLength: 120 },
    target: { kind: 'text', label: 'Date', default: '', maxLength: 40, help: 'YYYY-MM-DD, or a full date and time.' },
    finishedText: { kind: 'text', label: 'When the date has passed', default: 'Under way now.', maxLength: 160 },
    align: ALIGN_FIELD,
  },
  Render: function CountdownModule({ config }: ModuleRenderProps<{ title: string; target: string; finishedText: string; align: keyof typeof ALIGN_CLASS }>) {
    const when = config.target ? Date.parse(config.target) : NaN
    if (Number.isNaN(when)) {
      return <ModulePlaceholder label="Countdown" hint="Set a date in the inspector, such as 2026-09-01." />
    }
    /*
      Days, not seconds, and rendered on the server.

      A live ticking clock would need a client component, and it would be wrong for the first frame
      on every visit — the server cannot know the reader's clock. Whole days are the same number for
      everybody, do not drift, and cost no JavaScript.
    */
    const now = Date.now()
    const days = Math.ceil((when - now) / 86_400_000)
    const past = days <= 0
    return (
      <div className={cn('cyber-clip border border-[var(--line-strong)] bg-[var(--graphite)] p-5', ALIGN_CLASS[config.align])}>
        <p className="eyebrow text-muted-foreground">{config.title}</p>
        {past ? (
          <p className="mt-1 font-display text-xl font-black uppercase tracking-tight text-[var(--gold)]">{config.finishedText}</p>
        ) : (
          <p className="mt-1">
            <span className="tabular font-display text-4xl font-black text-foreground">{days}</span>
            <span className="ml-2 text-sm uppercase tracking-[0.14em] text-muted-foreground">{days === 1 ? 'day to go' : 'days to go'}</span>
          </p>
        )}
        <p className="mt-1 text-[11px] text-muted-foreground">
          <time dateTime={new Date(when).toISOString()}>
            {new Date(when).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' })}
          </time>
        </p>
      </div>
    )
  } as never,
})

// ── Sponsor / partner panel ─────────────────────────────────────────────────────────────────────

registerModule({
  type: 'content.sponsors',
  name: 'Sponsor panel',
  category: 'content',
  icon: 'Handshake',
  description: 'A row of partner logos.',
  configVersion: 1,
  a11y: { requiresLabel: true },
  layoutDefaults: { span: 12 },
  fields: {
    title: { kind: 'text', label: 'Title', default: 'Partners', maxLength: 60 },
    height: { kind: 'number', label: 'Logo height', default: 40, min: 16, max: 160, unit: 'px' },
    grayscale: { kind: 'boolean', label: 'Desaturate until hovered', default: true },
    items: {
      kind: 'list', label: 'Partners', itemLabel: 'Partner', max: 12, default: [],
      of: {
        mediaId: { kind: 'media', label: 'Logo', default: null },
        path: { kind: 'url', label: 'Or a file path', default: '', internalOnly: true },
        name: { kind: 'text', label: 'Name', default: '', maxLength: 80 },
        href: { kind: 'url', label: 'Links to', default: '' },
      },
    },
  },
  Render: async function SponsorsModule({ config }: ModuleRenderProps<{
    title: string; height: number; grayscale: boolean
    items: { mediaId: number | null; path: string; name: string; href: string }[]
  }>) {
    if (!config.items.length) return <ModulePlaceholder label="Sponsor panel" hint="Add a partner in the inspector." />
    const resolved = await Promise.all(config.items.map(async (i) => ({ ...i, media: await mediaUrl(i.mediaId) })))
    return (
      <section aria-label={config.title} className="flex flex-col gap-3">
        {config.title && <p className="eyebrow text-center text-muted-foreground">{config.title}</p>}
        <ul className="flex flex-wrap items-center justify-center gap-x-8 gap-y-4">
          {resolved.map((item, i) => {
            const src = item.media?.url || item.path
            const img = src ? (
              <Image
                src={src}
                alt={item.name}
                width={item.media?.width ?? 320}
                height={item.media?.height ?? 120}
                className={cn('w-auto object-contain transition', config.grayscale && 'opacity-70 grayscale hover:opacity-100 hover:grayscale-0')}
                style={{ height: `${config.height}px` }}
              />
            ) : (
              <span className="text-sm font-semibold text-muted-foreground">{item.name}</span>
            )
            return <li key={i}>{item.href ? <SafeLink href={item.href}>{img}</SafeLink> : img}</li>
          })}
        </ul>
      </section>
    )
  } as never,
})
