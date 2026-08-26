'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

import { updatePostAction } from '@/lib/break/post-actions'
import { POST_TYPES, MAX_TITLE, type PostType } from '@/lib/break/post-types'
import { BodyEditor } from '@/components/editorial/body-editor'
import { parseArticleBody } from '@/lib/editorial/richtext'

/**
 * The post editor, for an author or for staff.
 *
 * ── One editor, not two ──────────────────────────────────────────────────────────────────────────
 * There is no separate admin form. The fields here are the fields a post has, and who is allowed to
 * change them is decided on the server; an admin sees the same editor the author would, because a
 * second editing framework is how the two drift until one of them forgets to sanitise something.
 *
 * ── What is deliberately absent ──────────────────────────────────────────────────────────────────
 * There is no author field. Editing somebody's post is not the same as becoming its author, and the
 * absence is the mechanism rather than a rule written down somewhere — a field that does not exist
 * cannot be submitted, and the action strips one anyway if it ever appears.
 *
 * Only what changed is sent. Fields the editor did not touch are left out of the payload, so the
 * service can tell an untouched field from one deliberately set back to its old value, and an
 * "edit" that altered nothing writes nothing at all.
 *
 * ── The body ─────────────────────────────────────────────────────────────────────────────────────
 * The body is edited in `BodyEditor`, the same composer an article is written in, with the same
 * paste-to-upload pipeline and the same GIPHY picker. What is stored is never what the composer
 * shows: the document goes in as a node tree, is serialised for editing, and is parsed and sanitised
 * back into a node tree on the way out. The editing surface is a representation; the canonical body
 * is the tree, and it is the tree the service sanitises and writes.
 *
 * That round trip was measured before it was relied on — every post in the database survives
 * serialise-then-parse byte-identically, including ordered-list starts and media references.
 */
export function PostEditor({
  postId,
  slug,
  initial,
  canMarkOfficial,
  returnTo,
}: {
  postId: number
  slug: string
  initial: {
    title: string
    type: PostType
    linkUrl: string | null
    spoiler: boolean
    sensitive: boolean
    official: boolean
    /** The body as the composer edits it, serialised from the canonical node tree. */
    bodySource: string
  }
  /** Only staff may mark a post as speaking for the site. */
  canMarkOfficial: boolean
  returnTo: string
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const [title, setTitle] = useState(initial.title)
  const [type, setType] = useState<PostType>(initial.type)
  const [linkUrl, setLinkUrl] = useState(initial.linkUrl ?? '')
  const [spoiler, setSpoiler] = useState(initial.spoiler)
  const [sensitive, setSensitive] = useState(initial.sensitive)
  const [official, setOfficial] = useState(initial.official)
  const [body, setBody] = useState(initial.bodySource)

  const dirty =
    title !== initial.title
    || type !== initial.type
    || (linkUrl || null) !== initial.linkUrl
    || spoiler !== initial.spoiler
    || sensitive !== initial.sensitive
    || official !== initial.official
    || body !== initial.bodySource

  /*
   * Leaving with unsaved work should cost a keystroke, not a post.
   *
   * Only the browser's own prompt: a custom dialog cannot intercept a closed tab or a typed URL, so
   * it would guard the one route people are least likely to take.
   */
  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  function save() {
    setError(null)
    setSaved(false)

    // Only what actually moved.
    const input: Record<string, unknown> = {}
    if (title !== initial.title) input.title = title
    if (type !== initial.type) input.type = type
    if ((linkUrl || null) !== initial.linkUrl) input.linkUrl = linkUrl || null
    if (spoiler !== initial.spoiler) input.spoiler = spoiler
    if (sensitive !== initial.sensitive) input.sensitive = sensitive
    if (canMarkOfficial && official !== initial.official) input.official = official
    /*
     * Parsed here, sanitised on the server. The client's tree is a proposal: `updatePost` runs it
     * through the same sanitizer post creation uses, so nothing reaches the database because a
     * browser said it should.
     */
    if (body !== initial.bodySource) input.body = parseArticleBody(body)

    if (Object.keys(input).length === 0) { setSaved(true); return }

    startTransition(async () => {
      const r = await updatePostAction(postId, input)
      if (!r.ok) { setError(r.error ?? 'That could not be saved.'); return }
      setSaved(true)
      router.push(`/the-break/${r.slug ?? slug}`)
      router.refresh()
    })
  }

  const field = 'w-full rounded-none border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus-visible:border-[var(--gold)]'

  return (
    <div className="space-y-4">
      <div>
        <label htmlFor="post-title" className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted-foreground">Title</label>
        <input
          id="post-title" value={title} maxLength={MAX_TITLE}
          onChange={(e) => setTitle(e.target.value)} className={field}
        />
      </div>

      <div>
        <label htmlFor="post-type" className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted-foreground">Post type</label>
        <select id="post-type" value={type} onChange={(e) => setType(e.target.value as PostType)} className={field}>
          {POST_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
        </select>
        <p className="mt-1 text-xs text-muted-foreground">
          A published post that already has replies or votes keeps its type — the service refuses the
          change rather than rewriting what people responded to.
        </p>
      </div>

      <div>
        <label htmlFor="post-link" className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted-foreground">Link</label>
        <input id="post-link" value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} className={field} placeholder="https://" />
      </div>

      <fieldset className="space-y-2">
        <legend className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Moderation</legend>
        <label className="flex items-center gap-2 text-sm text-foreground">
          <input type="checkbox" checked={spoiler} onChange={(e) => setSpoiler(e.target.checked)} />
          Spoiler
        </label>
        <label className="flex items-center gap-2 text-sm text-foreground">
          <input type="checkbox" checked={sensitive} onChange={(e) => setSensitive(e.target.checked)} />
          Content warning
        </label>
        {canMarkOfficial && (
          <label className="flex items-center gap-2 text-sm text-foreground">
            <input type="checkbox" checked={official} onChange={(e) => setOfficial(e.target.checked)} />
            Official — speaks for the site
          </label>
        )}
      </fieldset>

      <div>
        <label htmlFor="post-body" className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted-foreground">Body</label>
        <BodyEditor
          id="post-body"
          value={body}
          onChange={setBody}
          rows={18}
          giphyEnabled
          placeholder="Write the post…"
        />
      </div>

      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {saved && !error && <p role="status" className="text-sm text-[var(--gold)]">Saved.</p>}

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={() => {
            if (dirty && !window.confirm('Discard your unsaved changes to this post?')) return
            router.push(returnTo)
          }}
          disabled={pending}
          className="rounded-none border border-input px-3 py-1.5 text-sm text-foreground hover:bg-white/[0.06] disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button" onClick={save} disabled={pending}
          className="rounded-md bg-[var(--gold)] px-3 py-1.5 text-sm font-semibold text-black hover:opacity-90 disabled:opacity-50"
        >
          {pending ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </div>
  )
}
