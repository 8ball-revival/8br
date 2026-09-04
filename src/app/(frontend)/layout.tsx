import type { Metadata, Viewport } from 'next'
import { Inter, Space_Grotesk, JetBrains_Mono, Barlow_Condensed } from 'next/font/google'
import { headers as nextHeaders } from 'next/headers'
import { redirect } from 'next/navigation'
import React from 'react'

import { DisplayRuntime } from '@/components/display/display-runtime'
import { SiteHeader } from '@/components/site-header'
import { DialogProvider } from '@/components/ui/confirm-dialog'
import { SiteFooter } from '@/components/site-footer'
import { SITE_NAME, SITE_TITLE_DEFAULT, SITE_DESCRIPTION, SITE_URL } from '@/lib/site'
import { DISPLAY_DEFAULTS, DISPLAY_KEY, DOM_SPEC } from '@/lib/display/settings'
import { getTheme } from '@/lib/site-builder/globals'
import { PATHNAME_HEADER, PRIVATE_ACCESS_PATH, SEARCH_HEADER, isPublicPath, privateAccessTarget } from '@/lib/auth/site-privacy'
import { safeReturnTo } from '@/lib/account/return-to'
import { hasSiteAccess } from '@/lib/auth/require-viewer'
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
  /*
    Every page in this tree is private, so none of it may be indexed.

    Set at the root so a page added later inherits it without anyone remembering to. Individual
    pages that already pass `index: false` through `pageMetadata()` keep doing so; this is the floor,
    not a replacement. The same instruction is sent as an `X-Robots-Tag` header by the middleware,
    because a header reaches a crawler that never parses the document — and a redirect to the door
    has no <head> for a meta tag to live in.
  */
  robots: { index: false, follow: false, nocache: true, noarchive: true, nosnippet: true },
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
var gv=(T&&typeof T==='object'&&typeof T.void==='string')?T.void:'#050607';
try{var gm=/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(gv.trim());
if(gm){var gh=gm[1].length===3?gm[1].replace(/./g,function(c){return c+c}):gm[1];
var ch=function(x){x/=255;return x<=0.03928?x/12.92:Math.pow((x+0.055)/1.055,2.4)};
var gl=0.2126*ch(parseInt(gh.slice(0,2),16))+0.7152*ch(parseInt(gh.slice(2,4),16))+0.0722*ch(parseInt(gh.slice(4,6),16));
e.dataset.dlGround=gl>0.4?'light':'dark';}else{e.dataset.dlGround='dark';}}catch(g){e.dataset.dlGround='dark';}
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
  /*
    ── The second half of the privacy wall ────────────────────────────────────────────────────────

    The middleware has already refused this request unless it carried a real, unexpired session
    token. What it could not check is whether the ACCOUNT behind that token is still allowed in — a
    member banned a minute ago holds a token that is cryptographically perfect. That is a database
    question, so it is answered here, in the layout, BEFORE any page in this tree renders. There is
    no client-side redirect and no hidden content: a visitor without access never receives the
    markup at all.

    The path comes from the header the middleware set from `request.nextUrl`, never from an incoming
    header — a client that could name its own path could name an allowlisted one.

    Public paths are skipped, which is what stops the loop: the private-access page lives in this
    same layout, and guarding it would redirect it to itself.
  */
  const requestHeaders = await nextHeaders()
  const pathname = requestHeaders.get(PATHNAME_HEADER) ?? ''
  const isPublic = isPublicPath(pathname, { dev: process.env.NODE_ENV !== 'production' })
  /* The door renders without the site's own chrome — see the note beside <SiteHeader />. */
  const bare = pathname === PRIVATE_ACCESS_PATH

  if (bare) {
    /*
      Somebody who is already signed in has no business on the door.

      Sent onward from HERE rather than from the middleware, and that is the whole point: the
      middleware can only see that a token is valid, so it would also bounce a BANNED member off the
      door and into the site — where this same guard would bounce them straight back. That is an
      infinite loop, and it is avoided by making the decision only where the account's standing is
      actually known.

      A layout redirect is also a real 307, because it happens before the response is flushed.
    */
    if (await hasSiteAccess()) {
      redirect(safeReturnTo(new URLSearchParams(requestHeaders.get(SEARCH_HEADER) ?? '').get('returnTo'), '/'))
    }
  } else if (!isPublic && !(await hasSiteAccess())) {
    redirect(privateAccessTarget(pathname))
  }

  // Never throws and never blocks: an unreadable theme is no theme, and the site renders as built.
  const theme = await getTheme().catch(() => ({ vars: {}, fontDisplay: 'space-grotesk' }))

  /*
    ── Why the published theme is a `:root` rule and not a style attribute ────────────────────────

    It used to be an inline style on <body>, which put it BELOW <html> in the tree and therefore
    above it in the cascade — so a published theme silently beat the Owner's own preview, and the
    Palette tab appeared to stop working the moment anything was published.

    As a `:root` rule it is a stylesheet declaration, and Display Lab's inline properties on <html>
    beat it by specificity rather than by nesting. That is the whole layering:

        :root { … }        the published theme, server-rendered, every visitor
        <html style="…">   the Owner's preview or saved draft, this browser only

    It is rendered into <head> ahead of the pre-paint script, so a public visitor has the published
    values before the first paint — no flash of the built-in theme, and nothing for React to
    reconcile, because the markup is identical on the server and the client.

    The values reaching this string have been through `tokenVars`: registry-declared properties with
    plain hex values, nothing else. That is what makes it safe to inline as CSS text.
  */
  const publishedCss = Object.entries(theme.vars)
    .map(([prop, value]) => `${prop}:${value}`)
    .join(';')

  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${inter.variable} ${spaceGrotesk.variable} ${jetbrainsMono.variable} ${barlowCondensed.variable}`}
    >
      <head>
        {publishedCss && (
          <style
            data-published-theme=""
            dangerouslySetInnerHTML={{ __html: `:root{${publishedCss}}` }}
          />
        )}
        <script dangerouslySetInnerHTML={{ __html: displayScript }} />
      </head>
      <body className="flex min-h-screen flex-col bg-transparent text-foreground antialiased">
        <DialogProvider>
          {/*
            The private-access page renders without header or footer.

            Both are navigation into pages a logged-out visitor cannot open, so every link would
            bounce straight back to the door — and the header also resolves the current account,
            which is a query the door has no use for.
          */}
          {bare ? (
            <main className="flex-1">{children}</main>
          ) : (
            <>
              <SiteHeader />
              <main className="flex-1">{children}</main>
              <SiteFooter />
            </>
          )}
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
