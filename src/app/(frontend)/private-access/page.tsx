import type { Metadata } from 'next'
import { redirect } from 'next/navigation'

import { SignInForm } from '@/components/account/sign-in-form'
import { safeReturnTo } from '@/lib/account/return-to'
import { hasSiteAccess } from '@/lib/auth/require-viewer'
import './private-access.css'

/** Read per request: it decides where a signed-in visitor is sent, and it must never be cached. */
export const dynamic = 'force-dynamic'

/**
 * Deliberately hand-written rather than from `pageMetadata()`.
 *
 * The shared helper composes a description mentioning the competition, and this page is the one
 * surface a stranger can reach — it should describe the door, not what is behind it. `robots` is
 * stated here as well as in the response header, so the instruction survives being viewed, saved or
 * proxied without the header.
 */
export const metadata: Metadata = {
  title: 'Private Access · 8 Ball Registry',
  description: '8 Ball Registry is private. Sign in to continue.',
  robots: { index: false, follow: false, nocache: true, noarchive: true, nosnippet: true },
  /*
    Overridden, not inherited.

    The root layout's Open Graph block describes the competition — brackets, standings, rankings —
    and it would otherwise be attached to the one page a stranger can fetch, handing a preview
    crawler a description of everything behind the wall.
  */
  openGraph: { title: 'Private Access · 8 Ball Registry', description: '8 Ball Registry is private.', url: '/private-access' },
  twitter: { card: 'summary', title: 'Private Access · 8 Ball Registry', description: '8 Ball Registry is private.' },
}

export default async function PrivateAccessPage(
  { searchParams }: { searchParams: Promise<{ returnTo?: string }> },
) {
  const { returnTo: raw } = await searchParams
  /*
    Checked again on the way out, not just on the way in.

    The middleware only ever writes a path it took from the request's own URL, but the value then
    sits in a query string that anybody can edit before submitting the form. `safeReturnTo` rejects
    anything that is not a root-relative path — no scheme, no `//host`, no `/\host` — so a crafted
    link cannot turn a successful login into a trip to another site.
  */
  const returnTo = safeReturnTo(raw, '/')

  /*
    A safety net, not the mechanism.

    The frontend layout sends a signed-in visitor onward before this renders, and it does so with a
    real 307 because a layout redirect happens before the response is flushed — a redirect thrown
    from a PAGE arrives after streaming has begun and is completed by the client instead. This stays
    because the page should not depend on a layout continuing to do that.
  */
  if (await hasSiteAccess()) redirect(returnTo)

  return (
    <main className="pa-root">
      {/*
        One panel, no chrome.

        The site header and footer are not rendered on this route (see the frontend layout): they
        carry navigation into pages a visitor cannot open, and a nav bar full of links that all
        bounce back here is worse than no nav bar. Nothing on this page is read from the database.
      */}
      <section className="pa-panel" aria-labelledby="pa-title">
        <p className="pa-eyebrow">8 Ball Registry</p>

        <h1 id="pa-title" className="pa-title">Private Access</h1>

        <p className="pa-lede">8 Ball Registry is currently private.</p>
        <p className="pa-body">You must log in to access the website and its data.</p>

        <div className="pa-rule" aria-hidden />

        <div className="pa-form">
          <SignInForm returnTo={returnTo} showRegister={false} />
        </div>
      </section>
    </main>
  )
}
