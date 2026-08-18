import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'

import { AdminShell, AdminDenied } from '@/components/staff/admin-shell'
import { StaffGate } from '@/components/staff/staff-gate'
import { resolveStaffAccess } from '@/lib/competition/staff-auth'
import { prisma } from '@/lib/prisma'
import { listPages } from '@/lib/editorial/pages'
import { sanitizeDocument, serializeArticleBody } from '@/lib/editorial/richtext'
import { currentEditorialActor } from '@/lib/editorial/permissions'
import { PageManager, type PageDraft } from '@/components/editorial/page-manager'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Pages · Editorial · Admin · 8 Ball Registry',
  robots: { index: false, follow: false },
}

/**
 * Load one page's full content for the inline editor.
 *
 * Passed down as a server action rather than shipped with the listing: a handful of full page bodies
 * in the initial payload is waste when the administrator will open at most one of them.
 */
async function loadDraft(id: number): Promise<PageDraft | null> {
  'use server'
  // Re-checked here rather than inherited from the page render — this is an independent endpoint.
  const actor = await currentEditorialActor()
  if (!actor?.isAdmin) return null

  const page = await prisma.editorialPage.findUnique({
    where: { id },
    select: {
      id: true, slug: true, title: true, body: true, excerpt: true,
      seoTitle: true, seoDescription: true, showInNav: true, navOrder: true,
    },
  })
  if (!page) return null

  return {
    id: page.id,
    slug: page.slug,
    title: page.title,
    bodySource: serializeArticleBody(sanitizeDocument(page.body)),
    excerpt: page.excerpt ?? '',
    seoTitle: page.seoTitle ?? '',
    seoDescription: page.seoDescription ?? '',
    showInNav: page.showInNav,
    navOrder: page.navOrder,
  }
}

export default async function EditorialPagesAdmin() {
  const access = await resolveStaffAccess()
  if (access.status !== 'ok') return <StaffGate access={access} />
  if (!access.actor.can('manage_competitions')) {
    return <AdminDenied actor={access.actor} active="news" label="Pages" />
  }

  const pages = await listPages()

  return (
    <AdminShell actor={access.actor} active="news">
      <Link href="/staff/news" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden />Editorial
      </Link>

      <h1 className="font-display text-2xl font-bold tracking-tight">Pages</h1>
      <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
        Standalone pages such as About or a FAQ. They use the same editor and the same formatting as
        an article, but they are never listed as news and never appear in a feed.
      </p>

      <div className="mt-8 max-w-3xl">
        <PageManager
          pages={pages.map((p) => ({
            ...p,
            publishAt: p.publishAt ? p.publishAt.toISOString() : null,
            updatedAt: p.updatedAt.toISOString(),
          }))}
          loadDraft={loadDraft}
        />
      </div>
    </AdminShell>
  )
}
