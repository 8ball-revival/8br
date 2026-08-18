'use client'

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  Save, Send, Eye, Upload, CheckCircle2, Clock, History, Trash2, Archive, AlertTriangle,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { formatDateTime } from '@/lib/format'
import { buildDocument } from '@/lib/editorial/richtext'
import { slugify } from '@/lib/editorial/slug-format'
import { RichText } from '@/components/editorial/rich-text'
import {
  createArticleAction, updateArticleAction, autosaveDraftAction, submitForReviewAction,
  withdrawSubmissionAction, publishArticleAction, archiveArticleAction, deleteArticleAction,
  restoreRevisionAction, checkSlugAction,
} from '@/lib/editorial/actions'

export interface EditorCategory { id: number; name: string; adminOnly: boolean }
export interface EditorRevision { id: number; revision: number; title: string; editorName: string; note: string | null; createdAt: string }

export interface EditorArticle {
  id: number | null
  title: string
  slug: string
  bodySource: string
  excerpt: string
  categoryId: number | null
  tags: string[]
  coverMediaId: string | null
  coverAlt: string
  seoTitle: string
  seoDescription: string
  official: boolean
  featured: boolean
  commentsEnabled: boolean
  state: string
  publishAt: string | null
  reviewFeedback: string | null
  hasPendingEdit: boolean
}

/**
 * The article editor.
 *
 * One surface for writing, reviewing and publishing, because splitting them would mean an author had
 * to know which page they were allowed to be on. What each person may actually DO is decided by the
 * server on every action; the buttons here only reflect it.
 *
 * The preview is rendered from the same parser and the same components as the published page, in the
 * browser, from what is currently in the textarea. It is therefore a real preview rather than an
 * approximation — if it looks right here it will look right when it is published.
 */
