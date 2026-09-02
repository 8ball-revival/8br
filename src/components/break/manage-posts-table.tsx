'use client'

import { useMemo, useState } from 'react'
import { secondaryHandle } from '@/lib/break/byline'
import Link from 'next/link'
import { Pencil } from 'lucide-react'

import { cn } from '@/lib/utils'
import { PostManageMenu } from './post-manage-menu'

export interface ManagedPost {
  id: number
  slug: string
  title: string
  type: string
  state: string
  authorHandle: string | null
  authorName: string | null
  createdAt: string
  updatedAt: string
  commentCount: number
  score: number
}

/**
 * The management list.
 *
 * ── Identity, the same way it works everywhere else ──────────────────────────────────────────────
 * The CueVerse ID is the author line and the preferred name sits under it. The archive holds two
 * Mikes and several Chrises, so a list that showed only preferred names would be a list somebody
 * could delete the wrong post from.
 *
 * ── Filtering, not a console ─────────────────────────────────────────────────────────────────────
 * A text match over title and author, and a status filter. Both are computed here over a list that
 * is already loaded, which is the honest scope for a few hundred posts and stops this becoming a
 * paginated search product nobody asked for.
 */
export function ManagePostsTable({ posts }: { posts: ManagedPost[] }) {
  const [q, setQ] = useState('')
  const [state, setState] = useState<string>('ALL')

  const states = useMemo(() => ['ALL', ...new Set(posts.map((p) => p.state))], [posts])

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return posts.filter((p) => {
      if (state !== 'ALL' && p.state !== state) return false
      if (!needle) return true
      return p.title.toLowerCase().includes(needle)
        || (p.authorHandle ?? '').toLowerCase().includes(needle)
        || (p.authorName ?? '').toLowerCase().includes(needle)
    })
  }, [posts, q, state])

  const field = 'rounded-none border border-input bg-background px-3 py-1.5 text-sm text-foreground outline-none focus-visible:border-[var(--gold)]'

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search title or author"
          aria-label="Search posts by title or author"
          className={cn(field, 'min-w-[14rem] flex-1')}
        />
        <select value={state} onChange={(e) => setState(e.target.value)} aria-label="Filter by status" className={field}>
          {states.map((s) => <option key={s} value={s}>{s === 'ALL' ? 'All statuses' : s}</option>)}
        </select>
      </div>

      <div className="scrollbar-themed overflow-x-auto rounded-none border border-border">
        <table className="w-full min-w-[52rem] text-left text-sm">
          <thead className="border-b border-border bg-card/60 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th scope="col" className="px-3 py-2">Title</th>
              <th scope="col" className="px-3 py-2">Author</th>
              <th scope="col" className="px-3 py-2">Type</th>
              <th scope="col" className="px-3 py-2">Status</th>
              <th scope="col" className="px-3 py-2 text-right">Replies</th>
              <th scope="col" className="px-3 py-2 text-right">Score</th>
              <th scope="col" className="px-3 py-2">Created</th>
              <th scope="col" className="px-3 py-2">Updated</th>
              <th scope="col" className="px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id} className="border-b border-border/60 last:border-0">
                <td className="max-w-[18rem] px-3 py-2">
                  <Link href={`/the-break/${p.slug}`} className="line-clamp-2 font-medium text-foreground hover:text-[var(--gold)]">
                    {p.title}
                  </Link>
                </td>
                <td className="px-3 py-2">
                  <span className="block font-medium text-foreground">{p.authorHandle ?? '—'}</span>
                  {/* The second line is dropped when it would only repeat the first. */}
                  {secondaryHandle(p.authorHandle, p.authorName) && (
                    <span className="block text-xs text-muted-foreground">{p.authorName}</span>
                  )}
                </td>
                <td className="px-3 py-2 text-muted-foreground">{p.type}</td>
                <td className="px-3 py-2">
                  <span className={cn(
                    'cyber-clip-sm border px-2 py-0.5 text-xs',
                    p.state === 'PUBLISHED' ? 'border-[var(--gold)]/45 text-[var(--gold)]'
                    : p.state === 'DELETED' ? 'border-destructive/45 text-destructive'
                    : 'border-border text-muted-foreground',
                  )}>
                    {p.state}
                  </span>
                </td>
                <td className="tabular px-3 py-2 text-right text-muted-foreground">{p.commentCount}</td>
                <td className="tabular px-3 py-2 text-right text-muted-foreground">{p.score}</td>
                <td className="px-3 py-2 text-xs text-muted-foreground">{p.createdAt.slice(0, 10)}</td>
                <td className="px-3 py-2 text-xs text-muted-foreground">{p.updatedAt.slice(0, 10)}</td>
                <td className="px-3 py-2">
                  <div className="flex items-center justify-end gap-1">
                    <Link
                      href={`/the-break/${p.slug}/edit`}
                      aria-label={`Edit ${p.title}`}
                      className="inline-flex size-7 items-center justify-center rounded text-muted-foreground hover:bg-white/[0.06] hover:text-foreground"
                    >
                      <Pencil className="size-3.5" aria-hidden />
                    </Link>
                    <PostManageMenu
                      postId={p.id}
                      slug={p.slug}
                      title={p.title}
                      authorLabel={p.authorHandle ?? p.authorName ?? 'this author'}
                      commentCount={p.commentCount}
                      returnTo="/the-break/manage"
                    />
                  </div>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={9} className="px-3 py-6 text-center text-muted-foreground">No posts match that.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
