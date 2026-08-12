import type { Metadata } from 'next'
import React from 'react'

import '../(frontend)/globals.css'

export const metadata: Metadata = {
  title: 'Internal · 8 Ball Revival',
  robots: { index: false, follow: false }, // never public/indexed
}

export default function InternalLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-background text-foreground antialiased">{children}</body>
    </html>
  )
}
