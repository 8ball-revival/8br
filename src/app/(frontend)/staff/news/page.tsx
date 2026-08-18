import type { Metadata } from 'next'
import Link from 'next/link'
import { Download, PenLine, FileText } from 'lucide-react'

import { AdminShell, AdminDenied } from '@/components/staff/admin-shell'
import { StaffGate } from '@/components/staff/staff-gate'
import { Badge } from '@/components/ui/badge'
import { resolveStaffAccess } from '@/lib/competition/staff-auth'
import { prisma } from '@/lib/prisma'
import { formatDateTime } from '@/lib/format'
import { getModerationQueue, listAllArticles, getEditorialSettings } from '@/lib/editorial/queries'
import { publishedWhere } from '@/lib/editorial/service'
import { ModerationQueue } from '@/components/editorial/moderation-queue'
import { EditorialSettingsForm } from '@/components/editorial/editorial-settings-form'
import { CueVerseRefreshPanel } from '@/components/home/cueverse-refresh'
import { readLatestSnapshot } from '@/lib/cueverse/service'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Editorial · Admin · 8 Ball Registry',
  robots: { index: false, follow: false },
}

const STATES = ['ALL', 'DRAFT', 'PENDING_REVIEW', 'PUBLISHED', 'REJECTED', 'ARCHIVED', 'SOFT_DELETED'] as const

type SP = { searchParams: Promise<{ state?: string; q?: string; page?: string }> }

/** Byline: the live CueVerse ID when the profile still exists, the snapshot when it does not. */
function authorLabel(a: {
  authorPlayer: { primaryName: string; cueverseId: string | null } | null
  authorHandleSnapshot: string | null
  authorNameSnapshot: string
}): string {
  return a.authorPlayer?.cueverseId ?? a.authorHandleSnapshot ?? a.authorPlayer?.primaryName ?? a.authorNameSnapshot
}

