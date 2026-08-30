import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { AdminDenied } from '@/components/staff/admin-shell'
import { StaffGate } from '@/components/staff/staff-gate'
import { resolveStaffAccess } from '@/lib/competition/staff-auth'
import { BuilderPage } from '@/components/site-builder/edit-mode'
import { FACTORY_PAGES } from '@/lib/site-builder/factory'

/**
 * Editing a GLOBAL — the navigation, the footer, the theme, the site banner.
 *
 * ── Why these need their own route ───────────────────────────────────────────────────────────────
 * Every other builder page is edited in place, on the page itself, which is the whole point. A
 * global has no page of its own: the navigation appears on all of them. So it gets a surface where
 * its modules can be selected and its inspector opened — the same editor, the same draft, the same
 * publish, the same revision history — with the real header and footer visible above and below,
 * because those are what it configures.
 *
 * The route lives under /staff/site-builder deliberately. It is reachable regardless of what the
 * published navigation says, which is what makes a broken navigation fixable.
 */
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Edit a global · Site Builder',
  robots: { index: false, follow: false },
}

export default async function GlobalEditorPage({ params, searchParams }: {
  params: Promise<{ key: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const access = await resolveStaffAccess()
  if (access.status !== 'ok') return <StaffGate access={access} />
  if (!access.actor.can('manage_site_builder')) {
    return <AdminDenied actor={access.actor} active="site-builder" label="the Site Builder" />
  }

  const { key } = await params
  const page = FACTORY_PAGES.find((p) => p.key === key && p.kind === 'GLOBAL')
  if (!page) notFound()

  /*
    Edit Mode is forced on.

    There is nothing to READ here — a global has no public rendering of its own, only the shell it
    configures. Arriving without ?edit=1 would show an empty page and look broken, so the editor is
    always on and the toolbar's Exit returns to the control centre.
  */
  const sp = await searchParams
  const forced = Promise.resolve({ ...sp, edit: '1' })

  return (
    <div className="mx-auto w-full max-w-[96rem] px-4 py-6 sm:px-6 lg:px-8">
      <p className="eyebrow text-muted-foreground">Site Builder · Global</p>
      <h1 className="font-display text-2xl font-black uppercase tracking-tight text-foreground">{page.title}</h1>
      <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{page.description}</p>
      <p className="mt-2 max-w-2xl border-l-2 border-[var(--line-strong)] pl-3 text-xs text-muted-foreground">
        This appears on every page. The header above and the footer below are the live ones — what
        you change here is what they read.
      </p>
      <div className="mt-4">
        <BuilderPage pageKey={page.key} pageTitle={page.title} searchParams={forced} />
      </div>
    </div>
  )
}
