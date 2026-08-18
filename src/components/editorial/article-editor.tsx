'use client'

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  Save, Send, Eye, Upload, CheckCircle2, Clock, History, Trash2, Archive, AlertTriangle, Link2,
  UserPen, CalendarClock,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { formatDate, formatDateTime } from '@/lib/format'
import { buildDocument } from '@/lib/editorial/richtext'
import { slugify } from '@/lib/editorial/slug-format'
import { RichText } from '@/components/editorial/rich-text'
import {
  createArticleAction, updateArticleAction, autosaveDraftAction, submitForReviewAction,
  withdrawSubmissionAction, publishArticleAction, archiveArticleAction, deleteArticleAction,
  restoreRevisionAction, checkSlugAction, createPreviewLinkAction,
} from '@/lib/editorial/actions'

/**
 * Has this instant already passed?
 *
 * Module scope on purpose. Reading the clock while rendering makes a component's output depend on
 * when React happened to render it, so this is only ever called from an event handler or an effect.
 */
function hasPassed(when: Date): boolean {
  return when.getTime() < Date.now()
}

export interface EditorCategory { id: number; name: string; adminOnly: boolean }
export interface EditorMember { playerId: string; name: string; handle: string | null }
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
  /** Whose name goes on the article. Defaults to the person writing it. */
  authorPlayerId: string
  authorLabel: string
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
  members = [],
  canAttributeAuthor = false,
  canBackdate = false,
  selfPlayerId,
  initialTab = 'write',
}: {
  initial: EditorArticle
  categories: EditorCategory[]
  revisions?: EditorRevision[]
  /** Whether this person may publish this article without review. Decided on the server. */
  canPublish: boolean
  isAdmin: boolean
  /** Members who can be given a byline. Only sent to somebody allowed to change it. */
  members?: EditorMember[]
  /** Owner only. The server decides this; the picker merely reflects it. */
  canAttributeAuthor?: boolean
  /** Owner only. Whether a publication date in the past may be set. */
  canBackdate?: boolean
  /** The signed-in author's own player id, so "you" can be labelled and listed first. */
  selfPlayerId: string
  /** Which section opens first. Lets a link point straight at settings rather than the prose. */
  initialTab?: 'write' | 'preview' | 'settings' | 'history'
}) {
  const router = useRouter()
  const confirm = useConfirm()
  const [pending, start] = useTransition()

  const [articleId, setArticleId] = useState(initial.id)
  const [form, setForm] = useState(initial)
  const [tab, setTab] = useState<'write' | 'preview' | 'settings' | 'history'>(initialTab)
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
    // Sent only when this person may actually set it. The server ignores it otherwise, but there is
    // no reason for the field to be on the wire at all for somebody who cannot use it.
    authorPlayerId: canAttributeAuthor ? form.authorPlayerId : null,
    publishAt: canBackdate ? form.publishAt : undefined,
  }), [form, canAttributeAuthor, canBackdate])

  // --------------------------------------------------------------- autosave

  const dirty = useRef(false)
  const latest = useRef(form)
  // Written in an effect rather than during render: the autosave timer needs the newest form, and a
  // ref assigned mid-render is read before React has committed the change it belongs to.
  useEffect(() => {
    latest.current = form
    dirty.current = true
  }, [form])

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
    // Everything happens inside the debounce, including clearing the state for an empty slug: an
    // effect that calls setState on its way in makes React render twice for every keystroke.
    const timer = window.setTimeout(() => {
      if (!candidate) { setSlugState({ checking: false, available: null }); return }
      setSlugState({ checking: true, available: null })
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
    // A date already chosen in Settings is what the article will carry; the confirmation says so
    // rather than letting somebody discover it afterwards on the published page.
    const dated = canBackdate && form.publishAt ? new Date(form.publishAt) : null
    const backdated = dated != null && hasPassed(dated)

    void confirm({
      title: 'Publish this article?',
      message: dated
        ? backdated
          ? `It becomes visible immediately, dated ${formatDate(dated.toISOString())}.`
          : `It stays hidden until ${formatDateTime(dated.toISOString())}, then appears on its own.`
        : 'It becomes visible to everybody immediately.',
      confirmLabel: dated && !backdated ? 'Schedule' : 'Publish',
      cancelLabel: 'Cancel',
    }).then((r) => {
      if (!r.confirmed) return
      run(
        () => publishArticleAction(articleId!, dated ? dated.toISOString() : null),
        dated ? (backdated ? `Published, dated ${formatDate(dated.toISOString())}.` : 'Scheduled.') : 'Published.',
      )
    })
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

  /**
   * A shareable link to an unpublished draft.
   *
   * Copied straight to the clipboard rather than shown in a dialog, because the link IS the
   * credential and the fewer places it is displayed the better.
   */
  const shareDraft = () => {
    setMessage(null)
    start(async () => {
      const r = await createPreviewLinkAction(articleId!)
      if (r.error || !r.data) { setMessage({ text: r.error ?? 'That link could not be created.' }); return }
      const url = `${window.location.origin}${r.data}`
      try {
        await navigator.clipboard.writeText(url)
        setMessage({ ok: true, text: 'Preview link copied. It expires in three days.' })
      } catch {
        setMessage({ ok: true, text: url })
      }
    })
  }

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
          {/* Shown whenever the byline is not the writer's own, so an attributed article can never
              be published under somebody else's name by accident. */}
          {form.authorPlayerId !== selfPlayerId && (
            <Badge variant="gold"><UserPen className="mr-1 size-3" aria-hidden />By {form.authorLabel}</Badge>
          )}
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
          {canBackdate && (
            <PublicationDate
              value={form.publishAt}
              onChange={(publishAt) => setForm((f) => ({ ...f, publishAt }))}
            />
          )}

          {canAttributeAuthor && (
            <AuthorPicker
              members={members}
              selfPlayerId={selfPlayerId}
              value={form.authorPlayerId}
              onChange={(playerId, label) => setForm((f) => ({ ...f, authorPlayerId: playerId, authorLabel: label }))}
            />
          )}

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

        {!isNew && form.state !== 'PUBLISHED' && (
          <Button variant="ghost" disabled={pending} onClick={shareDraft}>
            <Link2 className="size-4" aria-hidden />Copy preview link
          </Button>
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
 * The date the article carries.
 *
 * Owner-only, because a date in the past is a claim about when something was said. It doubles as
 * the scheduling control: past backdates, future schedules, blank means "whenever I publish it".
 *
 * The preview underneath is not decoration. The input is in the browser's local time while the site
 * renders every date in UTC, so an evening in Phoenix can land on the following day once published.
 * Showing the rendered date as it is typed makes that visible instead of surprising.
 */
function PublicationDate({
  value, onChange,
}: { value: string | null; onChange: (value: string | null) => void }) {
  // Read once, at mount. A date typed now is being compared against "roughly now", and re-reading
  // the clock on every keystroke would make the preview flip mid-render for no benefit.
  const [mountedAt] = useState(() => Date.now())
  // <input type="datetime-local"> wants "YYYY-MM-DDTHH:mm" in local time, with no zone.
  const toLocalInput = (iso: string | null): string => {
    if (!iso) return ''
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return ''
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
  }

  const parsed = value ? new Date(value) : null
  const valid = parsed != null && !Number.isNaN(parsed.getTime())
  const backdated = valid && parsed.getTime() < mountedAt

  return (
    <fieldset className="rounded-lg border border-border p-4">
      <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Publication date
      </legend>

      <p className="mb-3 text-xs text-muted-foreground">
        Leave this blank to use the moment you publish. Set a date in the past to publish something
        written years ago under the date it was written; set one in the future to schedule it.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="publishAt" className="sr-only">Publication date and time</label>
        <input
          id="publishAt"
          type="datetime-local"
          value={toLocalInput(value)}
          onChange={(e) => onChange(e.target.value ? new Date(e.target.value).toISOString() : null)}
          className="rounded-md border border-input bg-card px-3 py-2 text-sm outline-none focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/25"
        />
        {value && (
          <Button size="sm" variant="ghost" onClick={() => onChange(null)}>Clear</Button>
        )}
      </div>

      <p className={`mt-3 flex items-center gap-1.5 text-sm ${valid ? 'text-brand' : 'text-muted-foreground'}`}>
        <CalendarClock className="size-4 shrink-0" aria-hidden />
        {!valid
          ? 'Dated the moment you publish it.'
          : backdated
            ? <>Will read <span className="font-medium">{formatDate(parsed.toISOString())}</span> and go live as soon as you publish.</>
            : <>Hidden until <span className="font-medium">{formatDateTime(parsed.toISOString())}</span>, then it appears on its own.</>}
      </p>
    </fieldset>
  )
}

/**
 * Who the article is published as.
 *
 * Owner-only, and shown only when the server said so — the picker reflects a permission, it does not
 * grant one. The default is always the person writing, so an Owner who never opens this tab publishes
 * under their own name, which is the common case.
 *
 * A filter box sits above the list because this is a roster, not a short menu: it is usable with
 * thirty members and still usable with three hundred. The filter matches CueVerse ID and preferred
 * name together, since either may be what the Owner remembers.
 */
function AuthorPicker({
  members, selfPlayerId, value, onChange,
}: {
  members: EditorMember[]
  selfPlayerId: string
  value: string
  onChange: (playerId: string, label: string) => void
}) {
  const [filter, setFilter] = useState('')

  const labelFor = (m: EditorMember) => m.handle ?? m.name
  // The signed-in author leads the list: attributing to somebody else is the exception, and getting
  // back to the default should never mean scrolling for it.
  const ordered = useMemo(() => {
    const self = members.filter((m) => m.playerId === selfPlayerId)
    const rest = members.filter((m) => m.playerId !== selfPlayerId)
    return [...self, ...rest]
  }, [members, selfPlayerId])

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return ordered
    return ordered.filter((m) => `${m.handle ?? ''} ${m.name}`.toLowerCase().includes(q))
  }, [ordered, filter])

  const chosen = members.find((m) => m.playerId === value)
  const isSelf = value === selfPlayerId

  return (
    <fieldset className="rounded-lg border border-border p-4">
      <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Author</legend>

      <p className="mb-3 text-xs text-muted-foreground">
        Whose name appears on the article. Use this when you are posting somebody else&apos;s words —
        a Discord message, say — so the byline credits them rather than you.
      </p>

      <div className="space-y-2">
        <label htmlFor="author-filter" className="sr-only">Filter members</label>
        <input
          id="author-filter"
          type="search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter by CueVerse ID or name…"
          className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm outline-none focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/25"
        />

        <label htmlFor="author" className="sr-only">Author</label>
        <select
          id="author"
          value={value}
          onChange={(e) => {
            const m = members.find((x) => x.playerId === e.target.value)
            if (m) onChange(m.playerId, labelFor(m))
          }}
          size={Math.min(8, Math.max(3, shown.length))}
          className="w-full rounded-md border border-input bg-card px-2 py-1.5 text-sm"
        >
          {shown.map((m) => (
            <option key={m.playerId} value={m.playerId}>
              {labelFor(m)}
              {m.playerId === selfPlayerId ? ' — you' : m.handle && m.name !== m.handle ? ` (${m.name})` : ''}
            </option>
          ))}
        </select>

        {shown.length === 0 && (
          <p className="text-xs text-muted-foreground">Nobody matches that.</p>
        )}
      </div>

      <p className={`mt-3 text-sm ${isSelf ? 'text-muted-foreground' : 'text-brand'}`}>
        {isSelf
          ? 'Publishing under your own name.'
          : <>Publishing as <span className="font-medium">{chosen ? labelFor(chosen) : value}</span>. Readers will see only their byline.</>}
      </p>
    </fieldset>
  )
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
