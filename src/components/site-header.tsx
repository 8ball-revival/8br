import Link from 'next/link'
import { ChevronDown, LogOut } from 'lucide-react'

import { Logo } from '@/components/brand'
import { MainNav } from '@/components/main-nav'
import { MobileNav } from '@/components/mobile-nav'
import { Button } from '@/components/ui/button'
import { ThemeToggle } from '@/components/theme-toggle'
import { getCurrentUser } from '@/lib/account/auth'
import { getSiteBranding } from '@/lib/site-content/service'
import { signOut } from '@/lib/account/actions'
import { isStaff } from '@/lib/auth/roles'
import type { NavItem } from '@/lib/nav'

/** Sticky public header: brand, primary nav, and the signed-in user / sign-in control. */
export async function SiteHeader() {
  // Branding is admin-managed (published version only); `getSiteBranding` falls back to the
  // built-in identity so the header still renders before anything is published.
  const [user, branding] = await Promise.all([getCurrentUser(), getSiteBranding()])
  // Staff-only Admin entry, appended after the public nav (Home · Seasons · Tournaments · Ladder · …).
  const staffItems: NavItem[] = user && isStaff(user.roles) ? [{ label: 'Admin', href: '/staff' }] : []
  // Display policy: Preferred Name when present, otherwise the CueVerse ID (the account identity).
  // Never a separate "username" — that is only the internal login key.
  const displayName = user ? (user.preferredName || user.cueverseId || user.username) : ''
  const cueverse = user ? (user.cueverseId || user.username) : ''
  return (
    <header className="sticky top-0 z-40 w-full border-b border-nav-border bg-nav-bg/85 text-nav-foreground backdrop-blur supports-[backdrop-filter]:bg-nav-bg/70">
      <div className="mx-auto flex h-16 w-full max-w-[96rem] items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-8">
          <Logo
            siteName={branding.siteName}
            logoUrl={branding.logoUrl}
            logoWidth={branding.logoWidth}
            logoHeight={branding.logoHeight}
            logoAlt={branding.logoAlt}
          />
          <MainNav className="hidden xl:flex" extraItems={staffItems} />
        </div>

        <div className="flex items-center gap-1">
          {/* Light / dark theme toggle, beside the account button / Sign In. */}
          <ThemeToggle />
          {user ? (
            <details className="group relative ml-1">
              <summary className="flex cursor-pointer list-none items-center gap-2 rounded-md py-1 pl-1 pr-2 transition-colors hover:bg-accent [&::-webkit-details-marker]:hidden">
                <span
                  aria-hidden
                  className="flex size-8 items-center justify-center rounded-full bg-gradient-to-br from-brand-soft/40 to-brand-dim/40 text-xs font-bold text-foreground ring-1 ring-border"
                >
                  {displayName.slice(0, 2).toUpperCase()}
                </span>
                <span className="hidden text-sm font-medium sm:block">{displayName}</span>
                <ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180" />
              </summary>
              <div className="absolute right-0 z-50 mt-2 w-52 overflow-hidden rounded-md border border-border bg-popover p-1 shadow-lg">
                <p className="truncate px-3 py-2 text-xs text-muted-foreground">
                  Signed in as <span className="font-semibold text-foreground">@{cueverse}</span>
                </p>
                <Link href="/account" className="block rounded-sm px-3 py-2 text-sm hover:bg-accent">
                  Account Settings
                </Link>
                <div className="my-1 h-px bg-border" role="separator" aria-hidden />
                <form action={signOut}>
                  <button
                    type="submit"
                    className="flex w-full items-center gap-2 rounded-sm px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:bg-destructive/10 focus-visible:text-destructive focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-destructive"
                  >
                    <LogOut className="size-4" aria-hidden />
                    Sign Out
                  </button>
                </form>
              </div>
            </details>
          ) : (
            <Button asChild variant="outline" size="sm" className="ml-1 hidden sm:inline-flex">
              <Link href="/login">Sign In</Link>
            </Button>
          )}

          <MobileNav className="xl:hidden" isSignedIn={Boolean(user)} extraItems={staffItems} />
        </div>
      </div>
    </header>
  )
}