export default async function EditorialAdminPage({ searchParams }: SP) {
  const access = await resolveStaffAccess()
  if (access.status !== 'ok') return <StaffGate access={access} />
  if (!access.actor.can('manage_competitions')) {
    return <AdminDenied actor={access.actor} active="news" label="Editorial" />
  }

  const sp = await searchParams
  const state = (STATES as readonly string[]).includes(sp.state ?? '') ? sp.state! : 'ALL'
  const search = (sp.q ?? '').trim()
  const page = Number.parseInt(sp.page ?? '1', 10) || 1

  const [queue, listing, settings, candidates, cueverse] = await Promise.all([
    getModerationQueue(),
    listAllArticles({ state, search, page }),
    getEditorialSettings(),
    prisma.article.findMany({
      where: publishedWhere(),
      orderBy: [{ publishAt: 'desc' }],
      take: 40,
      select: { id: true, title: true },
    }),
    // Uncached read: an administrator looking at this page wants the current state, not a
    // fifteen-minute-old copy of it.
    readLatestSnapshot(),
  ])

  return (
    <AdminShell actor={access.actor} active="news">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight">Editorial</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Review submissions, act on reported comments, and choose what The Break shows on the homepage.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/staff/news/pages"
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm hover:border-brand/40"
          >
            <FileText className="size-4" aria-hidden />Pages
          </Link>
          <Link
            href="/api/news/export"
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm hover:border-brand/40"
          >
            <Download className="size-4" aria-hidden />Export JSON
          </Link>
          <Link
            href="/news/new"
            className="inline-flex items-center gap-1.5 rounded-md bg-brand px-3 py-2 text-sm font-medium text-brand-foreground hover:bg-brand/90"
          >
            <PenLine className="size-4" aria-hidden />Write
          </Link>
        </div>
      </div>

      <div className="mt-8">
        <ModerationQueue
          submissions={queue.pending.map((s) => ({
            id: s.id,
            slug: s.slug,
            title: s.title,
            excerpt: s.excerpt,
            author: authorLabel(s),
            categoryName: s.category?.name ?? null,
            submittedAt: s.submittedAt ? s.submittedAt.toISOString() : null,
          }))}
          proposals={queue.proposedEdits.map((p) => ({
            id: p.id,
            slug: p.slug,
            title: p.title,
            proposedTitle: p.pendingTitle,
            author: authorLabel(p),
            submittedAt: p.pendingSubmittedAt ? p.pendingSubmittedAt.toISOString() : null,
          }))}
          reports={queue.reports.map((r) => ({
            id: r.id,
            reason: r.reason,
            createdAt: r.createdAt.toISOString(),
            comment: r.comment && {
              id: r.comment.id,
              body: r.comment.body,
              author: r.comment.authorNameSnapshot,
              createdAt: r.comment.createdAt.toISOString(),
              hidden: r.comment.hiddenAt != null,
              deleted: r.comment.deletedAt != null,
              article: { slug: r.comment.article.slug, title: r.comment.article.title },
            },
          }))}
        />
      </div>

      <section className="mt-12">
        <h2 className="mb-3 border-b border-border pb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Homepage
        </h2>
        <div className="max-w-2xl">
          <EditorialSettingsForm
            initial={{
              featuredArticleId: settings.featuredArticleId,
              showFeatured: settings.showFeatured,
              showOfficial: settings.showOfficial,
              showPredictions: settings.showPredictions,
              showCommunity: settings.showCommunity,
              showDiscussed: settings.showDiscussed,
            }}
            candidates={candidates}
          />
        </div>
      </section>

      <section className="mt-12">
        <h2 className="mb-3 border-b border-border pb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          External data
        </h2>
        <div className="max-w-2xl">
          <CueVerseRefreshPanel
            fetchedAt={cueverse?.fetchedAt ?? null}
            entries={cueverse?.entries.length ?? 0}
            stale={cueverse?.stale ?? false}
          />
        </div>
      </section>

      <section className="mt-12">
        <h2 className="mb-3 border-b border-border pb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          All articles
        </h2>

        <form method="get" className="mb-4 flex flex-wrap items-center gap-2">
          <input
            name="q"
            defaultValue={search}
            placeholder="Search title or author…"
            className="w-56 rounded-md border border-border bg-background px-3 py-2 text-sm"
          />
          <select name="state" defaultValue={state} className="rounded-md border border-border bg-background px-3 py-2 text-sm">
            {STATES.map((s) => (
              <option key={s} value={s}>{s === 'ALL' ? 'Every state' : stateLabel(s)}</option>
            ))}
          </select>
          <button type="submit" className="rounded-md border border-border px-3 py-2 text-sm hover:border-brand/40">Filter</button>
        </form>

        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-card/60 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5 font-medium">Title</th>
                <th className="px-4 py-2.5 font-medium">Author</th>
                <th className="px-4 py-2.5 font-medium">State</th>
                <th className="px-4 py-2.5 font-medium">Updated</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {listing.items.map((a) => (
                <tr key={a.id} className="hover:bg-muted/20">
                  <td className="px-4 py-2.5">
                    <Link href={`/news/${a.slug}/edit`} className="font-medium hover:text-brand">{a.title}</Link>
                    <span className="ml-2 inline-flex gap-1.5">
                      {a.official && <Badge variant="gold">Official</Badge>}
                      {a.featured && <Badge variant="muted">Featured</Badge>}
                      {a.pinned && <Badge variant="muted">Pinned</Badge>}
                      {a.pendingSubmittedAt && <Badge variant="muted">Edit pending</Badge>}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground">{authorLabel(a)}</td>
                  <td className="px-4 py-2.5">
                    <Badge variant={a.state === 'PUBLISHED' ? 'success' : a.state === 'PENDING_REVIEW' ? 'gold' : 'muted'}>
                      {a.state === 'PUBLISHED' && a.publishAt && a.publishAt > new Date() ? 'Scheduled' : stateLabel(a.state)}
                    </Badge>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">{formatDateTime(a.updatedAt.toISOString())}</td>
                </tr>
              ))}
              {listing.items.length === 0 && (
                <tr><td colSpan={4} className="px-4 py-10 text-center text-muted-foreground">No articles match.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {listing.pageCount > 1 && (
          <div className="mt-4 flex items-center justify-center gap-2 text-sm">
            {listing.page > 1 && (
              <Link
                href={`/staff/news?${new URLSearchParams({ state, q: search, page: String(listing.page - 1) })}`}
                className="rounded-md border border-border px-3 py-1.5 hover:border-brand/40"
              >
                Previous
              </Link>
            )}
            <span className="text-muted-foreground">Page {listing.page} of {listing.pageCount}</span>
            {listing.page < listing.pageCount && (
              <Link
                href={`/staff/news?${new URLSearchParams({ state, q: search, page: String(listing.page + 1) })}`}
                className="rounded-md border border-border px-3 py-1.5 hover:border-brand/40"
              >
                Next
              </Link>
            )}
          </div>
        )}
      </section>
    </AdminShell>
  )
}

function stateLabel(state: string): string {
  return state.charAt(0) + state.slice(1).toLowerCase().replace('_', ' ')
}
