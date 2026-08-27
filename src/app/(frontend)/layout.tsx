import type { Metadata, Viewport } from 'next'
import { Inter, Space_Grotesk, JetBrains_Mono } from 'next/font/google'
import React from 'react'

import { HudSettingsPanel } from '@/components/hud-settings'
import { SiteHeader } from '@/components/site-header'
import { DialogProvider } from '@/components/ui/confirm-dialog'
import { SiteFooter } from '@/components/site-footer'
import { SITE_NAME, SITE_TITLE_DEFAULT, SITE_DESCRIPTION, SITE_URL } from '@/lib/site'
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
 * These live on <html> as data-* attributes and one CSS variable, and the stylesheet reads them. It
 * has to run synchronously in <head>: applied from an effect instead, a reader who had turned the
 * glow down or the scanlines off would get one lit frame on every navigation, which is precisely
 * the flash the setting was chosen to avoid.
 *
 * Written defensively — a private-mode browser throws on localStorage, and a display preference
 * failing to load must never take the page down with it.
 */
const hudScript = `try{var d=document.documentElement,s=JSON.parse(localStorage.getItem('8br-hud')||'{}');
d.dataset.hudIntensity=s.intensity||'standard';d.dataset.hudAccent=s.accent||'white';
d.dataset.hudScan=s.scan===false?'off':'on';d.dataset.hudGrid=s.grid===false?'off':'on';
d.dataset.hudMotion=s.motion||'normal';d.dataset.hudAberration=s.aberration?'on':'off';
d.dataset.hudNoise=s.noise===false?'off':'on';d.dataset.hudFlicker=s.flicker?'on':'off';
d.dataset.hudCorners=s.corners||'chamfer';
d.style.setProperty('--hud-glow-user',String((s.glow==null?100:s.glow)/100));}catch(e){}`

export default function FrontendLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${inter.variable} ${spaceGrotesk.variable} ${jetbrainsMono.variable}`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: hudScript }} />
      </head>
      <body className="flex min-h-screen flex-col bg-transparent text-foreground antialiased">
        <DialogProvider>
          <SiteHeader />
          <main className="flex-1">{children}</main>
          <SiteFooter />
          <HudSettingsPanel />
        </DialogProvider>
      </body>
    </html>
  )
}
