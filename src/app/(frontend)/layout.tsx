import type { Metadata, Viewport } from 'next'
import { Inter, Space_Grotesk, JetBrains_Mono, Barlow_Condensed } from 'next/font/google'
import React from 'react'

import { DisplayRuntime } from '@/components/display/display-runtime'
import { SiteHeader } from '@/components/site-header'
import { DialogProvider } from '@/components/ui/confirm-dialog'
import { SiteFooter } from '@/components/site-footer'
import { SITE_NAME, SITE_TITLE_DEFAULT, SITE_DESCRIPTION, SITE_URL } from '@/lib/site'
import { DISPLAY_DEFAULTS, DISPLAY_KEY, DOM_SPEC } from '@/lib/display/settings'
import { getTheme } from '@/lib/site-builder/globals'
import './globals.css'

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' })
const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  variable: '--font-space-grotesk',
  display: 'swap',
})
const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jetbrains',
  display: 'swap',
})

/*
 * The condensed face the redesign is set in.
 *
 * Weights are declared rather than left to `next/font` guessing, because the design uses three of
 * them at very different sizes -- 600 for eyebrows and labels, 700 for section headings, 800 for the
 * champion's name and the record figure -- and a missing weight is what produces faux bold, which
 * on a condensed face at 96px is unmistakable.
 *
 * The italic is loaded because the approved composition uses it in exactly one place (the
 * champion's real name beneath their ID). Loading it up front rather than synthesising it is the
 * difference between a drawn italic and a sheared roman.
 *
 * `display: 'swap'` with a metric-matched fallback below keeps the layout still: the fallback is
 * declared with `size-adjust` in globals.css so the swap does not move anything.
 */
const barlowCondensed = Barlow_Condensed({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  style: ['normal', 'italic'],
  variable: '--font-barlow-condensed',
  display: 'swap',
})

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: SITE_TITLE_DEFAULT,
    template: '%s · 8 Ball Registry',
  },
  description: SITE_DESCRIPTION,
  applicationName: '8 Ball Registry',
  // No default canonical here: each page sets its own so pages never wrongly
  // claim to be a duplicate of the homepage.
  openGraph: {
    type: 'website',
    siteName: SITE_NAME,
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
    url: SITE_URL,
    locale: 'en_US',
  },
  twitter: {
    card: 'summary_large_image',
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
  },
}

export const viewport: Viewport = {
  // Dark is the default; light is opt-in via the header toggle.
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#000000' },
    { media: '(prefers-color-scheme: light)', color: '#fafafa' },
  ],
}

/*
 * The display settings, applied before the first paint.
 *
 * ── Why this has to be an inline script in <head> ────────────────────────────────────────────────
 * The settings live on <html> as `data-dl-*` attributes and `--dl-*` variables, and the stylesheet
 * reads them. Applied from an effect instead, a reader who had turned the glow down, chosen a dark
 * frame or set a background would get one frame of the default appearance on every navigation —
 * precisely the flash the setting was chosen to avoid.
 *
 * ── Why it is an interpreter rather than a transcription ─────────────────────────────────────────
 * The palette is validated again here rather than trusted.
 *
 * This reads localStorage, which is under the reader's control and survives across versions of this
 * code. `tokenVars` cannot run in the pre-paint script -- it is a module, and this is a string
 * inlined before any module loads -- so the same hex rule is restated as a literal regular
 * expression. Anything else is skipped rather than written, so a hand-edited storage entry cannot
 * put an arbitrary declaration into the style attribute of <html>.
 *
 * It walks DOM_SPEC, the same object `displayDom()` walks. A hand-written copy of "intensity becomes
 * data-dl-intensity, glow becomes --dl-glow over a hundred" is a copy, and a copy drifts the first
 * time a control is added — silently, because the only symptom is a flash on load that nobody
 * reproduces. Six lines of loop over one shared definition cannot drift, and `verify-display-lab`
 * asserts every field in the spec is covered by both.
 *
 * ── What it does not do ──────────────────────────────────────────────────────────────────────────
 * It does not validate, and it does not migrate. An out-of-range or unknown stored value produces an
 * attribute no rule matches, or an invalid custom property the parser discards, and both fall back
 * to the declared default — so the worst case is the official appearance. React re-applies the
 * validated settings on mount, and carries an old `8br-hud` configuration across then, which costs a
 * single frame once per browser rather than a second implementation of the migration in here.
 *
 * Written defensively throughout: a private-mode browser throws on localStorage, and a display
 * preference failing to load must never take the page down with it.
 */
