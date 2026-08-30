import 'server-only'

/**
 * The bridge between a public page and the editor.
 *
 * ── The one thing this file guarantees ───────────────────────────────────────────────────────────
 * A visitor without `manage_site_builder` receives NO editor code. Not disabled editor code, not
 * editor code behind a flag — none. The capability is checked on the server, and the editor is only
 * ever REFERENCED inside that check, so its client chunk is never named in the payload a public
 * visitor receives and the browser never requests it. Gating in the browser would ship the entire
 * editing surface to every visitor and rely on a boolean to keep it quiet.
 *
 * ── Why `?edit=1` rather than a stored flag ──────────────────────────────────────────────────────
 * It survives a refresh, it can be linked to, it is obvious in the address bar, and it cannot get
 * stuck on. A flag in localStorage or a cookie eventually strands somebody in Edit Mode on a page
 * whose toolbar has failed to render, with no way to say so.
 */

import { resolveStaffAccess } from '@/lib/competition/staff-auth'
import { getDraft, getPublishedLayout } from '@/lib/site-builder/service'
import { DocumentRenderer } from './render'
import { serialiseRegistry, type RenderContext } from '@/lib/site-builder/registry'
import type { LayoutDocument } from '@/lib/site-builder/document'
import SiteBuilderEditor from './editor-entry'

/** May this viewer edit? Used by the header and by every builder surface. */
export async function canEditSite(): Promise<boolean> {
  const access = await resolveStaffAccess()
  return access.status === 'ok' && access.actor.can('manage_site_builder')
}

/**
 * Render a builder-managed page.
 *
 * Published document for everyone. For an editing administrator, the DRAFT — because the point of
 * Edit Mode is to see unpublished work, and showing the published version would make every edit
 * appear to have been lost until publish.
 */
export async function BuilderPage({
  pageKey, pageTitle, searchParams, routeParams, entityId,
}: {
  pageKey: string
  pageTitle: string
  searchParams?: Promise<Record<string, string | string[] | undefined>>
  /**
   * The dynamic route's own params, handed to the system module that renders the entity.
   *
   * A template governs every Season page, so the module that draws one has to be told WHICH Season
   * — and it must be the same promise the route received, not a re-derived value, or the module
   * would be reading a different request's params.
   */
  routeParams?: Promise<Record<string, string>>
  /** The entity this page is about, for visibility conditions and the editor's page label. */
  entityId?: number
}) {
  const params = searchParams ? await searchParams : {}
  const wantsEdit = params.edit === '1' || params.edit === 'true'

  const access = await resolveStaffAccess()
  const mayEdit = access.status === 'ok' && access.actor.can('manage_site_builder')
  const editing = wantsEdit && mayEdit

  const resolvedRouteParams = routeParams ? await routeParams : undefined
  const context: RenderContext = {
    route: pageKey,
    routeParams: resolvedRouteParams,
    seasonId: pageKey === 'season' ? entityId : undefined,
    tournamentId: pageKey === 'tournament' ? entityId : undefined,
    // Everything except the editor's own flag. `edit` is the editor's, not the page's, and a system
    // module that saw it would be reacting to being edited.
    searchParams: Object.fromEntries(Object.entries(params).filter(([k]) => k !== 'edit')),
    viewer: {
      signedIn: access.status === 'ok',
      isAdmin: access.status === 'ok' && access.actor.isAdmin,
    },
  }

  if (!editing) {
    const layout = await getPublishedLayout(pageKey)
    return <DocumentRenderer document={layout.document} context={context} />
  }

  /*
    A page that has never been bootstrapped has no draft row. Falling back to the published layout
    (which itself falls back to the factory layout) means Edit Mode still opens on such a page, with
    version 0 — the first save creates the draft. The alternative, refusing to open, would make the
    builder unusable on exactly the page somebody had just added.
  */
  const draft = await getDraft(pageKey)
  let layout: { document: LayoutDocument; version: number }
  if (draft) {
    layout = draft
  } else {
    const published = await getPublishedLayout(pageKey)
    layout = { document: published.document, version: 0 }
  }

  return (
    <>
      {/* Space for the fixed toolbar, so it never covers the first row of the page it is editing. */}
      <div aria-hidden className="h-[45px]" />
      <DocumentRenderer document={layout.document} editing context={context} />
      <SiteBuilderEditor
        pageKey={pageKey}
        pageTitle={pageTitle}
        document={layout.document}
        version={layout.version}
        /* The registry the server built, as data. See serialiseRegistry for why. */
        manifest={serialiseRegistry()}
      />
    </>
  )
}
