'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Check, X, Clock, Flag, EyeOff, RotateCcw, ExternalLink } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { formatDateTime } from '@/lib/format'
import {
  approveArticleAction, rejectArticleAction, hideCommentAction, unhideCommentAction, resolveReportAction,
} from '@/lib/editorial/actions'

export interface QueueSubmission {
  id: number
  slug: string
  title: string
  excerpt: string | null
  author: string
  categoryName: string | null
  submittedAt: string | null
}

export interface QueueProposal {
  id: number
  slug: string
  title: string
  proposedTitle: string | null
  author: string
  submittedAt: string | null
}

export interface QueueReport {
  id: number
  reason: string
  createdAt: string
  comment: {
    id: number
    body: string
    author: string
    createdAt: string
    hidden: boolean
    deleted: boolean
    article: { slug: string; title: string }
  } | null
}

/**
 * The administrator's editorial queue.
 *
 * Submissions, proposed edits to live articles, and open comment reports in one place, because they
 * are one job — "what needs a decision from me". Three separate pages with three separate counts is
 * how a backlog grows without anybody noticing it.
 */
export function ModerationQueue({
  submissions, proposals, reports,
}: {
  submissions: QueueSubmission[]
  proposals: QueueProposal[]
  reports: QueueReport[]
}) {
  const total = submissions.length + proposals.length + reports.length

  if (total === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border py-14 text-center">
        <p className="text-sm text-muted-foreground">Nothing is waiting for a decision.</p>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      {submissions.length > 0 && (
        <Section title="Awaiting review" count={submissions.length}>
          <ul className="divide-y divide-border rounded-none border border-border">
            {submissions.map((s) => <li key={s.id} className="p-4"><Submission item={s} /></li>)}
          </ul>
        </Section>
      )}

      {proposals.length > 0 && (
        <Section title="Proposed edits to published articles" count={proposals.length}>
          <ul className="divide-y divide-border rounded-none border border-border">
            {proposals.map((p) => <li key={p.id} className="p-4"><Proposal item={p} /></li>)}
          </ul>
        </Section>
      )}

      {reports.length > 0 && (
        <Section title="Reported comments" count={reports.length}>
          <ul className="divide-y divide-border rounded-none border border-border">
            {reports.map((r) => <li key={r.id} className="p-4"><Report item={r} /></li>)}
          </ul>
        </Section>
      )}
    </div>
  )
}

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-3 flex items-center gap-2 border-b border-border pb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
        <Badge variant="gold">{count}</Badge>
      </h2>
      {children}
    </section>
  )
}

/** Shared action runner: surfaces an expected refusal next to the buttons and refreshes on success. */
function useAction() {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const run = (fn: () => Promise<{ ok?: boolean; error?: string }>) => {
    setError(null)
    start(async () => {
      const r = await fn()
      if (r.error) setError(r.error)
      else router.refresh()
    })
  }
  return { pending, error, run }
}

function Submission({ item }: { item: QueueSubmission }) {
  const confirm = useConfirm()
  const { pending, error, run } = useAction()

  const reject = () => {
    void confirm({
      title: 'Send this back?',
      message: 'The author sees your reason and can revise and resubmit. Nobody else sees it.',
      confirmLabel: 'Send back', cancelLabel: 'Cancel', tone: 'warning',
      input: { label: 'What needs changing?', required: true, multiline: true },
    }).then((r) => { if (r.confirmed && r.value.trim()) run(() => rejectArticleAction(item.id, r.value)) })
  }

  const schedule = () => {
    void confirm({
      title: 'Approve and schedule',
      message: 'Give a date and time in your local time zone.',
      confirmLabel: 'Schedule', cancelLabel: 'Cancel',
      input: { label: 'Publish at', placeholder: 'YYYY-MM-DD HH:MM', required: true },
    }).then((r) => {
      if (!r.confirmed) return
      const when = new Date(r.value.replace(' ', 'T'))
      if (Number.isNaN(when.getTime())) return
      run(() => approveArticleAction(item.id, when.toISOString()))
    })
  }

  return (
    <div>
      <div className="flex flex-wrap items-baseline gap-2">
        <Link href={`/news/${item.slug}/edit`} className="font-medium hover:text-brand">{item.title}</Link>
        {item.categoryName && <Badge variant="muted">{item.categoryName}</Badge>}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {item.author}
        {item.submittedAt && <> · submitted {formatDateTime(item.submittedAt)}</>}
      </p>
      {item.excerpt && <p className="mt-2 text-sm text-foreground/80">{item.excerpt}</p>}

      {error && <p role="alert" className="mt-2 text-xs text-destructive">{error}</p>}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={pending} onClick={() => run(() => approveArticleAction(item.id, null))}>
          <Check className="size-4" aria-hidden />Approve and publish
        </Button>
        <Button size="sm" variant="outline" disabled={pending} onClick={schedule}>
          <Clock className="size-4" aria-hidden />Approve and schedule
        </Button>
        <Button size="sm" variant="outline" disabled={pending} onClick={reject}>
          <X className="size-4" aria-hidden />Send back
        </Button>
        <Link
          href={`/news/${item.slug}/edit`}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-brand"
        >
          Read it <ExternalLink className="size-3" aria-hidden />
        </Link>
      </div>
    </div>
  )
}

