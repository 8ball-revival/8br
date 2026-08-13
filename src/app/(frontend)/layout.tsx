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

export default async function FrontendLayout({ children }: { children: React.ReactNode }) {
  // Personal theme, resolved server-side so the correct CSS variables are in the initial HTML on
  // <html> — no flash of the wrong theme, no hydration mismatch. Logged-out visitors get WCC Default.
  const user = await getCurrentUser()
  const pref = user?.theme ?? WCC_DEFAULT_PREFERENCE
  const themeVars = deriveTheme(pref).vars as React.CSSProperties

  return (
    <html
      lang="en"
      suppressHydrationWarning
      data-theme={dataThemeAttr(pref.type)}
      style={themeVars}
      className={`${inter.variable} ${spaceGrotesk.variable} ${jetbrainsMono.variable}`}
    >
      <body className="flex min-h-screen flex-col bg-background text-foreground antialiased">
        <SiteHeader />
        <main className="flex-1">{children}</main>
        <SiteFooter />
      </body>
    </html>
  )
}
