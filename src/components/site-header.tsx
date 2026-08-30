import Link from 'next/link'
import { Wide } from '@/components/primitives'
import { ChevronDown, LogOut } from 'lucide-react'

import { Logo } from '@/components/brand'
import { MainNav } from '@/components/main-nav'
import { DisplayLab } from '@/components/display/display-lab'
import { MobileNav } from '@/components/mobile-nav'
import { getCurrentUser } from '@/lib/account/auth'
import { SessionKeepalive } from '@/components/account/session-keepalive'
import { getSiteBranding } from '@/lib/site-content/service'
import { signOut } from '@/lib/account/actions'
import { isStaff } from '@/lib/auth/roles'
import { buildNav, type NavItem } from '@/lib/nav'
import { getNavigation, getBanner, visibleLinks, ensureRecoveryLinks } from '@/lib/site-builder/globals'
import { SiteBanner } from '@/components/site-builder/site-banner'
import { canSeeCreator } from '@/lib/creator/access'
import { EditModeButton } from '@/components/site-builder/edit-mode-button'
import { canEditSite } from '@/components/site-builder/edit-mode'
import { FACTORY_PAGES } from '@/lib/site-builder/factory'

/** Sticky public header: brand, primary nav, and the signed-in user / sign-in control. */
export async function SiteHeader() {
  // Branding is admin-managed (published version only); `getSiteBranding` falls back to the
  // built-in identity so the header still renders before anything is published.
  const [user, branding, creator, mayEditSite, nav, banner] = await Promise.all([
    getCurrentUser(), getSiteBranding(), canSeeCreator(), canEditSite(), getNavigation(), getBanner(),
  ])
  const staff = !!user && isStaff(user.roles)
  // Staff-only Admin entry, appended after the public nav.
  // Admin is added by ensureRecoveryLinks now, so the old extra-items list is empty and kept
  // only so the two nav components keep their existing prop shape.
  const staffItems: NavItem[] = []
  /*
    Which routes the Edit button may appear on.
    Read from the factory list rather than hard-coded, so a page added to the builder becomes
    editable from the header without this file being touched -- and, more importantly, so the button
    never appears on a page that has no layout behind it, where it would open an empty toolbar and
    read as the feature being broken.
  */
  const builderRoutes = FACTORY_PAGES.filter((p) => p.kind === 'STATIC').map((p) => p.key)
  // Home · Seasons · Cups · Creator? · Rankings · News · Admin?
  // Creator is gated on the competition-management capability, which is not the same permission as
  // "is staff" — an editor is staff and has no business creating competitions. This only decides
  // whether the item is DRAWN; every Creator route re-checks for itself.
  /*
    The published navigation, with the built-in one as its floor.

    `getNavigation` already falls back when nothing is published or the document cannot be read, so
    this cannot produce a header with no links. Creator is appended rather than published because it
    is gated on a capability rather than on a choice — an administrator should not have to remember
    to add it, and should not be able to remove it from somebody who has the capability.

    Admin and Site Builder are NOT here. They are in the account menu below and in the mobile menu,
    both of which are reachable at every width and neither of which the published navigation can
    remove. That is what makes a broken navigation recoverable from the browser.
  */
  const viewer = { signedIn: !!user, isStaff: staff, isOwner: mayEditSite }
  // Filter for this viewer first, then guarantee the recovery routes, then map to the shape the two
  // nav components take. Doing it in that order means the recovery links cannot be filtered out by
  // an audience rule they were never given.
  const navEntries: NavItem[] = visibleLinks(nav.items, viewer, 'desktop')
    .map((l) => ({
      label: l.label,
      href: l.href,
      mobileLabel: l.mobileLabel,
      newTab: l.newTab,
      badge: l.badge || undefined,
      icon: l.icon || undefined,
      children: l.children.length
        ? l.children.map((c) => ({ label: c.label, href: c.href, newTab: c.newTab }))
        : undefined,
    }))
  if (creator && !navEntries.some((i) => i.href === '/creator')) {
    navEntries.splice(3, 0, { label: 'Creator', href: '/creator' })
  }
  void buildNav
  // Display policy: Preferred Name when present, otherwise the CueVerse ID (the account identity).
  // Never a separate "username" — that is only the internal login key.
  const displayName = user ? (user.preferredName || user.cueverseId || user.username) : ''
  const cueverse = user ? (user.cueverseId || user.username) : ''
  return (
    // `data-site-header` is the hook the Season control bar measures itself against, so a bar that
    // clamps beneath this one tracks the REAL rendered height rather than a hardcoded guess that
    // would drift the moment the header wraps or changes at a breakpoint.
    <>
    {/* Signed-in only: nothing to keep alive otherwise. See SessionKeepalive. */}
    {user && <SessionKeepalive />}
    {/* Above the header, because that is what a site-wide notice means. */}
    {banner && <SiteBanner banner={banner} />}
    <header
      data-site-header
      /*
       * The bar the whole site hangs from, and the largest single piece of acid in the interface.
       *
       * Solid, never translucent: it used to be painted at 85% alpha over the page, and a warm
       * colour at partial alpha over a dark ground reads olive rather than yellow. It is a surface
       * now, so it is opaque, it carries black ink, and its lower edge is the red rule that marks
       * every structural boundary on the site.
       */
      className="sticky top-0 z-50 w-full border-b-2 border-nav-border bg-nav-bg text-nav-foreground"
    >
      <Wide name="header" className="flex h-16 items-center justify-between gap-4">
        <div className="flex items-center gap-8">
          {/* The mark is a tracked asset inside Logo; the wordmark and its alt stay admin-managed. */}
          <Logo siteName={branding.siteName} logoAlt={branding.logoAlt} />
          {/*
            The red bars from the design: two short angled strokes flanking the navigation.

            Decorative, so aria-hidden. Drawn as skewed divs rather than an image so they stay crisp
            at any zoom and take the accent colour with the rest of the interface. Hidden below xl
            because that is where the navigation itself collapses into the mobile menu and there is
            nothing left for them to flank.
          */}
          <span aria-hidden className="hidden items-center gap-1 xl:flex">
            <span className="block h-6 w-[3px] -skew-x-[20deg] bg-[var(--hot-red)]" />
            <span className="block h-6 w-[3px] -skew-x-[20deg] bg-[var(--hot-red)] opacity-60" />
          </span>

          <MainNav className="hidden xl:flex" entries={navEntries} extraItems={staffItems} />
        </div>

        <div className="flex items-center gap-1">
          <span aria-hidden className="mr-3 hidden items-center gap-1 lg:flex">
            <span className="block h-6 w-[3px] -skew-x-[20deg] bg-[var(--hot-red)] opacity-60" />
            <span className="block h-6 w-[3px] -skew-x-[20deg] bg-[var(--hot-red)]" />
          </span>

          {/*
            Where the LIVE badge and clock used to sit.

            They were chrome that said only "this page is being served now", occupying the most
            valuable slot in the header on every page. Both moved into Display Lab's System Status
            section, and the slot now holds the control that opens it — which is reachable at every
            width, unlike the badge, which was hidden below 1024px.
          */}
          {/*
            Edit Mode, immediately before Display Lab.

            Only rendered when the SERVER has confirmed the capability -- the button's presence is a
            shortcut, never the permission. Every builder action re-checks independently.
          */}
          {mayEditSite && <EditModeButton editable={builderRoutes.length > 0} />}
          <DisplayLab className="mr-2" />
          {/* Light / dark theme toggle, beside the account button / Sign In. */}
          {user ? (
            <details className="group relative ml-1">
              <summary className="flex cursor-pointer list-none items-center gap-2 py-1 pl-1 pr-2 transition-colors hover:bg-[var(--acid-hover)] [&::-webkit-details-marker]:hidden">
                {/*
                  Initials on void, not the old gold-gradient disc: a warm gradient on an acid bar is
                  a yellow smudge on yellow. A dark chip is the one thing that reads on this surface.
                */}
                <span
                  aria-hidden
                  className="cyber-clip-sm flex size-8 items-center justify-center bg-[var(--void)] text-xs font-bold text-[var(--acid)]"
                >
                  {displayName.slice(0, 2).toUpperCase()}
                </span>
                <span className="hidden text-sm font-semibold text-[var(--acid-ink)] sm:block">{displayName}</span>
                <ChevronDown className="size-4 text-[var(--acid-ink)]/70 transition-transform group-open:rotate-180" aria-hidden />
              </summary>
              <div className="cyber-clip absolute right-0 z-50 mt-2 w-52 overflow-hidden border border-[var(--line-strong)] bg-popover p-1 text-foreground shadow-lg">
                <p className="truncate px-3 py-2 text-xs text-muted-foreground">
                  Signed in as <span className="font-semibold text-foreground">@{cueverse}</span>
                </p>
                <Link href="/account" className="block rounded-sm px-3 py-2 text-sm hover:bg-accent">
                  Account Settings
                </Link>
                {/*
                  Admin and Site Builder live here rather than in the main navigation.

                  Appending them to the nav pushed the header past the viewport at exactly 1280px:
                  seven published links plus Creator plus two administrative ones is wider than the
                  bar, and the account menu was the first thing off the edge -- so the control that
                  signs you out became unreachable at a common laptop width.

                  The account menu is the better home for them regardless. It is where administrative
                  controls already are, it is reachable at every width, and nothing the published
                  navigation says can remove it. That last part is the point: this is the Owner's
                  route back when a published navigation is wrong.
                */}
                {staff && (
                  <Link href="/staff" className="block rounded-sm px-3 py-2 text-sm hover:bg-accent">
                    Admin
                  </Link>
                )}
                {mayEditSite && (
                  <Link href="/staff/site-builder" className="block rounded-sm px-3 py-2 text-sm hover:bg-accent">
                    Site Builder
                  </Link>
                )}
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
            <Link
              href="/login"
              className="cyber-clip-sm ml-1 hidden items-center bg-[var(--void)] px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-[var(--acid)] transition-colors hover:bg-[var(--graphite-raised)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--void)] sm:inline-flex"
            >
              Sign In
            </Link>
          )}

          {/* The mobile menu is a vertical list, so the two administrative links cost nothing there. */}
          <MobileNav
            entries={navEntries}
            className="xl:hidden"
            isSignedIn={Boolean(user)}
            extraItems={ensureRecoveryLinks([], viewer).map((l) => ({ label: l.label, href: l.href }))}
          />
        </div>
      </Wide>
    </header>
    </>
  )
}
