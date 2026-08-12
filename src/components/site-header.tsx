import Link from 'next/link'
import { ChevronDown } from 'lucide-react'

import { Logo } from '@/components/brand'
import { MainNav } from '@/components/main-nav'
import { MobileNav } from '@/components/mobile-nav'
import { Button } from '@/components/ui/button'
import { getCurrentUser } from '@/lib/account/auth'

/** Sticky public header: brand, primary nav, and the signed-in user / sign-in control. */
export async function SiteHeader() {
  const user = await getCurrentUser()
  return (
    <header className="sticky top-0 z-40 w-full border-b border-border bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70">
      <div className="mx-auto flex h-16 w-full max-w-[96rem] items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-8">
          <Logo />
          <MainNav className="hidden xl:flex" />
        </div>

        <div className="flex items-center gap-1">
          {user ? (
            <details className="group relative ml-1">
              <summary className="flex cursor-pointer list-none items-center gap-2 rounded-md py-1 pl-1 pr-2 transition-colors hover:bg-accent [&::-webkit-details-marker]:hidden">
                <span
                  aria-hidden
                  className="flex size-8 items-center justify-center rounded-full bg-gradient-to-br from-brand-soft/40 to-brand-dim/40 text-xs font-bold text-foreground ring-1 ring-border"
                >
                  {user.username.slice(0, 2).toUpperCase()}
                </span>
                <span className="hidden text-sm font-medium sm:block">{user.username}</span>
                <ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180" />
              </summary>
              <div className="absolute right-0 z-50 mt-2 w-52 overflow-hidden rounded-md border border-border bg-popover p-1 shadow-lg">
                <p className="truncate px-3 py-2 text-xs text-muted-foreground">
                  Signed in as <span className="font-semibold text-foreground">{user.username}</span>
                </p>
                <Link href="/account" className="block rounded-sm px-3 py-2 text-sm hover:bg-accent">
                  Account Settings
                </Link>
              </div>
            </details>
          ) : (
            <Button asChild variant="outline" size="sm" className="ml-1 hidden sm:inline-flex">
              <Link href="/login">Sign In</Link>
            </Button>
          )}

          <MobileNav className="xl:hidden" isSignedIn={Boolean(user)} />
        </div>
      </div>
    </header>
  )
}
