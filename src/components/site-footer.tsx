import Link from 'next/link'
import { MessageCircle, AtSign, Video, Camera, type LucideIcon } from 'lucide-react'

import { FOOTER_LINKS } from '@/lib/nav'

// Placeholder social icons (lucide dropped brand logos; real links added later).
const SOCIAL: Array<{ label: string; href: string; icon: LucideIcon }> = [
  { label: 'Discord', href: '#', icon: MessageCircle },
  { label: 'X', href: '#', icon: AtSign },
  { label: 'YouTube', href: '#', icon: Video },
  { label: 'Instagram', href: '#', icon: Camera },
]

/** Slim dark footer: copyright, placeholder legal/links, social icons. */
export function SiteFooter() {
  const year = new Date().getFullYear()
  return (
    <footer className="mt-16 border-t border-nav-border bg-nav-bg/40">
      <div className="mx-auto flex w-full max-w-[96rem] flex-col items-center gap-4 px-4 py-6 text-sm sm:px-6 lg:flex-row lg:justify-between lg:gap-6 lg:px-8">
        <p className="text-xs text-muted-foreground">
          © {year} 8 Ball Registry. All rights reserved.
        </p>

        <nav aria-label="Footer" className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
          {FOOTER_LINKS.map((l) => (
            <Link
              key={l.label}
              href={l.href}
              className="text-xs font-medium uppercase tracking-wide text-muted-foreground transition-colors hover:text-foreground"
            >
              {l.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-1">
          {SOCIAL.map((s) => {
            const Icon = s.icon
            return (
              <Link
                key={s.label}
                href={s.href}
                aria-label={s.label}
                className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <Icon className="size-4" />
              </Link>
            )
          })}
        </div>
      </div>
    </footer>
  )
}
