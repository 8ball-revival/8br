/**
 * The competition announcement marquee, as an editable module.
 *
 * ── What this had to preserve ────────────────────────────────────────────────────────────────────
 * The published homepage carries a two-panel diagonal split: WCC on the left with its supplied
 * crest, 8BRCAM on the right leading with type because it has no logo. That exact appearance is the
 * DEFAULT CONFIG below, field for field — the same kickers, titles, statuses, body copy, calls to
 * action, destinations and colour treatments. Turning the builder on does not redesign it, and the
 * first published layout renders byte-for-byte what was there before.
 *
 * ── Why the diagonal is a variable and not a hard-coded polygon ──────────────────────────────────
 * The original clip-path was written for exactly two panels. An administrator adding a third or
 * reordering them would have got overlapping halves. The seam is now computed from the panel count
 * and the configured angle, so two panels reproduce the original geometry and three simply work.
 *
 * ── Why 8BRCAM still has no logo ─────────────────────────────────────────────────────────────────
 * There is a `logoMediaId` field and it is empty for that panel. The module falls back to the
 * wordmark treatment when no logo is chosen, which is the current design — not a placeholder. No
 * mark is invented for a competition that does not have one.
 */

import Image from 'next/image'
import { ArrowRight, ArrowUpRight } from 'lucide-react'

import { cn } from '@/lib/utils'
import { registerModule, type ModuleRenderProps } from '@/lib/site-builder/registry'
import { mediaUrl } from '@/lib/site-builder/media'
import { isExternalUrl } from '@/lib/site-builder/urls'
import { ModulePlaceholder } from './content'

/**
 * The palettes a panel may use.
 *
 * A named theme rather than six free colour pickers. The WCC and 8BRCAM treatments were designed as
 * whole palettes — crimson over deep black with silver and metallic red; teal through ultraviolet
 * with magenta accents — and letting each colour be set independently is how a careful pairing
 * becomes an unreadable one. Adding a palette is a deliberate act, the same as adding a token.
 */
const PANEL_THEMES = {
  wcc: {
    label: 'WCC — crimson on black',
    className: 'sb-marquee-wcc',
    kicker: 'text-[var(--wcc-silver)]',
    status: 'text-[var(--wcc-red)]',
    cta: 'marquee-cta--wcc',
    glow: 'marquee-wcc-glow',
    streaks: 'marquee-streaks',
  },
  brcam: {
    label: '8BRCAM — teal to ultraviolet',
    className: 'sb-marquee-brcam',
    kicker: 'text-[var(--brcam-teal)]',
    status: 'text-[var(--brcam-magenta)]',
    cta: 'marquee-cta--brcam',
    glow: 'marquee-brcam-glow',
    streaks: 'marquee-streaks marquee-streaks--brcam',
  },
  neutral: {
    label: 'Neutral — graphite',
    className: 'sb-marquee-neutral',
    kicker: 'text-muted-foreground',
    status: 'text-[var(--gold)]',
    cta: 'marquee-cta--neutral',
    glow: '',
    streaks: '',
  },
} as const

type ThemeKey = keyof typeof PANEL_THEMES

interface Panel {
  theme: string
  weight: number
  logoMediaId: number | null
  logoPath: string
  logoHeight: number
  bgPath: string
  bgFocal: string
  bgOpacity: number
  wordmark: string
  kicker: string
  title: string
  status: string
  body: string
  ctaLabel: string
  ctaHref: string
  newTab: boolean
}

