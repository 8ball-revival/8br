/**
 * Content modules: the pieces that hold words, pictures and links.
 *
 * These are the modules an administrator reaches for most, so they are the ones that most have to
 * look like the rest of the site rather than like a page builder. Each renders with the existing
 * type scale, the existing HUD eyebrow treatment, the existing clipped corners and the existing
 * tokens — a heading placed here is the same heading the hand-written pages use.
 *
 * Every one of them is a plain server component. None of them ships JavaScript to a public visitor.
 */

import Link from 'next/link'
import Image from 'next/image'
import { ArrowRight, ArrowUpRight } from 'lucide-react'

import { cn } from '@/lib/utils'
import { registerModule, type ModuleRenderProps } from '@/lib/site-builder/registry'
import { isExternalUrl, resolveEmbedProvider } from '@/lib/site-builder/urls'
import { mediaUrl } from '@/lib/site-builder/media'

// ── Heading ─────────────────────────────────────────────────────────────────────────────────────

const HEADING_SIZES = {
  display: 'font-display text-4xl font-black uppercase leading-[0.95] tracking-tight sm:text-5xl lg:text-6xl',
  xl: 'font-display text-3xl font-black uppercase leading-tight tracking-tight sm:text-4xl',
  lg: 'font-display text-2xl font-black uppercase leading-tight tracking-tight',
  md: 'font-display text-xl font-bold uppercase tracking-tight',
} as const

registerModule({
  type: 'content.heading',
  name: 'Heading',
  category: 'content',
  icon: 'Heading',
  description: 'A titled heading with an optional eyebrow label above it.',
  configVersion: 1,
  a11y: { headingLevel: 2 },
  fields: {
    eyebrow: { kind: 'text', label: 'Eyebrow', default: '', maxLength: 60, help: 'Small label above the heading. Leave blank for none.' },
    text: { kind: 'text', label: 'Heading', default: 'Heading', maxLength: 200 },
    size: {
      kind: 'select', label: 'Size', default: 'lg',
      options: [
        { value: 'display', label: 'Display' },
        { value: 'xl', label: 'Extra large' },
        { value: 'lg', label: 'Large' },
        { value: 'md', label: 'Medium' },
      ],
    },
    level: {
      kind: 'select', label: 'Heading level', default: 'h2',
      help: 'Controls the document outline for screen readers, not the visual size.',
      options: [{ value: 'h2', label: 'H2' }, { value: 'h3', label: 'H3' }, { value: 'h4', label: 'H4' }],
    },
    align: {
      kind: 'select', label: 'Alignment', default: 'left',
      options: [{ value: 'left', label: 'Left' }, { value: 'center', label: 'Centre' }, { value: 'right', label: 'Right' }],
    },
  },
  Render: function HeadingModule({ config }: ModuleRenderProps<{
    eyebrow: string; text: string; size: keyof typeof HEADING_SIZES; level: 'h2' | 'h3' | 'h4'; align: string
  }>) {
    const Tag = config.level
    const align = config.align === 'center' ? 'text-center' : config.align === 'right' ? 'text-right' : 'text-left'
    return (
      <div className={align}>
        {config.eyebrow && <p className="eyebrow mb-2 text-muted-foreground">{config.eyebrow}</p>}
        <Tag className={cn(HEADING_SIZES[config.size] ?? HEADING_SIZES.lg, 'text-foreground')}>{config.text}</Tag>
      </div>
    )
  } as never,
})

// ── Rich text ───────────────────────────────────────────────────────────────────────────────────

registerModule({
  type: 'content.richText',
  name: 'Rich text',
  category: 'content',
  icon: 'Text',
  description: 'A block of formatted copy.',
  configVersion: 1,
  a11y: {},
  fields: {
    html: {
      kind: 'richText', label: 'Content', default: '<p>Write something here.</p>',
      help: 'Bold, italic, lists, links and small headings. Anything else is removed when saved.',
    },
    measure: {
      kind: 'select', label: 'Line length', default: 'comfortable',
      help: 'Long lines are hard to read. Comfortable caps the column at roughly 70 characters.',
      options: [{ value: 'comfortable', label: 'Comfortable' }, { value: 'full', label: 'Full width' }],
    },
  },
  Render: function RichTextModule({ config }: ModuleRenderProps<{ html: string; measure: string }>) {
    return (
      <div
        className={cn(
          'sb-prose text-sm leading-relaxed text-foreground sm:text-[0.95rem]',
          config.measure === 'comfortable' && 'max-w-[70ch]',
        )}
        /*
          The value was sanitised by `validateConfig` on the way IN, against an allowlist, and it
          cannot have been written by anyone without `manage_site_builder`. It is sanitised on the
          way in rather than here so that what is stored is already safe — a second sanitiser at
          render would mean the database held markup nobody had vetted.
        */
        dangerouslySetInnerHTML={{ __html: config.html }}
      />
    )
  } as never,
})

