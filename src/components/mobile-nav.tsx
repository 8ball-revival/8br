'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Menu, X } from 'lucide-react'
// Menu closes via link onClick (below), not a pathname effect.

import { PRIMARY_NAV } from '@/lib/nav'
import { Button } from '@/components/ui/button'
import { SearchBar } from '@/components/search-bar'
import { cn } from '@/lib/utils'

function isActive(pathname: string, href: string) {
  return href === '/' ? pathname === '/' : pathname.startsWith(href)
}

/** Mobile navigation drawer (slide-down panel). */
export function MobileNav({ className, isSignedIn = false }: { className?: string; isSignedIn?: boolean }) {
  const [open, setOpen] = useState(false)
  const pathname = usePathname()

  // Lock scroll while open and close on Escape (keyboard accessibility).
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : ''
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    if (open) document.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = ''
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className={className}>
      <Button
        variant="ghost"
        size="icon"
        aria-label={open ? 'Close menu' : 'Open menu'}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? <X className="size-5" /> : <Menu className="size-5" />}
      </Button>

      {open && (
        <div className="fixed inset-x-0 top-[calc(var(--header-offset,7rem))] bottom-0 z-50 overflow-y-auto border-t border-border bg-background/98 backdrop-blur">
          <div className="mx-auto flex max-w-6xl flex-col gap-1 px-4 py-4">
            <div className="mb-2">
              <SearchBar />
            </div>
            {PRIMARY_NAV.map((item) => {
              const active = isActive(pathname, item.href)
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setOpen(false)}
                  className={cn(
                    'rounded-md px-3 py-3 text-base font-medium transition-colors',
                    active
                      ? 'bg-gold/10 text-gold'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                  )}
                >
                  {item.label}
                </Link>
              )
            })}
            <Link
              href={isSignedIn ? '/account' : '/login'}
              onClick={() => setOpen(false)}
              className="mt-2 rounded-md border border-border px-3 py-3 text-base font-medium text-foreground transition-colors hover:bg-muted"
            >
              {isSignedIn ? 'Account' : 'Sign In'}
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}