export function ArticleEditor({
  initial,
  categories,
  revisions = [],
  canPublish,
  isAdmin,
}: {
  initial: EditorArticle
  categories: EditorCategory[]
  revisions?: EditorRevision[]
  /** Whether this person may publish this article without review. Decided on the server. */
  canPublish: boolean
  isAdmin: boolean
}) {
  const router = useRouter()
  const confirm = useConfirm()
  const [pending, start] = useTransition()

  const [articleId, setArticleId] = useState(initial.id)
  const [form, setForm] = useState(initial)
  const [tab, setTab] = useState<'write' | 'preview' | 'settings' | 'history'>('write')
  const [message, setMessage] = useState<{ ok?: boolean; text: string } | null>(null)
  const [savedAt, setSavedAt] = useState<Date | null>(null)
  const [slugState, setSlugState] = useState<{ checking: boolean; available: boolean | null }>({ checking: false, available: null })

  const set = <K extends keyof EditorArticle>(key: K, value: EditorArticle[K]) =>
    setForm((f) => ({ ...f, [key]: value }))

  // The preview is derived, never stored: parsing on each keystroke is cheap, and a cached preview
  // that disagreed with the textarea would be worse than no preview.
  const previewDoc = useMemo(() => buildDocument(form.bodySource), [form.bodySource])

  const payload = useCallback(() => ({
    title: form.title,
    bodySource: form.bodySource,
    excerpt: form.excerpt || null,
    categoryId: form.categoryId,
    tags: form.tags,
    coverMediaId: form.coverMediaId,
    coverAlt: form.coverAlt || null,
    seoTitle: form.seoTitle || null,
    seoDescription: form.seoDescription || null,
    official: form.official,
    featured: form.featured,
    commentsEnabled: form.commentsEnabled,
    slug: form.slug || null,
  }), [form])

  // --------------------------------------------------------------- autosave

  const dirty = useRef(false)
  const latest = useRef(form)
  latest.current = form
  useEffect(() => { dirty.current = true }, [form])

  useEffect(() => {
    // Autosave only touches drafts, and only after the author stops typing. It deliberately does not
    // run for a published article: those changes are a proposal that has to be submitted on purpose.
    if (!articleId) return
    if (form.state !== 'DRAFT' && form.state !== 'REJECTED') return

    const timer = window.setInterval(() => {
      if (!dirty.current) return
      dirty.current = false
      const snapshot = latest.current
      void autosaveDraftAction(articleId, snapshot.title, snapshot.bodySource).then((r) => {
        if (!r.error) setSavedAt(new Date())
      })
    }, 20_000)

    return () => window.clearInterval(timer)
  }, [articleId, form.state])

  // Warn before losing unsaved work to a closed tab.
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => { if (dirty.current) e.preventDefault() }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [])

  // --------------------------------------------------------------- slug

  useEffect(() => {
    const candidate = form.slug || slugify(form.title)
    if (!candidate) { setSlugState({ checking: false, available: null }); return }
    setSlugState((s) => ({ ...s, checking: true }))
    const timer = window.setTimeout(() => {
      void checkSlugAction(candidate, articleId ?? undefined).then((r) => {
        setSlugState({ checking: false, available: r.data?.available ?? null })
      })
    }, 400)
    return () => window.clearTimeout(timer)
  }, [form.slug, form.title, articleId])

  // --------------------------------------------------------------- actions

  const run = (fn: () => Promise<{ ok?: boolean; error?: string }>, successText: string) => {
    setMessage(null)
    start(async () => {
      const r = await fn()
      if (r.error) { setMessage({ text: r.error }); return }
      dirty.current = false
      setSavedAt(new Date())
      setMessage({ ok: true, text: successText })
      router.refresh()
    })
  }

  const save = () => {
    setMessage(null)
    start(async () => {
      if (!articleId) {
        const r = await createArticleAction(payload())
        if (r.error) { setMessage({ text: r.error }); return }
        const id = r.data!
        setArticleId(id)
        dirty.current = false
        setSavedAt(new Date())
        setMessage({ ok: true, text: 'Draft saved.' })
        // Move to the article's own URL so a refresh does not start a second draft.
        router.replace(`/news/${form.slug || slugify(form.title)}/edit`)
        router.refresh()
        return
      }

      const r = await updateArticleAction(articleId, payload())
      if (r.error) { setMessage({ text: r.error }); return }
      dirty.current = false
      setSavedAt(new Date())
      setMessage({
        ok: true,
        text: r.data?.pending
          ? 'Saved and sent for review. The published version stays as it is until an administrator approves the change.'
          : 'Saved.',
      })
      router.refresh()
    })
  }

  const publish = () => {
    void confirm({
      title: 'Publish this article?',
      message: 'It becomes visible to everybody immediately.',
      confirmLabel: 'Publish', cancelLabel: 'Cancel',
    }).then((r) => { if (r.confirmed) run(() => publishArticleAction(articleId!, null), 'Published.') })
  }

  const schedule = () => {
    void confirm({
      title: 'Schedule this article',
      message: 'Give a date and time (your local time). It stays hidden until then, and appears on its own.',
      confirmLabel: 'Schedule', cancelLabel: 'Cancel',
      input: { label: 'Publish at', placeholder: 'YYYY-MM-DD HH:MM' },
    }).then((r) => {
      if (!r.confirmed) return
      const when = new Date(r.value.replace(' ', 'T'))
      if (Number.isNaN(when.getTime())) { setMessage({ text: 'That date could not be read. Use YYYY-MM-DD HH:MM.' }); return }
      if (when.getTime() <= Date.now()) { setMessage({ text: 'Pick a time in the future, or publish it now.' }); return }
      run(() => publishArticleAction(articleId!, when.toISOString()), `Scheduled for ${formatDateTime(when.toISOString())}.`)
    })
  }

  const submit = () => run(() => submitForReviewAction(articleId!), 'Sent for review.')

  const remove = () => {
    void confirm({
      title: 'Delete this article?',
      message: 'It stops being visible anywhere. An administrator can restore it.',
      confirmLabel: 'Delete', cancelLabel: 'Cancel', tone: 'danger',
    }).then((r) => {
      if (!r.confirmed) return
      start(async () => {
        const res = await deleteArticleAction(articleId!)
        if (res.error) { setMessage({ text: res.error }); return }
        dirty.current = false
        router.push('/news/mine')
      })
    })
  }

  // --------------------------------------------------------------- render

  const isNew = articleId == null
  const live = form.state === 'PUBLISHED' || form.state === 'ARCHIVED'
  const proposalMode = live && !canPublish

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-display text-xs font-semibold uppercase tracking-[0.18em] text-brand">The Break</p>
          <h1 className="mt-1 font-display text-2xl font-bold tracking-tight">
            {isNew ? 'Write an article' : 'Edit article'}
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <StateBadge state={form.state} publishAt={form.publishAt} />
          {form.hasPendingEdit && <Badge variant="muted">Edit awaiting review</Badge>}
          {savedAt && <span className="text-muted-foreground">Saved {formatDateTime(savedAt.toISOString())}</span>}
        </div>
      </div>

      {form.reviewFeedback && (
        <div className="mt-4 rounded-md border border-warning/40 bg-warning/10 px-4 py-3 text-sm">
          <p className="flex items-center gap-1.5 font-medium text-warning">
            <AlertTriangle className="size-4" aria-hidden />Feedback from review
          </p>
          <p className="mt-1 text-foreground/90">{form.reviewFeedback}</p>
        </div>
      )}

      {proposalMode && (
        <p className="mt-4 rounded-md border border-border bg-card/40 px-4 py-3 text-sm text-muted-foreground">
          This article is already published. Your changes will be held for review — readers keep seeing
          the approved version until an administrator accepts them.
        </p>
      )}

      <nav className="mt-5 flex flex-wrap gap-1 border-b border-border" aria-label="Editor sections">
        {(['write', 'preview', 'settings', ...(revisions.length ? ['history' as const] : [])] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            aria-current={tab === t ? 'page' : undefined}
            className={[
              '-mb-px border-b-2 px-3 py-2 text-sm capitalize transition-colors',
              tab === t ? 'border-brand text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
            ].join(' ')}
          >
            {t}
          </button>
        ))}
      </nav>

      {tab === 'write' && (
        <div className="mt-5 space-y-4">
          <Field label="Title" htmlFor="title">
            <input
              id="title"
              value={form.title}
              onChange={(e) => set('title', e.target.value)}
              placeholder="What is this about?"
              maxLength={180}
              className="w-full rounded-md border border-input bg-card px-3 py-2 font-display text-lg outline-none focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/25"
            />
          </Field>

          <Field
            label="Body"
            htmlFor="body"
            hint="**bold**, *italic*, `code`, [link](/somewhere), ## heading, - list, > quote, ``` code block, --- rule, ![alt](media:filename.jpg)"
          >
            <textarea
              id="body"
              value={form.bodySource}
              onChange={(e) => set('bodySource', e.target.value)}
              rows={22}
              placeholder="Write the article…"
              className="w-full resize-y rounded-md border border-input bg-card px-3 py-2 font-mono text-sm leading-relaxed outline-none focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/25"
            />
          </Field>

          <Field label="Excerpt" htmlFor="excerpt" hint="Shown in listings and link previews. Left blank, it is taken from the opening lines.">
            <textarea
              id="excerpt"
              value={form.excerpt}
              onChange={(e) => set('excerpt', e.target.value)}
              rows={2}
              maxLength={400}
              className="w-full resize-y rounded-md border border-input bg-card px-3 py-2 text-sm outline-none focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/25"
            />
          </Field>
        </div>
      )}

      {tab === 'preview' && (
        <div className="mt-5">
          <article className="rounded-lg border border-border bg-card/30 p-6">
            <h2 className="font-display text-3xl font-bold leading-tight tracking-tight">
              {form.title || 'Untitled'}
            </h2>
            {form.excerpt && <p className="mt-3 text-lg text-muted-foreground">{form.excerpt}</p>}
            <RichText doc={previewDoc} className="mt-6" />
          </article>
          <p className="mt-2 text-xs text-muted-foreground">
            Rendered with exactly the same parser and components as the published page.
          </p>
        </div>
      )}

      {tab === 'settings' && (
        <div className="mt-5 space-y-4">
          <Field label="Web address" htmlFor="slug" hint="Changing this after publication keeps the old address working as a redirect.">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-muted-foreground">/news/</span>
              <input
                id="slug"
                value={form.slug}
                onChange={(e) => set('slug', slugify(e.target.value))}
                placeholder={slugify(form.title) || 'article'}
                className="min-w-0 flex-1 rounded-md border border-input bg-card px-3 py-2 text-sm outline-none focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/25"
              />
              {slugState.checking
                ? <span className="text-xs text-muted-foreground">checking…</span>
                : slugState.available === true ? <span className="text-xs text-success">available</span>
                  : slugState.available === false ? <span className="text-xs text-destructive">taken</span>
                    : null}
            </div>
          </Field>

          <Field label="Category" htmlFor="category">
            <select
              id="category"
              value={form.categoryId ?? ''}
              onChange={(e) => set('categoryId', e.target.value ? Number(e.target.value) : null)}
              className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm"
            >
              <option value="">No category</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id} disabled={c.adminOnly && !isAdmin}>
                  {c.name}{c.adminOnly && !isAdmin ? ' (staff only)' : ''}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Topics" htmlFor="tags" hint="Comma-separated. Up to twelve.">
            <input
              id="tags"
              value={form.tags.join(', ')}
              onChange={(e) => set('tags', e.target.value.split(',').map((t) => t.trim()).filter(Boolean).slice(0, 12))}
              placeholder="season 12, predictions, break-and-run"
              className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm outline-none focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/25"
            />
          </Field>

          <CoverPicker
            mediaId={form.coverMediaId}
            alt={form.coverAlt}
            onChange={(mediaId, alt) => setForm((f) => ({ ...f, coverMediaId: mediaId, coverAlt: alt }))}
          />

          <fieldset className="rounded-lg border border-border p-4">
            <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Search &amp; sharing</legend>
            <div className="space-y-3">
              <Field label="Title override" htmlFor="seoTitle" hint="Used in search results and link previews. Left blank, the article title is used.">
                <input
                  id="seoTitle" value={form.seoTitle} onChange={(e) => set('seoTitle', e.target.value)} maxLength={180}
                  className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm"
                />
              </Field>
              <Field label="Description override" htmlFor="seoDescription">
                <textarea
                  id="seoDescription" value={form.seoDescription} onChange={(e) => set('seoDescription', e.target.value)} rows={2} maxLength={320}
                  className="w-full resize-y rounded-md border border-input bg-card px-3 py-2 text-sm"
                />
              </Field>
            </div>
          </fieldset>

          <fieldset className="rounded-lg border border-border p-4">
            <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Options</legend>
            <div className="space-y-2.5">
              <Check
                id="commentsEnabled" checked={form.commentsEnabled}
                onChange={(v) => set('commentsEnabled', v)}
                label="Allow comments"
              />
              {isAdmin && (
                <>
                  <Check
                    id="official" checked={form.official} onChange={(v) => set('official', v)}
                    label="Official — this speaks for 8 Ball Registry"
                  />
                  <Check
                    id="featured" checked={form.featured} onChange={(v) => set('featured', v)}
                    label="Feature on the homepage"
                  />
                </>
              )}
            </div>
          </fieldset>
        </div>
      )}

      {tab === 'history' && (
        <div className="mt-5">
          <ul className="divide-y divide-border rounded-lg border border-border">
            {revisions.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{r.title}</p>
                  <p className="text-xs text-muted-foreground">
                    Revision {r.revision} · {r.editorName} · {formatDateTime(r.createdAt)}
                    {r.note && <> · {r.note}</>}
                  </p>
                </div>
                <Button
                  size="sm" variant="outline" disabled={pending}
                  onClick={() => run(() => restoreRevisionAction(articleId!, r.id), 'Revision restored.')}
                >
                  <History className="size-4" aria-hidden />Restore
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {message && (
        <p
          role="status"
          className={`mt-5 rounded-md border px-3 py-2 text-sm ${message.ok ? 'border-success/40 bg-success/10 text-success' : 'border-destructive/40 bg-destructive/10 text-destructive'}`}
        >
          {message.text}
        </p>
      )}

      <div className="mt-6 flex flex-wrap items-center gap-2 border-t border-border pt-5">
        <Button disabled={pending} onClick={save}>
          <Save className="size-4" aria-hidden />
          {proposalMode ? 'Save and send for review' : 'Save'}
        </Button>

        {!isNew && !live && (
          canPublish ? (
            <>
              <Button variant="outline" disabled={pending} onClick={publish}>
                <Upload className="size-4" aria-hidden />Publish now
              </Button>
              <Button variant="outline" disabled={pending} onClick={schedule}>
                <Clock className="size-4" aria-hidden />Schedule
              </Button>
            </>
          ) : form.state === 'PENDING_REVIEW' ? (
            <Button variant="outline" disabled={pending} onClick={() => run(() => withdrawSubmissionAction(articleId!), 'Withdrawn.')}>
              Withdraw submission
            </Button>
          ) : (
            <Button variant="outline" disabled={pending} onClick={submit}>
              <Send className="size-4" aria-hidden />Submit for review
            </Button>
          )
        )}

        {!isNew && form.state === 'PUBLISHED' && (
          <>
            <Link
              href={`/news/${form.slug}`}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm hover:border-brand/40"
            >
              <Eye className="size-4" aria-hidden />View
            </Link>
            {isAdmin && (
              <Button variant="outline" disabled={pending} onClick={() => run(() => archiveArticleAction(articleId!), 'Archived.')}>
                <Archive className="size-4" aria-hidden />Archive
              </Button>
            )}
          </>
        )}

        {!isNew && (
          <Button variant="ghost" className="ml-auto text-destructive" disabled={pending} onClick={remove}>
            <Trash2 className="size-4" aria-hidden />Delete
          </Button>
        )}
      </div>
    </div>
  )
}

// --------------------------------------------------------------------------- pieces

function Field({
  label, htmlFor, hint, children,
}: { label: string; htmlFor: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </label>
      {children}
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

function Check({
  id, checked, onChange, label,
}: { id: string; checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label htmlFor={id} className="flex items-center gap-2 text-sm">
      <input
        id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)}
        className="size-4 accent-[var(--gold)]"
      />
      {label}
    </label>
  )
}

function StateBadge({ state, publishAt }: { state: string; publishAt: string | null }) {
  const scheduled = state === 'PUBLISHED' && publishAt != null && new Date(publishAt) > new Date()
  if (scheduled) return <Badge variant="muted"><Clock className="mr-1 size-3" aria-hidden />Scheduled</Badge>
  switch (state) {
    case 'PUBLISHED': return <Badge variant="success"><CheckCircle2 className="mr-1 size-3" aria-hidden />Published</Badge>
    case 'PENDING_REVIEW': return <Badge variant="gold">Awaiting review</Badge>
    case 'REJECTED': return <Badge variant="muted">Needs changes</Badge>
    case 'ARCHIVED': return <Badge variant="muted">Archived</Badge>
    default: return <Badge variant="muted">Draft</Badge>
  }
}

/**
 * The cover image.
 *
 * Uploads go through Payload's own media endpoint, which is where every other image on the site
 * already lives — so an article cover is managed, resized and served exactly like a competition
 * banner rather than becoming a second, parallel image system.
 */
function CoverPicker({
  mediaId, alt, onChange,
}: { mediaId: string | null; alt: string; onChange: (mediaId: string | null, alt: string) => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const upload = async (file: File) => {
    setBusy(true); setError(null)
    try {
      const body = new FormData()
      body.append('file', file)
      body.append('_payload', JSON.stringify({ alt: alt || file.name }))
      const res = await fetch('/api/media', { method: 'POST', body, credentials: 'include' })
      if (!res.ok) throw new Error(`Upload failed (${res.status})`)
      const json = (await res.json()) as { doc?: { filename?: string } }
      const filename = json.doc?.filename
      if (!filename) throw new Error('The upload did not come back with a file name.')
      onChange(filename, alt)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That image could not be uploaded.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <fieldset className="rounded-lg border border-border p-4">
      <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Cover image</legend>

      {mediaId && (
        <div className="mb-3">
          {/* eslint-disable-next-line @next/next/no-img-element -- Payload media, not a static asset */}
          <img src={`/api/media/file/${mediaId}`} alt={alt} className="max-h-48 rounded-md border border-border" />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <input
          type="file" accept="image/*" disabled={busy}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f) }}
          className="text-sm file:mr-3 file:rounded-md file:border file:border-border file:bg-card file:px-3 file:py-1.5 file:text-sm"
        />
        {mediaId && (
          <Button size="sm" variant="ghost" onClick={() => onChange(null, '')}>Remove</Button>
        )}
      </div>

      <div className="mt-3">
        <label htmlFor="coverAlt" className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Describe the image
        </label>
        <input
          id="coverAlt" value={alt} onChange={(e) => onChange(mediaId, e.target.value)}
          placeholder="What a reader who cannot see it needs to know"
          className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm"
        />
      </div>

      {busy && <p className="mt-2 text-xs text-muted-foreground">Uploading…</p>}
      {error && <p role="alert" className="mt-2 text-xs text-destructive">{error}</p>}
    </fieldset>
  )
}