// ── Image ───────────────────────────────────────────────────────────────────────────────────────

const FITS = { cover: 'object-cover', contain: 'object-contain' } as const
const RATIOS = {
  auto: '', '16/9': 'aspect-video', '4/3': 'aspect-[4/3]', '1/1': 'aspect-square', '21/9': 'aspect-[21/9]',
} as const

registerModule({
  type: 'content.image',
  name: 'Image',
  category: 'content',
  icon: 'Image',
  description: 'A picture from the media library.',
  configVersion: 1,
  a11y: { requiresLabel: true },
  fields: {
    mediaId: { kind: 'media', label: 'Image', default: null },
    alt: {
      kind: 'text', label: 'Alt text', default: '', maxLength: 300,
      help: 'What the picture shows, for anyone who cannot see it. Leave blank only if it is purely decorative.',
    },
    ratio: {
      kind: 'select', label: 'Aspect ratio', default: 'auto',
      help: 'A fixed ratio reserves the space before the image loads, so the page does not jump.',
      options: [
        { value: 'auto', label: 'Natural' }, { value: '16/9', label: '16:9' }, { value: '4/3', label: '4:3' },
        { value: '1/1', label: 'Square' }, { value: '21/9', label: 'Ultra-wide' },
      ],
    },
    fit: { kind: 'select', label: 'Fit', default: 'cover', options: [{ value: 'cover', label: 'Fill the frame' }, { value: 'contain', label: 'Fit inside' }] },
    focalX: { kind: 'number', label: 'Focal point — across', default: 50, min: 0, max: 100, unit: '%', help: 'Which part of the picture to keep when it is cropped.' },
    focalY: { kind: 'number', label: 'Focal point — down', default: 50, min: 0, max: 100, unit: '%' },
    caption: { kind: 'text', label: 'Caption', default: '', maxLength: 300 },
    href: { kind: 'url', label: 'Links to', default: '' },
  },
  Render: async function ImageModule({ config }: ModuleRenderProps<{
    mediaId: number | null; alt: string; ratio: keyof typeof RATIOS; fit: keyof typeof FITS
    focalX: number; focalY: number; caption: string; href: string
  }>) {
    const src = await mediaUrl(config.mediaId)
    if (!src) {
      return <ModulePlaceholder label="Image" hint="Choose a picture in the inspector." />
    }
    const img = (
      <span className={cn('relative block w-full overflow-hidden', RATIOS[config.ratio] ?? '')}>
        <Image
          src={src.url}
          alt={config.alt}
          width={src.width ?? 1600}
          height={src.height ?? 900}
          sizes="(max-width: 768px) 100vw, 1200px"
          className={cn('h-full w-full', FITS[config.fit] ?? 'object-cover')}
          style={{ objectPosition: `${config.focalX}% ${config.focalY}%` }}
        />
      </span>
    )
    return (
      <figure className="w-full">
        {config.href ? <SafeLink href={config.href} className="block">{img}</SafeLink> : img}
        {config.caption && <figcaption className="mt-2 text-xs text-muted-foreground">{config.caption}</figcaption>}
      </figure>
    )
  } as never,
})

// ── Button ──────────────────────────────────────────────────────────────────────────────────────

const BUTTON_STYLES = {
  primary: 'bg-[var(--hot-red)] text-white hover:brightness-110',
  outline: 'border border-[var(--line-strong)] text-foreground hover:border-[var(--hot-red)]',
  ghost: 'text-foreground underline-offset-4 hover:underline',
} as const

