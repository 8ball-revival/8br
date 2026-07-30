import type { Metadata, Viewport } from 'next'
import { Inter, Space_Grotesk, JetBrains_Mono } from 'next/font/google'
import React from 'react'

import { SiteHeader } from '@/components/site-header'
import { SiteFooter } from '@/components/site-footer'
import { PreviewNotice } from '@/components/preview-notice'
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
    template: '%s · 8 Ball Revival',
  },
  description: SITE_DESCRIPTION,
  applicationName: '8 Ball Revival',
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
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#12131a' },
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
  ],
}

// Set the theme class before paint to avoid a flash. Dark is the default (no class);
// only an explicit "light" preference adds the `.light` class.
const themeScript = `
try {
  var t = localStorage.getItem('8ball-theme');
  if (t === 'light') document.documentElement.classList.add('light');
} catch (e) {}
`

export default function FrontendLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${inter.variable} ${spaceGrotesk.variable} ${jetbrainsMono.variable}`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="flex min-h-screen flex-col bg-background text-foreground antialiased">
        <PreviewNotice />
        <SiteHeader />
        <main className="flex-1">{children}</main>
        <SiteFooter />
      </body>
    </html>
  )
}
