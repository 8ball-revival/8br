'use client'

import { useState } from 'react'
import Link from 'next/link'
import { MessageSquare, ChevronRight, Minus, BadgeCheck, Pin, Lock } from 'lucide-react'

import { cn } from '@/lib/utils'
import { RichText } from '@/components/editorial/rich-text'
import type { RichDocument } from '@/lib/editorial/richtext'
import type { CommentNode } from '@/lib/break/comments'
import { VoteControl } from './vote-control'
import { CommentComposer } from './comment-composer'

/**
 * The comment tree.
 *
 * ── Indentation has a floor ──────────────────────────────────────────────────────────────────────
 * Each level indents by a fixed amount that STOPS growing after a few levels, and the rail is drawn
 * with a border rather than padding so the text column keeps a usable width on a phone. Past the
 * server's visible depth the branch offers "Continue this thread" instead of squeezing another reply
 * into a column three words wide.
 *
 * ── Collapsing ───────────────────────────────────────────────────────────────────────────────────
 * A real button with `aria-expanded`, controlling the subtree by id, so a screen reader is told the
 * branch collapsed and how much went with it. Collapsing hides the replies and keeps the header, so
 * the thread's shape stays readable while it is folded.
 */
export function CommentThread({
  nodes,
  postSlug,
  postLocked,
  signedIn,
  viewerPlayerId,
  isModerator,
}: {
  nodes: CommentNode[]
  postSlug: string
  postLocked: boolean
  signedIn: boolean
  viewerPlayerId: string | null
  isModerator: boolean
}) {
  if (nodes.length === 0) {
    return (
      <p className="rounded-none border border-border bg-card/40 p-6 text-center text-sm text-muted-foreground">
        No comments yet.
      </p>
    )
  }
  return (
    <ol className="flex flex-col gap-3" role="list">
      {nodes.map((n) => (
        <li key={n.id}>
          <Comment
            node={n} postSlug={postSlug} postLocked={postLocked}
            signedIn={signedIn} viewerPlayerId={viewerPlayerId} isModerator={isModerator}
          />
        </li>
      ))}
    </ol>
  )
}

