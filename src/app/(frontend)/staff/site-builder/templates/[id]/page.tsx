import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { AdminDenied } from '@/components/staff/admin-shell'
import { StaffGate } from '@/components/staff/staff-gate'
import { resolveStaffAccess } from '@/lib/competition/staff-auth'
import { getTemplate } from '@/lib/site-builder/templates'
import { serialiseRegistry } from '@/lib/site-builder/registry'
import { TemplateEditor } from '@/components/site-builder/template-editor'
import { DocumentRenderer } from '@/components/site-builder/render'
import type { RenderContext } from '@/lib/site-builder/registry'
import '@/components/site-builder/modules'

/**
 * Editing one template.
 *
 * ── Why this route exists ────────────────────────────────────────────────────────────────────────
 * A template used to be reachable only by inserting it. If nothing had ever been built from it —
 * which is true of every template the moment it is created — there was no way to open it at all, so
 * a mistake in a template was permanent and a blank template was useless. This is the route that
 * makes "create a template, then build it" a thing somebody can do.
 *
 * ── Why it does not need an instance ─────────────────────────────────────────────────────────────
 * The editor renders the template's own document. Modules that read live data show representative
 * data — the same services every other page uses, with no entity pinned — so the layout can be
 * judged without a Season or an article having to exist first.
 */
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Edit a template · Site Builder',
  robots: { index: false, follow: false },
}

export default async function TemplateEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const access = await resolveStaffAccess()
  if (access.status !== 'ok') return <StaffGate access={access} />
  if (!access.actor.can('manage_site_builder')) {
    return <AdminDenied actor={access.actor} active="site-builder" label="the Site Builder" />
  }

  const { id } = await params
  const template = await getTemplate(id)
  if (!template) notFound()

  /*
    The preview context.

    `route` is the template's own address rather than a page's, so a visibility condition on
    "which page is this" evaluates to something rather than to a lie about being the homepage. The
    viewer is the real one, because a module that shows different things to an administrator should
    show the administrator's version to the administrator who is editing it.
  */
  const context: RenderContext = {
    route: `template:${template.id}`,
    viewer: {
      signedIn: true,
      isAdmin: access.actor.isAdmin,
      isOwner: access.actor.isOwner,
    },
  }

  return (
    <>
      <TemplateEditor
        template={template}
        manifest={serialiseRegistry()}
        previewNote={
          template.scope === 'page'
            ? 'Below is the template itself. Modules that read live data show the real registry, exactly as they would on a page built from this.'
            : 'Below is the section this template holds. Modules that read live data show the real registry, exactly as they would once the section is placed on a page.'
        }
      />
      {/*
        The canvas.

        Rendered on the SERVER, like a page's canvas, because the modules are server components that
        read live data — that is what makes the preview representative rather than a wireframe. An
        empty template renders as nothing, with the editor's own "add a section" the only thing on
        screen, which is the correct starting state rather than an error.
      */}
      <div className="mx-auto w-full max-w-[96rem] px-4 pb-24 sm:px-6 lg:px-8">
        <DocumentRenderer document={template.document} editing context={context} />
      </div>
    </>
  )
}
