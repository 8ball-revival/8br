import type { Metadata, Viewport } from 'next'
import { Inter, Space_Grotesk, JetBrains_Mono } from 'next/font/google'
import React from 'react'

import { SiteHeader } from '@/components/site-header'
import { SiteFooter } from '@/components/site-footer'
import { SITE_NAME, SITE_TITLE_DEFAULT, SITE_DESCRIPTION, SITE_URL } from '@/lib/site'
import { getCurrentUser } from '@/lib/account/auth'
import { deriveTheme, dataThemeAttr } from '@/lib/theme/theme'
import { WCC_DEFAULT_PREFERENCE } from '@/lib/theme/preference'
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
    template: '%s · World Cue Championships',
  },
  description: SITE_DESCRIPTION,
  applicationName: 'World Cue Championships',
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
  // WCC ships a single committed dark theme.
  themeColor: '#050505',
}

// Runs before the page paints. For SIGNED-IN visitors the account theme is already on <html> (below)
// and `data-theme-source="account"` makes this a no-op. For LOGGED-OUT visitors it applies the theme
// saved in this browser (localStorage) with zero flash. Values are pre-derived hex from our engine;
// it only ever writes CSS custom properties, never arbitrary CSS.
const THEME_BOOT = `(function(){try{var r=document.documentElement;if(r.getAttribute('data-theme-source')==='account')return;var raw=localStorage.getItem('wcc-theme');if(!raw)return;var t=JSON.parse(raw);if(t.attr)r.setAttribute('data-theme',t.attr);var v=t.vars;if(v&&typeof v==='object'){for(var k in v){if(Object.prototype.hasOwnProperty.call(v,k)&&k.charAt(0)==='-'){r.style.setProperty(k,String(v[k]));}}}}catch(e){}})();`

export default async function FrontendLayout({ children }: { children: React.ReactNode }) {
  // Signed-in: resolve the account theme server-side so the correct CSS variables are in the initial
  // HTML on <html> (no flash, no hydration mismatch), and mark it as the authoritative source.
  // Logged-out: <html> is left un-themed here and the boot script applies this browser's saved choice.
  const user = await getCurrentUser()
  const signedIn = Boolean(user)
  const pref = user?.theme ?? WCC_DEFAULT_PREFERENCE
  const themeVars = signedIn ? (deriveTheme(pref).vars as React.CSSProperties) : undefined

  return (
    <html
      lang="en"
      suppressHydrationWarning
      data-theme={signedIn ? dataThemeAttr(pref.type) : undefined}
      data-theme-source={signedIn ? 'account' : undefined}
      style={themeVars}
      className={`${inter.variable} ${spaceGrotesk.variable} ${jetbrainsMono.variable}`}
    >
      <body className="flex min-h-screen flex-col bg-background text-foreground antialiased">
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
        <SiteHeader />
        <main className="flex-1">{children}</main>
        <SiteFooter />
      </body>
    </html>
  )
}
