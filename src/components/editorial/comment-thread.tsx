'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { MessageSquare, Flag, Pencil, Trash2, EyeOff, ShieldCheck, CornerDownRight } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { formatDateTime } from '@/lib/format'
import { linkifyComment, MAX_COMMENT_LENGTH } from '@/lib/editorial/comment-format'
import {
  addCommentAction, editCommentAction, deleteCommentAction, reportCommentAction, hideCommentAction,
} from '@/lib/editorial/actions'

/** Mirror of the server's CommentView, minus the recursion that does not survive serialisation. */
export interface ClientComment {
  id: number
  body: string
  createdAt: string
  editedAt: string | null
  deleted: boolean
  hidden: boolean
  author: { playerId: string | null; name: string; handle: string | null; isAdmin: boolean }
  canEdit: boolean
  canDelete: boolean
  canReport: boolean
  replies: ClientComment[]
}

/**
 * The discussion under an article.
 *
 * Comments are plain text end to end: the composer is a textarea, the store holds exactly what was
 * typed, and links are found in that text at render time rather than authored. So a comment can
 * never contain a link whose visible words disagree with where it goes — the words ARE the
 * destination.
 */
export function CommentThread({
  articleId,
  comments,
  canComment,
  isAdmin,
  locked,
  signedIn,
}: {
  articleId: number
  comments: ClientComment[]
  canComment: boolean
  isAdmin: boolean
  locked: boolean
  signedIn: boolean
}) {
  const total = countComments(comments)

  return (
    <section id="comments" className="mt-14 scroll-mt-24 border-t border-border pt-8">
      <h2 className="flex items-center gap-2 font-display text-xl font-bold tracking-tight">
        <MessageSquare className="size-5 text-brand" aria-hidden />
        {total === 0 ? 'Discussion' : `${total} comment${total === 1 ? '' : 's'}`}
      </h2>

      {locked ? (
        <p className="mt-4 rounded-none border border-border bg-card/40 px-4 py-3 text-sm text-muted-foreground">
          This discussion has been closed.
        </p>
      ) : !canComment ? (
        <p className="mt-4 rounded-none border border-border bg-card/40 px-4 py-3 text-sm text-muted-foreground">
          {signedIn
            ? 'Your account cannot post comments at the moment.'
            : <>You need an account to join the discussion. <Link href="/login" className="text-brand hover:underline">Sign in</Link>.</>}
        </p>
      ) : (
        <div className="mt-5">
          <Composer articleId={articleId} placeholder="Add a comment…" submitLabel="Post comment" />
        </div>
      )}

      <ol className="mt-8 space-y-6">
        {comments.map((c) => (
          <li key={c.id}>
            <Comment
              comment={c}
              articleId={articleId}
              canComment={canComment && !locked}
              isAdmin={isAdmin}
              depth={0}
            />
          </li>
        ))}
      </ol>

      {comments.length === 0 && (
        <p className="mt-6 text-sm text-muted-foreground">No comments yet.</p>
      )}
    </section>
  )
}

function countComments(list: ClientComment[]): number {
  return list.reduce((n, c) => n + (c.deleted || c.hidden ? 0 : 1) + countComments(c.replies), 0)
}

