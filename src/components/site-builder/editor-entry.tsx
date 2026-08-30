'use client'

/**
 * The editor's client entry point.
 *
 * ── Why this file exists ─────────────────────────────────────────────────────────────────────────
 * `edit-mode.tsx` is a Server Component, and it loaded the editor with
 * `dynamic(() => import('./editor-shell').then((m) => m.SiteBuilderEditor))`. That RENDERED — the
 * toolbar and both panels appeared in the HTML — but it never hydrated: the mapping function defeats
 * the bundler's static analysis of the import, so no client reference was emitted and the whole
 * editor arrived as inert markup. Every control was visible and none of them did anything, with no
 * error anywhere, which is the least diagnosable shape a bug can take.
 *
 * A default export imported directly needs no mapping function, so the client boundary is created
 * the ordinary way. The editor still costs a public visitor nothing: it is only ever REFERENCED by
 * the server when the capability check has already passed, so the browser never requests the chunk.
 */

export { SiteBuilderEditor as default } from './editor-shell'
