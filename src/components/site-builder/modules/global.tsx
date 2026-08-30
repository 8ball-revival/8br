/**
 * Global modules: the site shell pieces, and the announcement bar.
 *
 * The header and footer are NOT turned into arbitrary content here. They stay code-owned components
 * — they carry authentication state, the account menu and the recovery path to Admin, and a layout
 * that could delete them is a layout that could lock the owner out of the site. What is editable is
 * their configuration: which links, in what order, what the announcement above them says.
 */

import { registerModule, type ModuleRenderProps } from '@/lib/site-builder/registry'
import { SafeLink, ModulePlaceholder } from './content'
import { cn } from '@/lib/utils'

// ── Announcement bar ────────────────────────────────────────────────────────────────────────────

const BAR_TONES = {
  accent: 'bg-[var(--hot-red)] text-white',
  gold: 'bg-[var(--gold)] text-black',
  teal: 'bg-[var(--brcam-teal)] text-black',
  graphite: 'bg-[var(--graphite)] text-foreground border-y border-[var(--line-strong)]',
} as const

registerModule({
  type: 'global.announcementBar',
  name: 'Announcement bar',
  category: 'global',
  icon: 'Megaphone',
  description: 'A single-line strip across the top of the page.',
  configVersion: 1,
  a11y: { landmark: true },
  layoutDefaults: { span: 12 },
  fields: {
    message: { kind: 'text', label: 'Message', default: 'Something is happening.', maxLength: 200 },
    linkLabel: { kind: 'text', label: 'Link label', default: '', maxLength: 60 },
    linkHref: { kind: 'url', label: 'Link destination', default: '' },
    tone: {
      kind: 'select', label: 'Tone', default: 'accent',
      options: Object.keys(BAR_TONES).map((v) => ({ value: v, label: v[0].toUpperCase() + v.slice(1) })),
    },
  },
  Render: function AnnouncementBarModule({ config }: ModuleRenderProps<{
    message: string; linkLabel: string; linkHref: string; tone: keyof typeof BAR_TONES
  }>) {
    return (
      <aside
        aria-label="Site announcement"
        className={cn('flex flex-wrap items-center justify-center gap-x-3 gap-y-1 px-4 py-2 text-center text-xs font-bold uppercase tracking-[0.12em]', BAR_TONES[config.tone] ?? BAR_TONES.accent)}
      >
        <span>{config.message}</span>
        {config.linkLabel && config.linkHref && (
          <SafeLink href={config.linkHref} className="underline underline-offset-4">{config.linkLabel}</SafeLink>
        )}
      </aside>
    )
  } as never,
})

// ── Link list ───────────────────────────────────────────────────────────────────────────────────

registerModule({
  type: 'global.linkList',
  name: 'Link list',
  category: 'global',
  icon: 'List',
  description: 'A titled column of links, as used in the footer.',
  configVersion: 1,
  a11y: { requiresLabel: true },
  fields: {
    title: { kind: 'text', label: 'Title', default: 'Links', maxLength: 60 },
    layout: {
      kind: 'select', label: 'Arrangement', default: 'column',
      options: [{ value: 'column', label: 'Column' }, { value: 'row', label: 'Row' }],
    },
    items: {
      kind: 'list', label: 'Links', itemLabel: 'Link', max: 20, default: [],
      of: {
        label: { kind: 'text', label: 'Label', default: 'Link', maxLength: 60 },
        href: { kind: 'url', label: 'Destination', default: '/' },
        newTab: { kind: 'boolean', label: 'New tab', default: false },
      },
    },
  },
  Render: function LinkListModule({ config }: ModuleRenderProps<{
    title: string; layout: string; items: { label: string; href: string; newTab: boolean }[]
  }>) {
    if (!config.items.length) return <ModulePlaceholder label="Link list" hint="Add a link in the inspector." />
    return (
      <nav aria-label={config.title}>
        {config.title && <p className="eyebrow mb-2 text-muted-foreground">{config.title}</p>}
        <ul className={cn('flex gap-x-4 gap-y-1', config.layout === 'row' ? 'flex-row flex-wrap' : 'flex-col')}>
          {config.items.map((item, i) => (
            <li key={i}>
              <SafeLink
                href={item.href}
                newTab={item.newTab}
                className="text-sm text-foreground underline-offset-4 hover:underline"
              >
                {item.label}
              </SafeLink>
            </li>
          ))}
        </ul>
      </nav>
    )
  } as never,
})