const displayScript = `try{var S=${JSON.stringify(DOM_SPEC)},D=${JSON.stringify(DISPLAY_DEFAULTS)},e=document.documentElement,s={};
try{s=JSON.parse(localStorage.getItem(${JSON.stringify(DISPLAY_KEY)})||'{}')}catch(x){}
if(!s||typeof s!=='object'||Array.isArray(s))s={};
var v=function(k){return s[k]===undefined||s[k]===null?D[k]:s[k]};
for(var a in S.attrs)e.dataset[a]=String(v(S.attrs[a]));
for(var b in S.bools)e.dataset[b]=v(S.bools[b])?'on':'off';
for(var w in S.onWhenPositive)e.dataset[w]=Number(v(S.onWhenPositive[w]))>0?'on':'off';
for(var n in S.nums)e.style.setProperty(n,String(Number(v(S.nums[n][0]))/S.nums[n][1]));
for(var p in S.px)e.style.setProperty(p,Number(v(S.px[p][0]))+S.px[p][1]);
var T=s.tokens;
if(T&&typeof T==='object'&&!Array.isArray(T)){for(var t in S.tokens){var tv=T[t];
if(typeof tv==='string'&&/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(tv))e.style.setProperty(S.tokens[t],tv);}}
if(v('accentMode')==='custom'){e.style.setProperty('--dl-accent',String(v('accentHex')));e.style.setProperty('--dl-accent-ink',String(v('accentInk')));}
}catch(err){}`

/**
 * The published theme, applied as server-rendered custom properties.
 *
 * ── Why it sits UNDER Display Lab rather than beside it ──────────────────────────────────────────
 * Display Lab is the visitor's own appearance, applied to <html> before first paint from their
 * localStorage. The site theme is the administrator's, and it must not fight it: a reader who has
 * chosen a dark frame keeps it. So the theme is written to <body>, one level further in, where it
 * sets the site's defaults and anything the visitor has personally chosen still wins by being on the
 * more specific element. Two layers, two owners, no contest.
 *
 * ── Why it cannot reach the admin console ───────────────────────────────────────────────────────
 * This is the FRONTEND layout only. Payload's admin and the staff console render through a separate
 * root layout that never reads this, so a published theme cannot make the controls needed to undo it
 * unreadable. That is the whole reason the two layouts stay separate.
 */
export default async function FrontendLayout({ children }: { children: React.ReactNode }) {
  // Never throws and never blocks: an unreadable theme is no theme, and the site renders as built.
  const theme = await getTheme().catch(() => ({ vars: {}, fontDisplay: 'space-grotesk' }))
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${inter.variable} ${spaceGrotesk.variable} ${jetbrainsMono.variable} ${barlowCondensed.variable}`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: displayScript }} />
      </head>
      <body
        className="flex min-h-screen flex-col bg-transparent text-foreground antialiased"
        style={Object.keys(theme.vars).length ? (theme.vars as React.CSSProperties) : undefined}
      >
        <DialogProvider>
          <SiteHeader />
          <main className="flex-1">{children}</main>
          <SiteFooter />
          {/*
            The decorative layers: background, film grain and vignette.

            Rendered on the server and hidden by CSS unless their attribute says otherwise, so they
            are never a hydration mismatch and never a frame of the wrong appearance. Each is
            `aria-hidden` and `pointer-events: none` — a decoration must not be announced to a screen
            reader, and must not be able to cover a control.
          */}
          <div className="dl-bg-layer" aria-hidden>
            <div className="dl-bg-image" />
            <div className="dl-bg-scrim" />
          </div>
          <div className="dl-grain-layer" aria-hidden />
          <div className="dl-vignette-layer" aria-hidden />
          <DisplayRuntime />
        </DialogProvider>
      </body>
    </html>
  )
}
