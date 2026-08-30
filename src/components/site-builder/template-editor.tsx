'use client'

/**
 * Editing a template.
 *
 * ── The same editor, a different destination ────────────────────────────────────────────────────
 * This mounts `SiteBuilderEditor` with a template target rather than the page one. Everything the
 * Owner already knows carries over — the canvas, the inspector, the palette, undo, autosave,
 * keyboard reordering, the layer tree, the command palette — and the only differences are the two
 * that genuinely differ: what a save writes, and the absence of a publish step.
 *
 * ── Why the canvas is rendered here rather than by the server ───────────────────────────────────
 * A page's canvas is server-rendered because its modules read live data. A template has no page and
 * no entity, so its preview is rendered against a REPRESENTATIVE context instead: the modules that
 * read live data show what they would show on a real page of that kind. A template of the Season
 * layout previews with a real Season in it, which is the only way to see whether the layout works.
 */

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, History, Info, Loader2 } from 'lucide-react'

import SiteBuilderEditor from './editor-entry'
import type { EditorTarget } from './editor-store'
import type { ModuleManifestEntry } from '@/lib/site-builder/registry'
import type { TemplateDetail, TemplateRevisionSummary, TemplateUsage } from '@/lib/site-builder/templates'
import {
  getTemplateRevisionsAction, getTemplateUsageAction, rollbackTemplateAction, updateTemplateAction,
} from '@/lib/site-builder/template-actions'
import { Dialog } from './palette'
import { cn } from '@/lib/utils'

export function TemplateEditor({ template, manifest, previewNote }: {
  template: TemplateDetail
  manifest: ModuleManifestEntry[]
  /** What the preview beneath is standing on, in words, so it is never mistaken for a real page. */
  previewNote: string
}) {
  const router = useRouter()
  const [history, setHistory] = useState(false)
  const [usage, setUsage] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  /*
    The target.

    `version` is passed straight back out: a template row has no optimistic-concurrency column, and
    inventing one here would be a promise the database does not keep. Two people editing the same
    template is not a scenario this site has — there is one Owner — and every save writes a revision,
    so the worst case is recoverable rather than silent.
  */
  const target = useMemo<EditorTarget>(() => ({
    kind: 'template',
    async save(document, version) {
      const result = await updateTemplateAction(template.id, { document })
      if (result.ok) {
        setSaveError(null)
        return { ok: true, version }
      }
      setSaveError(result.error)
      return { ok: false, error: result.error }
    },
    // No publish. A template is a starting point; inserting one copies it.
  }), [template.id])

  return (
    <>
      <div className="mx-auto w-full max-w-[96rem] px-4 pb-4 pt-[57px] sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <button
              type="button"
              onClick={() => router.push('/staff/site-builder')}
              className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="size-3" aria-hidden /> Site Builder
            </button>
            <h1 className="mt-1 font-display text-2xl font-black uppercase tracking-tight text-foreground">
              {template.name}
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              {template.description || (template.scope === 'page' ? 'A whole-page template.' : 'A section template.')}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() => setUsage(true)}
              className="flex items-center gap-1.5 border border-border px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground hover:text-foreground"
            >
              <Info className="size-3" aria-hidden /> Where it is used
            </button>
            <button
              type="button"
              onClick={() => setHistory(true)}
              className="flex items-center gap-1.5 border border-border px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground hover:text-foreground"
            >
              <History className="size-3" aria-hidden /> History
              <span className="tabular">{template.revisionCount}</span>
            </button>
          </div>
        </div>

        <p className="mt-3 max-w-3xl border-l-2 border-[var(--brcam-teal)] pl-3 text-xs leading-relaxed text-muted-foreground">
          Changes here save as you work and are kept in the history. <strong className="text-foreground">Nothing
          publishes.</strong> A template is a starting point: inserting it copies its sections onto a page with
          fresh identifiers and no link back, so editing this later changes nothing on any page that
          already used it.
        </p>
        <p className="mt-1 max-w-3xl text-[11px] text-muted-foreground">{previewNote}</p>

        {saveError && (
          <p className="mt-2 border-l-2 border-[var(--hot-red)] pl-2 text-[11px] text-[var(--hot-red)]">{saveError}</p>
        )}

        {template.unknownTypes.length > 0 && (
          <p className="mt-2 border-l-2 border-[var(--gold)] pl-2 text-[11px] text-[var(--gold)]">
            This template uses module types this build does not have: {template.unknownTypes.join(', ')}. They are
            kept exactly as they are and render as a placeholder.
          </p>
        )}
      </div>

      <SiteBuilderEditor
        pageKey={`template:${template.id}`}
        pageTitle={template.name}
        document={template.document}
        version={1}
        manifest={manifest}
        target={target}
      />

      {history && (
        <TemplateHistoryDialog
          templateId={template.id}
          onClose={() => setHistory(false)}
          onRestored={() => { setHistory(false); router.refresh() }}
        />
      )}
      {usage && <TemplateUsageDialog templateId={template.id} onClose={() => setUsage(false)} />}
    </>
  )
}

