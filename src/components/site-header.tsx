import Link from 'next/link'

import { Container } from '@/components/ui/container'
import { Logo } from '@/components/brand'
import { MainNav } from '@/components/main-nav'
import { MobileNav } from '@/components/mobile-nav'
import { SearchBar } from '@/components/search-bar'
import { ThemeToggle } from '@/components/theme-toggle'
import { Button } from '@/components/ui/button'
import { getCurrentUser } from '@/lib/account/auth'

/** Sticky public site header: brand, primary nav, search, theme toggle, mobile menu. */
export async function SiteHeader() {
  const user = await getCurrentUser()
  return (
    <header className="sticky top-0 z-40 w-full border-b border-border bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/70">
      <Container className="flex h-16 items-center justify-between gap-4">
        <Logo />
        <MainNav className="hidden lg:flex" />
        <div className="flex items-center gap-1.5">
          <SearchBar className="hidden w-56 md:block" />
          <ThemeToggle />
          {user ? (
            <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
              <Link href="/account">Account</Link>
            </Button>
          ) : (
            <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
              <Link href="/login">Sign In</Link>
            </Button>
          )}
          <MobileNav className="lg:hidden" isSignedIn={Boolean(user)} />
        </div>
      </Container>
    </header>
  )
}
