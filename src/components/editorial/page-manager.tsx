'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Plus, Save, Upload, EyeOff, Trash2, ExternalLink } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { formatDateTime } from '@/lib/format'
import { slugify } from '@/lib/editorial/slug-format'
import { buildDocument } from '@/lib/editorial/richtext'
import { RichText } from '@/components/editorial/rich-text'
import {
  createPageAction, updatePageAction, publishPageAction, unpublishPageAction, deletePageAction,
} from '@/lib/editorial/page-actions'

export interface PageRow {
  id: number
  slug: string
  title: string
  state: string
  publishAt: string | null
  showInNav: boolean
  navOrder: number
  updatedAt: string
}

export interface PageDraft {
  id: number | null
  slug: string
  title: string
  bodySource: string
  excerpt: string
  seoTitle: string
  seoDescription: string
  showInNav: boolean
  navOrder: number
}

const BLANK: PageDraft = {
  id: null, slug: '', title: '', bodySource: '', excerpt: '',
  seoTitle: '', seoDescription: '', showInNav: false, navOrder: 0,
}

/**
 * Standalone pages, managed in one place.
 *
 * A list and an inline editor rather than a separate route per page: there will only ever be a
 * handful of these, and a whole navigation tree for four pages is more structure than the job needs.
 */