function TemplateHistoryDialog({ templateId, onClose, onRestored }: {
  templateId: string
  onClose: () => void
  onRestored: () => void
}) {
  const [rows, setRows] = useState<TemplateRevisionSummary[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (rows === null) {
    void getTemplateRevisionsAction(templateId).then((r) => setRows(r.ok ? r.data : []))
  }

  return (
    <Dialog title="Template history" onClose={onClose}>
      <p className="text-xs text-muted-foreground">
        Every save is kept. Restoring writes the old version as a NEW revision, so nothing is
        overwritten and the restore itself can be undone.
      </p>
      {rows === null && <p className="text-[11px] text-muted-foreground">Loading…</p>}
      {rows?.length === 0 && <p className="text-[11px] text-muted-foreground">No revisions yet.</p>}
      {rows && rows.length > 0 && (
        <ul className="flex max-h-72 flex-col gap-1 overflow-y-auto">
          {rows.map((r) => (
            <li
              key={r.number}
              className={cn('flex items-center justify-between gap-2 border px-2 py-1.5', r.isCurrent ? 'border-[var(--hot-red)]' : 'border-border')}
            >
              <span className="min-w-0">
                <span className="flex items-center gap-2 text-xs text-foreground">
                  <span className="tabular font-semibold">#{r.number}</span>
                  <span className="truncate">{r.name}</span>
                  {r.isCurrent && <span className="border border-[var(--hot-red)] px-1 text-[9px] uppercase text-[var(--hot-red)]">Current</span>}
                </span>
                <span className="block truncate text-[11px] text-muted-foreground">
                  {r.summary ?? 'Saved'} · {r.sectionCount} section{r.sectionCount === 1 ? '' : 's'}
                  {r.createdBy ? ` · ${r.createdBy}` : ''} · {new Date(r.createdAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
                </span>
              </span>
              {!r.isCurrent && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true); setError(null)
                    const result = await rollbackTemplateAction(templateId, r.number)
                    setBusy(false)
                    if (result.ok) onRestored(); else setError(result.error)
                  }}
                  className="shrink-0 border border-border px-2 py-1 text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground hover:border-[var(--hot-red)] hover:text-foreground disabled:opacity-50"
                >
                  Restore
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {busy && <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><Loader2 className="size-3 animate-spin" aria-hidden /> Restoring…</p>}
      {error && <p className="border-l-2 border-[var(--hot-red)] pl-2 text-[11px] text-[var(--hot-red)]">{error}</p>}
    </Dialog>
  )
}

/**
 * Where a template's contents already are.
 *
 * Two lists, kept apart on purpose. Linked reusable modules are the ones that matter: editing one of
 * those DOES reach the pages that carry it. Pages that merely look like they started from this
 * template are a hint, and are labelled as one — inserting a template deliberately severs the link,
 * so there is nothing exact to report and pretending otherwise would be worse than a guess.
 */
export function TemplateUsageDialog({ templateId, onClose }: { templateId: string; onClose: () => void }) {
  const [usage, setUsage] = useState<TemplateUsage | null>(null)
  if (usage === null) {
    void getTemplateUsageAction(templateId).then((r) => setUsage(r.ok ? r.data : { linkedReusables: [], likelyStartedFrom: [] }))
  }

  return (
    <Dialog title="Where this template is used" onClose={onClose}>
      {usage === null && <p className="text-[11px] text-muted-foreground">Loading…</p>}
      {usage && (
        <>
          <section>
            <h3 className="eyebrow text-muted-foreground">Linked modules it plants</h3>
            {usage.linkedReusables.length === 0 && (
              <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                None. Everything in this template is an ordinary copy, so inserting it creates nothing
                that follows anything else.
              </p>
            )}
            {usage.linkedReusables.length > 0 && (
              <>
                <p className="mt-1 text-[11px] leading-relaxed text-[var(--gold)]">
                  These stay linked when the template is inserted. Editing the saved module changes
                  them everywhere they appear — and each of those pages needs publishing before
                  visitors see it.
                </p>
                <ul className="mt-1.5 flex flex-col gap-1">
                  {usage.linkedReusables.map((r) => (
                    <li key={r.id} className="border border-border px-2 py-1.5 text-[11px]">
                      <span className={cn('font-semibold', r.missing ? 'text-[var(--hot-red)]' : 'text-foreground')}>
                        {r.name}{r.missing ? ' — no longer exists' : ''}
                      </span>
                      <span className="block text-muted-foreground">
                        {r.onPages.length === 0 ? 'Not on any page yet.' : `Live on: ${r.onPages.join(', ')}`}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>

          <section className="mt-3">
            <h3 className="eyebrow text-muted-foreground">Pages that look like they started here</h3>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
              A guess, based on a section with the same name and the same modules in the same order.
              Inserting a template makes an independent copy, so there is no exact record to check
              against.
            </p>
            {usage.likelyStartedFrom.length === 0
              ? <p className="mt-1 text-[11px] text-muted-foreground">Nothing matches.</p>
              : (
                <ul className="mt-1.5 flex flex-wrap gap-1">
                  {usage.likelyStartedFrom.map((title) => (
                    <li key={title} className="border border-border px-2 py-0.5 text-[11px] text-muted-foreground">{title}</li>
                  ))}
                </ul>
              )}
          </section>
        </>
      )}
    </Dialog>
  )
}