registerModule({
  type: 'competitions.marquee',
  name: 'Competition marquee',
  category: 'competitions',
  icon: 'Megaphone',
  description: 'The diagonal split announcement. Add, reorder, reweight or replace panels.',
  configVersion: 1,
  a11y: { landmark: true, headingLevel: 2 },
  layoutDefaults: { span: 12 },
  fields: {
    heading: {
      kind: 'text', label: 'Accessible heading', default: 'Upcoming competitions', maxLength: 120,
      help: 'Not shown on screen. Announced to screen readers so the panel is not an unlabelled region.',
    },
    angle: {
      /*
        Six, because that is what the published homepage uses.

        Its clip-path is `polygon(56% 0, 100% 0, 100% 100%, 44% 100%)` -- a midpoint of 50 leaning 6
        either way. The default is a transcription of the site as it stands, not a preference; a
        larger angle looks fine on its own and would have meant the first published layout did not
        match the page it replaced.
      */
      kind: 'number', label: 'Diagonal angle', default: 6, min: 0, max: 30, unit: '%',
      help: 'How far the seam leans. Zero is a straight vertical split.',
    },
    minHeight: { kind: 'number', label: 'Minimum height', default: 440, min: 200, max: 900, unit: 'px' },
    stackBelow: {
      kind: 'select', label: 'Stack the panels below', default: 'md',
      help: 'The width at which panels stop sitting side by side and stack instead.',
      options: [{ value: 'sm', label: 'Small phones only' }, { value: 'md', label: 'Phones (recommended)' }, { value: 'lg', label: 'Phones and tablets' }],
    },
    panels: {
      kind: 'list', label: 'Panels', itemLabel: 'Panel', max: 4,
      /*
        The current published homepage, exactly. Changing anything here changes what a NEW marquee
        starts as; it does not touch a marquee already on a page, because that one stores its own
        config.
      */
      default: [
        {
          theme: 'wcc', weight: 50, logoMediaId: null, logoPath: '/assets/branding/wcc-logo.png', logoHeight: 192,
          wordmark: '', kicker: 'World Cue Championships', title: 'Season 1', status: 'Starting soon',
          body: 'The inaugural season begins soon.',
          ctaLabel: 'Visit WCC website', ctaHref: 'https://www.worldcuechampionships.com/', newTab: true,
        },
        {
          theme: 'brcam', weight: 50, logoMediaId: null, logoPath: '', logoHeight: 192,
          wordmark: '8BRCAM', kicker: '', title: 'Season 2', status: 'Coming soon',
          body: 'Hosted here on 8 Ball Registry.',
          ctaLabel: 'View Season 2 here', ctaHref: '/seasons', newTab: false,
        },
      ],
      of: {
        theme: {
          kind: 'select', label: 'Palette', default: 'neutral',
          options: Object.entries(PANEL_THEMES).map(([value, t]) => ({ value, label: t.label })),
        },
        weight: { kind: 'number', label: 'Relative width', default: 50, min: 10, max: 200, help: 'Panels share the width in proportion to these numbers.' },
        logoMediaId: { kind: 'media', label: 'Logo', default: null, help: 'Choose from the media library. Leave empty to use the file path below, or to lead with the wordmark.' },
        /*
          The WCC crest ships in the repository rather than the media library, and the published
          homepage references it by path. Making the logo media-only would have meant the first
          published layout could not reproduce the site it replaced without someone first
          re-uploading the artwork -- and a re-upload is a re-encode, which is exactly what "save
          this supplied image without modifying it" ruled out.
        */
        logoPath: { kind: 'url', label: 'Or a logo file path', default: '', internalOnly: true, help: 'A file already on the site, such as /assets/branding/wcc-logo.png.' },
        logoHeight: { kind: 'number', label: 'Logo height', default: 192, min: 48, max: 320, unit: 'px', help: 'Ignored when there is no logo.' },
        wordmark: { kind: 'text', label: 'Wordmark', default: '', maxLength: 30, help: 'Used when there is no logo. This is the panel’s mark, so it is set large.' },

        /*
          A photograph behind the panel, beneath the gradient rather than instead of it.

          The panel palettes are what make WCC read as WCC and 8BRCAM as 8BRCAM, and a picture that
          replaced them would take that away. So the image sits under the existing glow and streak
          layers at an editable strength: at 100 it is a photograph with a wash of brand colour over
          it, at 0 it is not there at all and the panel is exactly what it was.
        */
        bgPath: {
          kind: 'url', label: 'Background photograph', default: '', internalOnly: true,
          help: 'A file already on the site, such as /assets/homepage/homepage-8brcam-camera.webp. Leave empty for no photograph.',
        },
        bgFocal: {
          kind: 'text', label: 'Photograph focal point', default: '50% 50%', maxLength: 24,
          help: 'Which part survives the crop, as a CSS object-position. "78% 50%" keeps the right-hand subject.',
        },
        bgOpacity: {
          kind: 'number', label: 'Photograph strength', default: 55, min: 0, max: 100, unit: '%',
          help: 'How far the photograph comes through the panel colour.',
        },
        kicker: { kind: 'text', label: 'Competition label', default: '', maxLength: 80 },
        title: { kind: 'text', label: 'Season label', default: 'Season 1', maxLength: 60 },
        status: { kind: 'text', label: 'Status label', default: 'Coming soon', maxLength: 60 },
        body: { kind: 'text', label: 'Body copy', default: '', maxLength: 300, multiline: true },
        ctaLabel: { kind: 'text', label: 'Button label', default: 'Find out more', maxLength: 60 },
        ctaHref: { kind: 'url', label: 'Button destination', default: '/' },
        newTab: { kind: 'boolean', label: 'Open in a new tab', default: false },
      },
    },
  },
  Render: async function MarqueeModule({ config }: ModuleRenderProps<{
    heading: string; angle: number; minHeight: number; stackBelow: string; panels: Panel[]
  }>) {
    const panels = config.panels ?? []
    if (!panels.length) {
      return <ModulePlaceholder label="Competition marquee" hint="Add a panel in the inspector." />
    }

    // Resolved together rather than inside each panel, so a marquee with three logos still costs one
    // pass rather than three sequential lookups.
    const uploaded = await Promise.all(panels.map((p) => mediaUrl(p.logoMediaId)))
    // A media item wins when one is chosen; otherwise the file path, if there is one. Both are
    // validated -- the path is an internal-only URL field, so it cannot point off-site.
    const logos = panels.map((p, i) => uploaded[i]
      ?? (p.logoPath ? { url: p.logoPath, width: null, height: null, alt: null, id: 0 } : null))

    const total = panels.reduce((sum, p) => sum + Math.max(1, p.weight), 0)
    const stack = config.stackBelow === 'lg' ? 'marquee-stack-lg' : config.stackBelow === 'sm' ? 'marquee-stack-sm' : 'marquee-stack-md'

    /*
      Each panel is clipped to its own slice of the width, and consecutive slices share an edge, so
      there is no seam to tune and no overlap. The lean is applied to the interior edges only —
      the outer edges of the first and last panels stay square against the border.
    */
    let cursor = 0
    const slices = panels.map((p) => {
      const start = cursor
      cursor += (Math.max(1, p.weight) / total) * 100
      return { start, end: cursor }
    })

    return (
      <section
        aria-labelledby="marquee-heading"
        className={cn('marquee cyber-clip relative isolate w-full overflow-hidden border border-[var(--line-strong)]', stack)}
        style={{ ['--marquee-min-h' as string]: `${config.minHeight}px` }}
      >
        <h2 id="marquee-heading" className="sr-only">{config.heading}</h2>
        <div className="marquee-stage grid">
          {panels.map((panel, i) => {
            const theme = PANEL_THEMES[(panel.theme as ThemeKey)] ?? PANEL_THEMES.neutral
            const { start, end } = slices[i]
            const lean = config.angle
            const first = i === 0
            const last = i === panels.length - 1
            const clip = [
              `${first ? 0 : start + lean}% 0%`,
              `${last ? 100 : end + lean}% 0%`,
              `${last ? 100 : end - lean}% 100%`,
              `${first ? 0 : start - lean}% 100%`,
            ].join(', ')
            /*
              Geometry travels as custom properties, not as an inline clip-path.

              An inline style beats a class selector, so a hard-coded `clipPath` here would survive
              every media query -- and the stacked phone layout, which has to CLEAR the diagonal,
              could never override it. Handing the values to CSS lets the breakpoint decide whether
              to use them, which is what makes the panels stack cleanly instead of staying wedged.
            */
            /*
              Clear of the seam at its WORST point, not its average.

              The diagonal for this panel's left edge runs from `start + lean` at the top to
              `start - lean` at the bottom, so content is inside the clipped region for part of its
              height anywhere left of `start + lean`. Sizing the gutter as a fraction of the panel
              width instead -- which is what this did first -- put the 8BRCAM column at 19% on a
              seam that reaches 62%, and the half rendered as an empty gradient with its text
              present in the DOM and invisible on screen. This is the same trap the hand-written
              CSS documented, arrived at from the other direction.
            */
            const padStart = first ? 0 : Math.min(75, start + lean)
            const padEnd = last ? 0 : Math.min(75, 100 - (end - lean))
            const logo = logos[i]
            const external = isExternalUrl(panel.ctaHref)

            const inner = (
              <>
                {/*
                  The photograph is the BOTTOM layer, and it is decorative.

                  It carries no information the panel does not already state in text -- the season,
                  the status and the destination are all written above it -- so it is hidden from
                  assistive technology rather than given an alt that would repeat them. `object-cover`
                  with an editable focal point, because this panel is a different shape at every
                  width and a fixed centre crop loses the subject at the extremes.
                */}
                {panel.bgPath && (
                  <span aria-hidden className="absolute inset-0 -z-10 overflow-hidden">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={panel.bgPath}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      className="size-full object-cover"
                      style={{
                        objectPosition: panel.bgFocal || '50% 50%',
                        opacity: Math.max(0, Math.min(100, panel.bgOpacity ?? 55)) / 100,
                      }}
                    />
                  </span>
                )}
                {theme.glow && <span aria-hidden className={theme.glow} />}
                {theme.streaks && <span aria-hidden className={theme.streaks} />}
                <div className={cn('marquee-wcc-row relative flex items-center gap-5 sm:gap-8', !logo && 'block')}>
                  {logo && (
                    <Image
                      src={logo.url}
                      alt={panel.kicker || panel.title}
                      width={logo.width ?? 770}
                      height={logo.height ?? 790}
                      sizes="(max-width: 640px) 7rem, (max-width: 1024px) 10rem, 14rem"
                      className="marquee-logo w-auto shrink-0"
                      style={{ height: `${panel.logoHeight}px` }}
                    />
                  )}
                  <div className="min-w-0">
                    {panel.wordmark && <p className="marquee-wordmark">{panel.wordmark}</p>}
                    {panel.kicker && <p className={cn('marquee-kicker', theme.kicker)}>{panel.kicker}</p>}
                    {panel.title && <p className="marquee-title text-white">{panel.title}</p>}
                    {panel.status && <p className={cn('marquee-status', theme.status)}>{panel.status}</p>}
                    {panel.body && <p className="marquee-body">{panel.body}</p>}
                    {panel.ctaLabel && (
                      <span className={cn('marquee-cta', theme.cta)}>
                        {panel.ctaLabel}
                        {external
                          ? <ArrowUpRight className="size-3.5 shrink-0" aria-hidden />
                          : <ArrowRight className="size-3.5 shrink-0" aria-hidden />}
                      </span>
                    )}
                  </div>
                </div>
              </>
            )

            const className = cn(
              'marquee-half sb-marquee-panel group relative flex flex-col justify-center gap-1 focus-visible:outline-none',
              theme.className,
            )
            // One link per panel, wrapping the whole half. Nested links inside it would be invalid
            // markup and unreachable by keyboard, so a panel's copy is never itself a link.
            const style = {
              ['--sb-clip' as string]: `polygon(${clip})`,
              ['--sb-pad-start' as string]: `${padStart}%`,
              ['--sb-pad-end' as string]: `${padEnd}%`,
              ['--sb-order' as string]: String(i),
            } as React.CSSProperties

            return external ? (
              <a
                key={i}
                href={panel.ctaHref}
                target={panel.newTab ? '_blank' : undefined}
                rel="noopener noreferrer"
                className={className}
                style={style}
              >
                {inner}
              </a>
            ) : (
              <a key={i} href={panel.ctaHref || '/'} className={className} style={style}>
                {inner}
              </a>
            )
          })}
        </div>
      </section>
    )
  } as never,
})
