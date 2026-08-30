import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { AdminDenied } from '@/components/staff/admin-shell'
import { StaffGate } from '@/components/staff/staff-gate'
import { resolveStaffAccess } from '@/lib/competition/staff-auth'
import { BuilderPage } from '@/components/site-builder/edit-mode'
import { FACTORY_PAGES } from '@/lib/site-builder/factory'

/**
 * Editing something that has no page of its own.
 *
 * ── Two kinds land here ──────────────────────────────────────────────────────────────────────────
 * A GLOBAL — the navigation, the footer, the theme, the site banner — appears on every page and on
 * none of its own. A TEMPLATE governs every Season, or every article, and is normally edited while
 * standing on a real one, which is much the better experience because the live data is visible.
 *
 * But a template whose kind has no instance yet — no article published, no Season created — had
 * nowhere to stand, and the control centre said so and offered nothing. That made the layout that
 * governs every future article uneditable until somebody wrote an article, which is exactly
 * backwards. So a template with no example is edited here instead: the same editor, the same draft,
 * the same publish and the same revision history, with a note saying what it is standing on.
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
  const page = FACTORY_PAGES.find((p) => p.key === key && (p.kind === 'GLOBAL' || p.kind === 'TEMPLATE'))
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
      <p className="eyebrow text-muted-foreground">Site Builder · {page.kind === 'GLOBAL' ? 'Global' : 'Template'}</p>
      <h1 className="font-display text-2xl font-black uppercase tracking-tight text-foreground">{page.title}</h1>
      <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{page.description}</p>
      <p className="mt-2 max-w-2xl border-l-2 border-[var(--line-strong)] pl-3 text-xs text-muted-foreground">
        {page.kind === 'GLOBAL'
          ? 'This appears on every page. The header above and the footer below are the live ones — what you change here is what they read.'
          : 'This governs every page of its kind. There is no example to stand on yet, so the modules that read live data have nothing to draw — the structure is what you are editing here. Once one exists, the control centre will open this template on a real one instead, which is the better way to work on it.'}
      </p>
      <div className="mt-4">
        <BuilderPage pageKey={page.key} pageTitle={page.title} searchParams={forced} />
      </div>
    </div>
  )
}
