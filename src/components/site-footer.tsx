import Link from 'next/link'

import { Container } from '@/components/ui/container'
import { Logo } from '@/components/brand'
import { PRIMARY_NAV, SECONDARY_NAV } from '@/lib/nav'

const ACCOUNT = [
  { label: 'Register for Season 2', href: '/register' },
  { label: 'Sign In', href: '/login' },
  { label: 'Your Account', href: '/account' },
]

/** Public site footer: brand + legacy line, compete/archive/account nav, small print. */
export function SiteFooter() {
  const year = new Date().getFullYear()

  return (
    <footer className="mt-24 border-t border-border bg-card/30">
      <Container className="grid gap-10 py-14 md:grid-cols-4">
        <div>
          <Logo href="/" showTagline />
          <p className="mt-4 max-w-xs text-sm text-muted-foreground">
            The next chapter of competitive online 8-ball — preserving over two decades of history
            while building the future of the game.
          </p>
          <p className="mt-4 text-xs text-muted-foreground">Formerly known as 8BRCAM</p>
        </div>

        <nav aria-label="Compete">
          <h3 className="eyebrow mb-4 text-muted-foreground">Compete</h3>
          <ul className="space-y-2.5 text-sm">
            {PRIMARY_NAV.filter((i) => i.href !== '/').map((item) => (
              <li key={item.href}>
                <Link href={item.href} className="text-muted-foreground transition-colors hover:text-foreground">
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <nav aria-label="Account">
          <h3 className="eyebrow mb-4 text-muted-foreground">Account</h3>
          <ul className="space-y-2.5 text-sm">
            {ACCOUNT.map((item) => (
              <li key={item.href}>
                <Link href={item.href} className="text-muted-foreground transition-colors hover:text-foreground">
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <nav aria-label="Archive">
          <h3 className="eyebrow mb-4 text-muted-foreground">Archive &amp; Records</h3>
          <ul className="space-y-2.5 text-sm">
            {SECONDARY_NAV.map((item) => (
              <li key={item.href}>
                <Link href={item.href} className="text-muted-foreground transition-colors hover:text-foreground">
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </Container>

      <div className="border-t border-border">
        <Container className="flex flex-col items-center justify-between gap-2 py-5 text-xs text-muted-foreground sm:flex-row">
          <p>© {year} 8 Ball Revival</p>
          <p>Formerly known as 8BRCAM</p>
        </Container>
      </div>
    </footer>
  )
}