export function PageManager({ pages, loadDraft }: {
  pages: PageRow[]
  /** Fetches a page's full content when one is opened — the list only carries the summary. */
  loadDraft: (id: number) => Promise<PageDraft | null>
}) {
  const router = useRouter()
  const confirm = useConfirm()
  const [pending, start] = useTransition()
  const [draft, setDraft] = useState<PageDraft | null>(null)
  const [message, setMessage] = useState<{ ok?: boolean; text: string } | null>(null)

  const open = (id: number) => {
    setMessage(null)
    start(async () => {
      const loaded = await loadDraft(id)
      if (loaded) setDraft(loaded)
      else setMessage({ text: 'That page could not be opened.' })
    })
  }

  const save = () => {
    if (!draft) return
    setMessage(null)
    start(async () => {
      const input = {
        slug: draft.slug || slugify(draft.title),
        title: draft.title,
        bodySource: draft.bodySource,
        excerpt: draft.excerpt || null,
        seoTitle: draft.seoTitle || null,
        seoDescription: draft.seoDescription || null,
        showInNav: draft.showInNav,
        navOrder: draft.navOrder,
      }
      const r = draft.id ? await updatePageAction(draft.id, input) : await createPageAction(input)
      if (r.error) { setMessage({ text: r.error }); return }
      setMessage({ ok: true, text: 'Saved.' })
      if (!draft.id && typeof r.data === 'number') setDraft({ ...draft, id: r.data })
      router.refresh()
    })
  }

  const act = (fn: () => Promise<{ ok?: boolean; error?: string }>, text: string) => {
    setMessage(null)
    start(async () => {
      const r = await fn()
      if (r.error) setMessage({ text: r.error })
      else { setMessage({ ok: true, text }); router.refresh() }
    })
  }

  const remove = (id: number, title: string) => {
    void confirm({
      title: 'Delete this page?',
      message: `“${title}” stops being reachable and leaves the navigation. Its content is kept.`,
      confirmLabel: 'Delete', cancelLabel: 'Cancel', tone: 'danger',
    }).then((r) => {
      if (!r.confirmed) return
      act(() => deletePageAction(id), 'Deleted.')
      setDraft((d) => (d?.id === id ? null : d))
    })
  }

  return (
    <div className="space-y-8">
      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-border pb-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Pages</h2>
          <Button size="sm" variant="outline" onClick={() => { setDraft(BLANK); setMessage(null) }}>
            <Plus className="size-4" aria-hidden />New page
          </Button>
        </div>

        {pages.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No pages yet.</p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {pages.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2">
                    <button type="button" onClick={() => open(p.id)} className="font-medium hover:text-brand">
                      {p.title}
                    </button>
                    <Badge variant={p.state === 'PUBLISHED' ? 'success' : 'muted'}>
                      {p.state.charAt(0) + p.state.slice(1).toLowerCase().replace('_', ' ')}
                    </Badge>
                    {p.showInNav && <Badge variant="muted">In navigation</Badge>}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    /pages/{p.slug} · updated {formatDateTime(p.updatedAt)}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  {p.state === 'PUBLISHED' ? (
                    <>
                      <Link href={`/pages/${p.slug}`} className="inline-flex items-center gap-1 text-muted-foreground hover:text-brand">
                        View <ExternalLink className="size-3" aria-hidden />
                      </Link>
                      <Button size="sm" variant="ghost" disabled={pending} onClick={() => act(() => unpublishPageAction(p.id), 'Unpublished.')}>
                        <EyeOff className="size-4" aria-hidden />Unpublish
                      </Button>
                    </>
                  ) : p.state !== 'SOFT_DELETED' ? (
                    <Button size="sm" variant="outline" disabled={pending} onClick={() => act(() => publishPageAction(p.id, null), 'Published.')}>
                      <Upload className="size-4" aria-hidden />Publish
                    </Button>
                  ) : null}
                  <Button size="sm" variant="ghost" className="text-destructive" disabled={pending} onClick={() => remove(p.id, p.title)}>
                    <Trash2 className="size-4" aria-hidden />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {draft && (
        <section className="rounded-lg border border-border p-5">
          <h2 className="mb-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {draft.id ? 'Edit page' : 'New page'}
          </h2>

          <div className="space-y-4">
            <div>
              <label htmlFor="page-title" className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">Title</label>
              <input
                id="page-title" value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label htmlFor="page-slug" className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">Web address</label>
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">/pages/</span>
                <input
                  id="page-slug" value={draft.slug}
                  onChange={(e) => setDraft({ ...draft, slug: slugify(e.target.value) })}
                  placeholder={slugify(draft.title) || 'about'}
                  className="min-w-0 flex-1 rounded-md border border-input bg-card px-3 py-2 text-sm"
                />
              </div>
            </div>

            <div>
              <label htmlFor="page-body" className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">Body</label>
              <textarea
                id="page-body" value={draft.bodySource} rows={16}
                onChange={(e) => setDraft({ ...draft, bodySource: e.target.value })}
                className="w-full resize-y rounded-md border border-input bg-card px-3 py-2 font-mono text-sm"
              />
            </div>

            <div className="flex flex-wrap items-center gap-4">
              <label htmlFor="page-nav" className="flex items-center gap-2 text-sm">
                <input
                  id="page-nav" type="checkbox" checked={draft.showInNav}
                  onChange={(e) => setDraft({ ...draft, showInNav: e.target.checked })}
                  className="size-4 accent-[var(--gold)]"
                />
                Show in the footer navigation
              </label>
              {draft.showInNav && (
                <label htmlFor="page-order" className="flex items-center gap-2 text-sm text-muted-foreground">
                  Order
                  <input
                    id="page-order" type="number" min={0} value={draft.navOrder}
                    onChange={(e) => setDraft({ ...draft, navOrder: Number(e.target.value) || 0 })}
                    className="w-20 rounded-md border border-input bg-card px-2 py-1 text-sm"
                  />
                </label>
              )}
            </div>

            {draft.bodySource.trim() && (
              <details className="rounded-lg border border-border p-4">
                <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-muted-foreground">Preview</summary>
                <div className="mt-4">
                  <h3 className="font-display text-2xl font-bold tracking-tight">{draft.title || 'Untitled'}</h3>
                  <RichText doc={buildDocument(draft.bodySource)} className="mt-4" />
                </div>
              </details>
            )}
          </div>

          {message && (
            <p role="status" className={`mt-4 rounded-md border px-3 py-2 text-sm ${message.ok ? 'border-success/40 bg-success/10 text-success' : 'border-destructive/40 bg-destructive/10 text-destructive'}`}>
              {message.text}
            </p>
          )}

          <div className="mt-5 flex flex-wrap gap-2 border-t border-border pt-4">
            <Button disabled={pending} onClick={save}><Save className="size-4" aria-hidden />Save</Button>
            {draft.id && (
              <Button variant="outline" disabled={pending} onClick={() => act(() => publishPageAction(draft.id!, null), 'Published.')}>
                <Upload className="size-4" aria-hidden />Publish
              </Button>
            )}
            <Button variant="ghost" className="ml-auto" onClick={() => setDraft(null)}>Close</Button>
          </div>
        </section>
      )}

      {!draft && message && (
        <p role="status" className={`rounded-md border px-3 py-2 text-sm ${message.ok ? 'border-success/40 bg-success/10 text-success' : 'border-destructive/40 bg-destructive/10 text-destructive'}`}>
          {message.text}
        </p>
      )}
    </div>
  )
}