registerModule({
  type: 'content.button',
  name: 'Button',
  category: 'content',
  icon: 'MousePointerClick',
  description: 'A single call to action.',
  configVersion: 1,
  a11y: { requiresLabel: true },
  fields: {
    label: { kind: 'text', label: 'Label', default: 'Find out more', maxLength: 80 },
    href: { kind: 'url', label: 'Destination', default: '/' },
    variant: {
      kind: 'select', label: 'Style', default: 'primary',
      options: [{ value: 'primary', label: 'Primary' }, { value: 'outline', label: 'Outline' }, { value: 'ghost', label: 'Text only' }],
    },
    newTab: { kind: 'boolean', label: 'Open in a new tab', default: false, help: 'External links get noopener protection automatically.' },
    align: {
      kind: 'select', label: 'Alignment', default: 'left',
      options: [{ value: 'left', label: 'Left' }, { value: 'center', label: 'Centre' }, { value: 'right', label: 'Right' }],
    },
  },
  Render: function ButtonModule({ config }: ModuleRenderProps<{
    label: string; href: string; variant: keyof typeof BUTTON_STYLES; newTab: boolean; align: string
  }>) {
    const external = isExternalUrl(config.href)
    return (
      <div className={cn('flex', config.align === 'center' ? 'justify-center' : config.align === 'right' ? 'justify-end' : 'justify-start')}>
        <SafeLink
          href={config.href}
          newTab={config.newTab}
          className={cn(
            'inline-flex min-h-[44px] items-center gap-2 whitespace-nowrap px-5 py-2.5 text-xs font-bold uppercase tracking-[0.14em] transition',
            BUTTON_STYLES[config.variant] ?? BUTTON_STYLES.primary,
          )}
        >
          {config.label}
          {external ? <ArrowUpRight className="size-4" aria-hidden /> : <ArrowRight className="size-4" aria-hidden />}
        </SafeLink>
      </div>
    )
  } as never,
})

// ── Notice / callout ────────────────────────────────────────────────────────────────────────────

const NOTICE_TONES = {
  neutral: 'border-[var(--line-strong)] bg-[var(--graphite)]',
  info: 'border-[var(--acid-dim)] bg-[var(--graphite)]',
  warning: 'border-[var(--gold)] bg-[var(--graphite)]',
  danger: 'border-[var(--hot-red)] bg-[var(--graphite)]',
} as const

registerModule({
  type: 'content.notice',
  name: 'Notice',
  category: 'content',
  icon: 'Info',
  description: 'A bordered note. Used for the archive disclaimer and anything similar.',
  configVersion: 1,
  a11y: {},
  fields: {
    title: { kind: 'text', label: 'Title', default: '', maxLength: 120 },
    body: { kind: 'richText', label: 'Body', default: '<p>Something worth saying.</p>' },
    tone: {
      kind: 'select', label: 'Tone', default: 'neutral',
      options: [
        { value: 'neutral', label: 'Neutral' }, { value: 'info', label: 'Information' },
        { value: 'warning', label: 'Warning' }, { value: 'danger', label: 'Important' },
      ],
    },
    centred: { kind: 'boolean', label: 'Centre the text', default: false },
  },
  Render: function NoticeModule({ config }: ModuleRenderProps<{
    title: string; body: string; tone: keyof typeof NOTICE_TONES; centred: boolean
  }>) {
    return (
      <section className={cn('dl-surface cyber-clip relative flex h-full flex-col justify-center border p-5 lg:p-6', NOTICE_TONES[config.tone] ?? NOTICE_TONES.neutral, config.centred && 'text-center')}>
        {config.title && <h2 className="eyebrow mb-2 text-foreground">{config.title}</h2>}
        <div
          className={cn('sb-prose text-sm font-semibold leading-relaxed text-foreground sm:text-[0.95rem]', config.centred && 'mx-auto max-w-2xl')}
          dangerouslySetInnerHTML={{ __html: config.body }}
        />
      </section>
    )
  } as never,
})

// ── Stat strip ──────────────────────────────────────────────────────────────────────────────────

registerModule({
  type: 'content.statStrip',
  name: 'Stat strip',
  category: 'content',
  icon: 'BarChart3',
  description: 'A row of figures. The values are typed in, so use a data module for anything the registry already knows.',
  configVersion: 1,
  a11y: {},
  fields: {
    items: {
      kind: 'list', label: 'Figures', itemLabel: 'Figure', max: 8,
      default: [{ label: 'Seasons', value: '50' }, { label: 'Players', value: '498' }],
      of: {
        label: { kind: 'text', label: 'Label', default: 'Label', maxLength: 40 },
        value: { kind: 'text', label: 'Value', default: '0', maxLength: 20 },
      },
    },
  },
  Render: function StatStripModule({ config }: ModuleRenderProps<{ items: { label: string; value: string }[] }>) {
    if (!config.items.length) return <ModulePlaceholder label="Stat strip" hint="Add a figure in the inspector." />
    return (
      <dl className="grid grid-cols-2 gap-px border border-border bg-border sm:grid-cols-4">
        {config.items.map((item, i) => (
          <div key={i} className="bg-card px-3 py-2.5">
            <dt className="eyebrow text-muted-foreground">{item.label}</dt>
            <dd className="tabular mt-0.5 font-display text-xl font-black text-foreground">{item.value}</dd>
          </div>
        ))}
      </dl>
    )
  } as never,
})