function Proposal({ item }: { item: QueueProposal }) {
  const confirm = useConfirm()
  const { pending, error, run } = useAction()

  const reject = () => {
    void confirm({
      title: 'Reject this change?',
      message: 'The published article stays exactly as it is. The author sees your reason.',
      confirmLabel: 'Reject change', cancelLabel: 'Cancel', tone: 'warning',
      input: { label: 'Why?', required: true, multiline: true },
    }).then((r) => { if (r.confirmed && r.value.trim()) run(() => rejectArticleAction(item.id, r.value)) })
  }

  return (
    <div>
      <p className="font-medium">
        <Link href={`/news/${item.slug}/edit`} className="hover:text-brand">{item.title}</Link>
      </p>
      {item.proposedTitle && item.proposedTitle !== item.title && (
        <p className="mt-1 text-xs text-muted-foreground">
          Proposed title: <span className="text-foreground">{item.proposedTitle}</span>
        </p>
      )}
      <p className="mt-1 text-xs text-muted-foreground">
        {item.author}
        {item.submittedAt && <> · proposed {formatDateTime(item.submittedAt)}</>}
      </p>

      {error && <p role="alert" className="mt-2 text-xs text-destructive">{error}</p>}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={pending} onClick={() => run(() => approveArticleAction(item.id, null))}>
          <Check className="size-4" aria-hidden />Apply the change
        </Button>
        <Button size="sm" variant="outline" disabled={pending} onClick={reject}>
          <X className="size-4" aria-hidden />Reject
        </Button>
        <Link href={`/news/${item.slug}/edit`} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-brand">
          Compare <ExternalLink className="size-3" aria-hidden />
        </Link>
      </div>
    </div>
  )
}

function Report({ item }: { item: QueueReport }) {
  const confirm = useConfirm()
  const { pending, error, run } = useAction()
  const c = item.comment
  if (!c) return null

  const remove = () => {
    void confirm({
      title: 'Remove this comment?',
      message: 'It stops being visible. You can restore it later; the text is kept for that.',
      confirmLabel: 'Remove', cancelLabel: 'Cancel', tone: 'warning',
      input: { label: 'Reason (optional)' },
    }).then((r) => {
      if (!r.confirmed) return
      run(async () => {
        const hidden = await hideCommentAction(c.id, r.value)
        if (hidden.error) return hidden
        return resolveReportAction(item.id, 'Comment removed')
      })
    })
  }

  return (
    <div>
      <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <Flag className="size-3 text-warning" aria-hidden />
        Reported {formatDateTime(item.createdAt)}
        {c.hidden && <Badge variant="muted">Already removed</Badge>}
        {c.deleted && <Badge variant="muted">Deleted by author</Badge>}
      </p>
      <p className="mt-1.5 text-sm"><span className="text-muted-foreground">Reason: </span>{item.reason}</p>

      <blockquote className="mt-2 border-l-2 border-border pl-3 text-sm text-foreground/80">
        <p className="whitespace-pre-wrap">{c.body || <em className="text-muted-foreground">removed</em>}</p>
        <footer className="mt-1 text-xs text-muted-foreground">
          {c.author} · {formatDateTime(c.createdAt)} · on{' '}
          <Link href={`/news/${c.article.slug}#comments`} className="hover:text-brand">{c.article.title}</Link>
        </footer>
      </blockquote>

      {error && <p role="alert" className="mt-2 text-xs text-destructive">{error}</p>}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {!c.hidden && !c.deleted && (
          <Button size="sm" variant="outline" disabled={pending} onClick={remove}>
            <EyeOff className="size-4" aria-hidden />Remove comment
          </Button>
        )}
        {c.hidden && (
          <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => unhideCommentAction(c.id))}>
            <RotateCcw className="size-4" aria-hidden />Restore comment
          </Button>
        )}
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => resolveReportAction(item.id, 'No action needed'))}>
          <Check className="size-4" aria-hidden />Dismiss report
        </Button>
      </div>
    </div>
  )
}