function Comment({
  comment, articleId, canComment, isAdmin, depth,
}: {
  comment: ClientComment
  articleId: number
  canComment: boolean
  isAdmin: boolean
  depth: number
}) {
  const router = useRouter()
  const confirm = useConfirm()
  const [pending, start] = useTransition()
  const [mode, setMode] = useState<'view' | 'edit' | 'reply'>('view')
  const [error, setError] = useState<string | null>(null)

  const removed = comment.deleted || comment.hidden

  const act = (fn: () => Promise<{ ok?: boolean; error?: string }>) => {
    setError(null)
    start(async () => {
      const r = await fn()
      if (r.error) setError(r.error)
      else { setMode('view'); router.refresh() }
    })
  }

  const askDelete = () => {
    void confirm({
      title: 'Delete this comment?',
      message: 'The text is removed for good. Any replies underneath it stay where they are.',
      confirmLabel: 'Delete', cancelLabel: 'Cancel', tone: 'danger',
    }).then((r) => { if (r.confirmed) act(() => deleteCommentAction(comment.id)) })
  }

  const askHide = () => {
    void confirm({
      title: 'Remove this comment?',
      message: 'It stops being visible to readers. You can restore it from the editorial queue.',
      confirmLabel: 'Remove', cancelLabel: 'Cancel', tone: 'warning',
      input: { label: 'Reason (optional)', placeholder: 'Why is it being removed?' },
    }).then((r) => { if (r.confirmed) act(() => hideCommentAction(comment.id, r.value)) })
  }

  const askReport = () => {
    void confirm({
      title: 'Report this comment?',
      message: 'An administrator will look at it. Tell them what is wrong.',
      confirmLabel: 'Report', cancelLabel: 'Cancel', tone: 'warning',
      input: { label: 'Reason', placeholder: 'What is wrong with it?' },
    }).then((r) => {
      if (!r.confirmed) return
      act(async () => {
        const res = await reportCommentAction(comment.id, r.value ?? '')
        if (res.ok) setError(null)
        return res
      })
    })
  }

  return (
    <article className={depth > 0 ? 'border-l-2 border-border pl-4' : ''}>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">
          {removed ? 'Removed' : comment.author.handle ?? comment.author.name}
        </span>
        {!removed && comment.author.isAdmin && (
          <Badge variant="gold"><ShieldCheck className="mr-1 size-3" aria-hidden />8 Ball Registry</Badge>
        )}
        <time dateTime={comment.createdAt}>{formatDateTime(comment.createdAt)}</time>
        {comment.editedAt && <span className="italic">edited</span>}
      </div>

      {removed ? (
        <p className="mt-1.5 text-sm italic text-muted-foreground">
          {comment.hidden ? 'This comment was removed by a moderator.' : 'This comment was deleted by its author.'}
        </p>
      ) : mode === 'edit' ? (
        <div className="mt-2">
          <Composer
            articleId={articleId}
            initial={comment.body}
            submitLabel="Save changes"
            onCancel={() => setMode('view')}
            onSubmit={(body) => editCommentAction(comment.id, body)}
          />
        </div>
      ) : (
        <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">
          {linkifyComment(comment.body).map((part, i) =>
            part.href ? (
              <a
                key={i}
                href={part.href}
                target="_blank"
                rel="noopener noreferrer nofollow ugc"
                className="text-brand underline decoration-brand/40 underline-offset-2"
              >
                {part.text}
              </a>
            ) : (
              <span key={i}>{part.text}</span>
            ),
          )}
        </p>
      )}

      {error && <p role="alert" className="mt-2 text-xs text-destructive">{error}</p>}

      {!removed && mode === 'view' && (
        <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
          {canComment && depth === 0 && (
            <button type="button" onClick={() => setMode('reply')} className="inline-flex items-center gap-1 text-muted-foreground hover:text-brand">
              <CornerDownRight className="size-3" aria-hidden />Reply
            </button>
          )}
          {comment.canEdit && (
            <button type="button" onClick={() => setMode('edit')} className="inline-flex items-center gap-1 text-muted-foreground hover:text-brand">
              <Pencil className="size-3" aria-hidden />Edit
            </button>
          )}
          {comment.canDelete && (
            <button type="button" disabled={pending} onClick={askDelete} className="inline-flex items-center gap-1 text-muted-foreground hover:text-destructive">
              <Trash2 className="size-3" aria-hidden />Delete
            </button>
          )}
          {comment.canReport && (
            <button type="button" disabled={pending} onClick={askReport} className="inline-flex items-center gap-1 text-muted-foreground hover:text-warning">
              <Flag className="size-3" aria-hidden />Report
            </button>
          )}
          {isAdmin && (
            <button type="button" disabled={pending} onClick={askHide} className="inline-flex items-center gap-1 text-muted-foreground hover:text-destructive">
              <EyeOff className="size-3" aria-hidden />Remove
            </button>
          )}
        </div>
      )}

      {mode === 'reply' && (
        <div className="mt-3">
          <Composer
            articleId={articleId}
            placeholder={`Reply to ${comment.author.handle ?? comment.author.name}…`}
            submitLabel="Post reply"
            onCancel={() => setMode('view')}
            onSubmit={(body) => addCommentAction(articleId, body, comment.id)}
          />
        </div>
      )}

      {comment.replies.length > 0 && (
        <ol className="mt-4 space-y-4">
          {comment.replies.map((r) => (
            <li key={r.id}>
              <Comment comment={r} articleId={articleId} canComment={canComment} isAdmin={isAdmin} depth={depth + 1} />
            </li>
          ))}
        </ol>
      )}
    </article>
  )
}

/** The comment box. Plain text, a visible length budget, and no formatting controls. */
function Composer({
  articleId, initial = '', placeholder = 'Write a comment…', submitLabel, onCancel, onSubmit,
}: {
  articleId: number
  initial?: string
  placeholder?: string
  submitLabel: string
  onCancel?: () => void
  onSubmit?: (body: string) => Promise<{ ok?: boolean; error?: string }>
}) {
  const router = useRouter()
  const [value, setValue] = useState(initial)
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const remaining = MAX_COMMENT_LENGTH - value.length

  const submit = () => {
    setError(null)
    start(async () => {
      const r = await (onSubmit ? onSubmit(value) : addCommentAction(articleId, value))
      if (r.error) { setError(r.error); return }
      setValue('')
      onCancel?.()
      router.refresh()
    })
  }

  return (
    <div>
      <label className="sr-only" htmlFor={`composer-${articleId}-${submitLabel}`}>{placeholder}</label>
      <textarea
        id={`composer-${articleId}-${submitLabel}`}
        value={value}
        onChange={(e) => setValue(e.target.value.slice(0, MAX_COMMENT_LENGTH))}
        placeholder={placeholder}
        rows={4}
        className="w-full resize-y rounded-none border border-input bg-card px-3 py-2 text-sm outline-none focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/25"
      />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={pending || value.trim().length < 2} onClick={submit}>{submitLabel}</Button>
        {onCancel && <Button size="sm" variant="ghost" disabled={pending} onClick={onCancel}>Cancel</Button>}
        <span className={`ml-auto text-xs ${remaining < 100 ? 'text-warning' : 'text-muted-foreground'}`}>
          {remaining} left
        </span>
      </div>
      {error && <p role="alert" className="mt-2 text-sm text-destructive">{error}</p>}
    </div>
  )
}