// ── Divider and spacer ──────────────────────────────────────────────────────────────────────────

registerModule({
  type: 'layout.divider',
  name: 'Divider',
  category: 'layout',
  icon: 'Minus',
  description: 'A horizontal rule.',
  configVersion: 1,
  a11y: {},
  fields: {
    weight: { kind: 'select', label: 'Weight', default: 'thin', options: [{ value: 'thin', label: 'Thin' }, { value: 'strong', label: 'Strong' }, { value: 'accent', label: 'Accent' }] },
  },
  Render: function DividerModule({ config }: ModuleRenderProps<{ weight: string }>) {
    const cls = config.weight === 'accent' ? 'border-[var(--hot-red)]' : config.weight === 'strong' ? 'border-[var(--line-strong)]' : 'border-border'
    return <hr className={cn('w-full border-t', cls)} />
  } as never,
})

registerModule({
  type: 'layout.spacer',
  name: 'Spacer',
  category: 'layout',
  icon: 'MoveVertical',
  description: 'Vertical breathing room.',
  configVersion: 1,
  a11y: {},
  fields: {
    height: { kind: 'number', label: 'Height', default: 4, min: 0, max: 24, unit: 'steps', help: 'Measured in the site spacing scale, not pixels.' },
  },
  Render: function SpacerModule({ config }: ModuleRenderProps<{ height: number }>) {
    return <div aria-hidden style={{ height: `${config.height * 4}px` }} />
  } as never,
})

// ── Safe embed ──────────────────────────────────────────────────────────────────────────────────

registerModule({
  type: 'content.embed',
  name: 'Video embed',
  category: 'content',
  icon: 'Youtube',
  description: 'A video from an approved provider. Other hosts are refused.',
  configVersion: 1,
  a11y: { requiresLabel: true },
  fields: {
    url: { kind: 'url', label: 'Video URL', default: '', help: 'YouTube, Vimeo or Twitch. Anything else is not embedded.' },
    title: { kind: 'text', label: 'Title', default: 'Embedded video', maxLength: 150, help: 'Announced to screen readers in place of the frame.' },
  },
  Render: function EmbedModule({ config }: ModuleRenderProps<{ url: string; title: string }>) {
    const provider = config.url ? resolveEmbedProvider(config.url) : null
    if (!provider) {
      return (
        <ModulePlaceholder
          label="Video embed"
          hint={config.url ? 'That host is not on the approved list, so nothing is embedded.' : 'Paste a YouTube, Vimeo or Twitch link.'}
        />
      )
    }
    return (
      <div className="aspect-video w-full overflow-hidden border border-border">
        <iframe
          src={config.url}
          title={config.title}
          className="h-full w-full"
          loading="lazy"
          /* Least privilege: the frame may go fullscreen and nothing else. No same-origin, no
             top-navigation, no forms — an approved provider still does not need them. */
          sandbox="allow-scripts allow-same-origin allow-presentation"
          allow="fullscreen; picture-in-picture"
          referrerPolicy="strict-origin-when-cross-origin"
        />
      </div>
    )
  } as never,
})

// ── Shared helpers ──────────────────────────────────────────────────────────────────────────────

/**
 * A link that routes internally and protects externally, without either being a decision made at
 * each call site. `rel` is forced rather than offered: a new-tab link without `noopener` hands the
 * opener to the destination.
 */
export function SafeLink({
  href, newTab, className, children,
}: { href: string; newTab?: boolean; className?: string; children: React.ReactNode }) {
  const external = isExternalUrl(href)
  if (external) {
    return (
      <a href={href} className={className} target={newTab === false ? undefined : '_blank'} rel="noopener noreferrer">
        {children}
      </a>
    )
  }
  return (
    <Link href={href || '/'} className={className} target={newTab ? '_blank' : undefined} rel={newTab ? 'noopener noreferrer' : undefined}>
      {children}
    </Link>
  )
}

/**
 * What a module shows when it has nothing to show.
 *
 * Rendered for everyone, not only in the editor — an unconfigured module leaving a silent gap is how
 * a page ends up with a hole nobody notices. It is quiet enough not to look like an error to a
 * visitor and specific enough to tell an administrator what to do.
 */
export function ModulePlaceholder({ label, hint }: { label: string; hint: string }) {
  return (
    <div className="flex min-h-[80px] flex-col items-center justify-center gap-1 border border-dashed border-border px-4 py-6 text-center">
      <p className="eyebrow text-muted-foreground">{label}</p>
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  )
}
