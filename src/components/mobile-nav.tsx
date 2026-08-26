'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LogOut, Menu, X } from 'lucide-react'
// Menu closes via link onClick (below), not a pathname effect.

import { type NavItem } from '@/lib/nav'
import { Button } from '@/components/ui/button'
import { signOut } from '@/lib/account/actions'
import { cn } from '@/lib/utils'

function isActive(pathname: string, href: string) {
  return href === '/' ? pathname === '/' : pathname.startsWith(href)
}

/** Mobile navigation drawer (slide-down panel). */
export function MobileNav({ entries, className, isSignedIn = false, extraItems = [] }: { entries: NavItem[]; className?: string; isSignedIn?: boolean; extraItems?: NavItem[] }) {
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
            {[...entries, ...extraItems].map((entry) => {
              const active = isActive(pathname, entry.href)
              return (
                <Link
                  key={entry.href}
                  href={entry.href}
                  onClick={() => setOpen(false)}
                  className={cn(
                    'rounded-md px-3 py-3 text-base font-medium transition-colors',
                    active
                      ? 'bg-primary/10 text-primary'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                  )}
                >
                  {entry.label}
                </Link>
              )
            })}
            <Link
              href={isSignedIn ? '/account' : '/login'}
              onClick={() => setOpen(false)}
              className="mt-2 rounded-none border border-border px-3 py-3 text-base font-medium text-foreground transition-colors hover:bg-muted"
            >
              {isSignedIn ? 'Account Settings' : 'Sign In'}
            </Link>
            {isSignedIn && (
              <form action={signOut}>
                <button
                  type="submit"
                  onClick={() => setOpen(false)}
                  className="mt-1 flex w-full items-center gap-2 rounded-none border border-border px-3 py-3 text-base font-medium text-foreground transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-destructive"
                >
                  <LogOut className="size-5" aria-hidden /> Sign Out
                </button>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
