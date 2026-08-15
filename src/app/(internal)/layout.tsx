import type { Metadata } from 'next'
import React from 'react'

import '../(frontend)/globals.css'
import { DialogProvider } from '@/components/ui/confirm-dialog'

export const metadata: Metadata = {
  title: 'Internal · World Cue Championships',
  robots: { index: false, follow: false }, // never public/indexed
}

export default function InternalLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-background text-foreground antialiased">
        <DialogProvider>{children}</DialogProvider>
      </body>
    </html>
  )
}