function Comment({
  node, postSlug, postLocked, signedIn, viewerPlayerId, isModerator,
}: {
  node: CommentNode
  postSlug: string
  postLocked: boolean
  signedIn: boolean
  viewerPlayerId: string | null
  isModerator: boolean
}) {
  const [collapsed, setCollapsed] = useState(false)
  const [replying, setReplying] = useState(false)

  const gone = node.deletedAt != null || node.removedAt != null
  const mine = viewerPlayerId != null && node.authorPlayerId === viewerPlayerId
  const permalink = `/the-break/${postSlug}?thread=${node.id}#c${node.id}`
  const canReply = signedIn && !postLocked && !node.locked && !gone

  return (
    <div id={`c${node.id}`} className="min-w-0">
      <div className="flex min-w-0 gap-2">
        <div className="flex flex-col items-center gap-1">
          {gone ? (
            <span className="w-7" aria-hidden />
          ) : (
            <VoteControl
              target="comment" id={node.id} score={node.score} viewerVote={node.viewerVote}
              signedIn={signedIn} returnTo={permalink} compact
            />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
            <button
              type="button"
              onClick={() => setCollapsed((v) => !v)}
              aria-expanded={!collapsed}
              aria-controls={`replies-${node.id}`}
              aria-label={collapsed
                ? `Expand this comment and its ${node.replyCount} replies`
                : 'Collapse this comment'}
              className="grid size-5 place-items-center rounded text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]/60"
            >
              {collapsed ? <ChevronRight className="size-3.5" aria-hidden /> : <Minus className="size-3.5" aria-hidden />}
            </button>

            <span className={cn('font-medium', gone ? 'text-muted-foreground' : 'text-[var(--gold)]')}>
              {node.authorName}
            </span>
            {node.authorHandle && <span className="text-foreground">{node.authorHandle}</span>}

            {node.distinguished && (
              <span className="inline-flex items-center gap-1 cyber-clip-sm border border-[var(--gold)]/40 bg-[var(--selected-surface)] px-1.5 text-[0.65rem] font-semibold uppercase tracking-wide text-[var(--gold)]">
                <BadgeCheck className="size-3" aria-hidden />Staff
              </span>
            )}
            {node.sticky && (
              <span className="inline-flex items-center gap-1 text-[0.65rem] uppercase tracking-wide text-[var(--gold)]">
                <Pin className="size-3" aria-hidden />Pinned
              </span>
            )}
            {node.locked && (
              <span className="inline-flex items-center gap-1 text-[0.65rem] text-muted-foreground">
                <Lock className="size-3" aria-hidden />Locked
              </span>
            )}

            <time dateTime={node.createdAt.toISOString()} className="text-muted-foreground">
              {node.createdAt.toLocaleDateString()}
            </time>
            {node.editedAt && <span className="text-muted-foreground">· edited</span>}
            {collapsed && node.replyCount > 0 && (
              <span className="text-muted-foreground">· {node.replyCount} hidden</span>
            )}
          </div>

          {!collapsed && (
            <>
              <div className="mt-1 text-sm">
                {gone ? (
                  <p className="italic text-muted-foreground">
                    {node.deletedAt ? '[deleted]' : '[removed]'}
                    {node.removalReason && <span className="not-italic"> — {node.removalReason}</span>}
                  </p>
                ) : node.body ? (
                  <RichText doc={node.body as RichDocument} />
                ) : (
                  <p className="whitespace-pre-wrap">{node.bodyText}</p>
                )}
              </div>

              {node.media && (
                <div className="mt-2">
                  {node.media.kind === 'VIDEO' ? (
                    <video
                      controls preload="metadata" poster={node.media.posterUrl ?? undefined}
                      className="max-h-80 rounded border border-border bg-black"
                    >
                      <source src={node.media.url} />
                    </video>
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={node.media.url}
                      alt={node.media.alt ?? ''}
                      className={cn(
                        'max-h-80 w-auto max-w-full rounded border border-border object-contain',
                        node.spoiler && 'blur-xl',
                      )}
                      loading="lazy"
                    />
                  )}
                </div>
              )}

              <div className="mt-1 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                {canReply && (
                  <button
                    type="button"
                    onClick={() => setReplying((v) => !v)}
                    aria-expanded={replying}
                    className="inline-flex items-center gap-1.5 rounded px-1.5 py-1 hover:bg-white/[0.06] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]/60"
                  >
                    <MessageSquare className="size-3.5" aria-hidden />Reply
                  </button>
                )}
                <Link href={permalink} className="rounded px-1.5 py-1 hover:bg-white/[0.06] hover:text-foreground">
                  Permalink
                </Link>
                {mine && !gone && (
                  <span className="rounded px-1.5 py-1 text-muted-foreground/70">yours</span>
                )}
              </div>

              {replying && (
                <div className="mt-2">
                  <CommentComposer postId={0} parentId={node.id} onDone={() => setReplying(false)} compact />
                </div>
              )}

              {/*
                The rail. A left border rather than padding, so the indent is visible AND the text
                column keeps its width — and the step stops growing past the third level.
              */}
              <div
                id={`replies-${node.id}`}
                className={cn(
                  node.children.length > 0 && 'mt-3 flex flex-col gap-3 border-l border-border',
                  node.depth < 3 ? 'pl-3 sm:pl-4' : 'pl-2',
                )}
              >
                {node.children.map((child) => (
                  <Comment
                    key={child.id} node={child} postSlug={postSlug} postLocked={postLocked}
                    signedIn={signedIn} viewerPlayerId={viewerPlayerId} isModerator={isModerator}
                  />
                ))}

                {node.hasMoreBelow && (
                  <Link
                    href={`/the-break/${postSlug}?thread=${node.id}`}
                    className="inline-block py-1 text-xs font-medium text-[var(--gold)] hover:underline"
                  >
                    Continue this thread ({node.replyCount - node.children.length} more) →
                  </Link>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
