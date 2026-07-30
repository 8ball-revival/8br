import type { Metadata } from 'next'
import Link from 'next/link'

import { Container } from '@/components/ui/container'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ReviewWorkspace } from '@/components/archive-review/review-workspace'
import { getReviewer, hasReviewAccess, REVIEW_ROLES } from '@/lib/archive-review/auth'
import { getProgress, getImportReadiness, getRecentHistory, listIssues } from '@/lib/archive-review/data'
import { reviewConfig, CATEGORY_ORDER, batchActionsForCategory, statusLabel, resolutionLabel } from '@/lib/archive-review/config'

export const metadata: Metadata = { title: 'Archive Review · Internal', robots: { index: false, follow: false } }

type Params = { searchParams: Promise<Record<string, string | undefined>> }
const TABS = ['overview', ...CATEGORY_ORDER, 'history', 'readiness'] as const
const SEVERITIES = ['high', 'medium', 'low', 'info']

function Gate({ children }: { children: React.ReactNode }) {
  return <Container className="flex min-h-screen flex-col items-center justify-center py-20 text-center">{children}</Container>
}
function tabLabel(t: string) {
  if (t === 'overview') return 'Overview'
  if (t === 'history') return 'Review history'
  if (t === 'readiness') return 'Import readiness'
  return reviewConfig.categories[t]?.label ?? t
}

export default async function ArchiveReviewPage({ searchParams }: Params) {
  const reviewer = await getReviewer()
  if (!reviewer)
    return (
      <Gate>
        <h1 className="font-display text-2xl font-bold">Archive Review — restricted</h1>
        <p className="mt-2 text-sm text-muted-foreground">Sign in with an authorized account to continue.</p>
        <Button asChild className="mt-6"><Link href="/admin">Sign in</Link></Button>
      </Gate>
    )
  if (!hasReviewAccess(reviewer))
    return (
      <Gate>
        <h1 className="font-display text-2xl font-bold">Not authorized</h1>
        <p className="mt-2 max-w-md text-sm text-muted-foreground">
          {reviewer.email} does not have review access. Requires <span className="text-foreground">{REVIEW_ROLES.join(' or ')}</span>.
        </p>
      </Gate>
    )

  const sp = await searchParams
  const tab = (TABS as readonly string[]).includes(sp.category ?? '') ? (sp.category as string) : 'overview'
  const q = sp.q ?? ''
  const severity = sp.severity ?? ''
  const status = sp.status ?? ''
  const page = Number(sp.page) || 1
  const progress = getProgress()
  const isCategory = (CATEGORY_ORDER as readonly string[]).includes(tab)

  return (
    <Container className="py-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="eyebrow text-gold">Internal · restricted</p>
          <h1 className="font-display text-2xl font-bold tracking-tight">Archive Review</h1>
        </div>
        <div className="text-right text-xs text-muted-foreground">
          <div>{reviewer.email}</div>
          <div>{reviewer.roles.join(', ')}</div>
        </div>
      </div>

      {/* Tab nav */}
      <div className="mb-6 flex flex-wrap gap-2">
        {TABS.map((t) => {
          const cc = progress.byCategory[t]
          const active = t === tab
          return (
            <Link
              key={t}
              href={`/archive-review?category=${t}`}
              className={'rounded-md border px-3 py-1.5 text-sm transition-colors ' + (active ? 'border-gold/40 bg-gold/10 text-gold' : 'border-border text-muted-foreground hover:text-foreground')}
            >
              {tabLabel(t)}
              {cc && <span className="ml-1.5 text-xs opacity-70">{cc.pending}/{cc.total}</span>}
            </Link>
          )
        })}
      </div>

      {tab === 'overview' && <Overview progress={progress} readiness={getImportReadiness()} />}
      {tab === 'history' && <History />}
      {tab === 'readiness' && <Readiness readiness={getImportReadiness()} progress={progress} />}

      {isCategory &&
        (() => {
          const { issues, total, page: cur, pages } = listIssues(tab, { q, severity, status, page })
          const catCfg = reviewConfig.categories[tab]
          const base = (extra: Record<string, string | number>) => {
            const params = new URLSearchParams({ category: tab, ...(q ? { q } : {}), ...(severity ? { severity } : {}), ...(status ? { status } : {}) })
            for (const [k, v] of Object.entries(extra)) params.set(k, String(v))
            return `/archive-review?${params.toString()}`
          }
          return (
            <>
              <form action="/archive-review" method="get" className="mb-5 flex flex-wrap items-end gap-2">
                <input type="hidden" name="category" value={tab} />
                <Input name="q" defaultValue={q} placeholder={`Search ${catCfg.label.toLowerCase()}…`} className="w-56" />
                <select name="severity" defaultValue={severity} className="h-9 rounded-md border border-input bg-background px-2 text-sm">
                  <option value="">All severities</option>
                  {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
                <select name="status" defaultValue={status} className="h-9 rounded-md border border-input bg-background px-2 text-sm">
                  <option value="">All statuses</option>
                  {reviewConfig.statuses.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
                </select>
                <Button type="submit" variant="secondary" size="sm">Filter</Button>
              </form>
              <p className="mb-4 text-sm text-muted-foreground">{catCfg.hint} — {total} issue{total === 1 ? '' : 's'} · page {cur}/{pages}</p>

              <ReviewWorkspace
                category={tab}
                issues={issues}
                categoryConfig={catCfg}
                statuses={reviewConfig.statuses}
                batchActions={batchActionsForCategory(tab)}
              />

              {pages > 1 && (
                <div className="mt-6 flex items-center justify-between text-sm">
                  {cur > 1 ? <Link href={base({ page: cur - 1 })} className="text-gold hover:underline">← Previous</Link> : <span className="text-muted-foreground">← Previous</span>}
                  <span className="text-muted-foreground">Page {cur} of {pages}</span>
                  {cur < pages ? <Link href={base({ page: cur + 1 })} className="text-gold hover:underline">Next →</Link> : <span className="text-muted-foreground">Next →</span>}
                </div>
              )}
            </>
          )
        })()}
    </Container>
  )
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function Overview({ progress, readiness }: { progress: any; readiness: any }) {
  return (
    <div>
      <div className="mb-8 grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat v={progress.total} l="Total issues" />
        <Stat v={progress.reviewed} l={`Reviewed (${progress.completionPct}%)`} />
        <Stat v={progress.byStatus.pending} l="Pending" muted />
        <Stat v={progress.byStatus.approved + progress.byStatus.resolved} l="Approved / resolved" ok />
      </div>
      <div className="mb-8 grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat v={progress.byStatus.deferred} l="Deferred" />
        <Stat v={progress.byStatus.needs_evidence} l="Needs evidence" />
        <Stat v={progress.highSeverityRemaining} l="High-severity remaining" />
        <Stat v={progress.advisoryRemaining} l="Advisory remaining" />
      </div>
      <Card className="p-5">
        <h2 className="mb-3 font-display font-semibold">Completion by category</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="py-1">Category</th><th>Total</th><th>Pending</th><th>Approved</th><th>Deferred</th><th>Needs ev.</th><th>Resolved</th><th>%</th>
              </tr>
            </thead>
            <tbody>
              {CATEGORY_ORDER.map((c) => {
                const r = progress.byCategory[c]
                if (!r) return null
                const done = r.approved + r.resolved + r.rejected + r.deferred + r.needs_evidence
                return (
                  <tr key={c} className="border-t border-border">
                    <td className="py-1.5"><Link href={`/archive-review?category=${c}`} className="hover:text-gold">{reviewConfig.categories[c].label}</Link></td>
                    <td className="tabular">{r.total}</td><td className="tabular">{r.pending}</td><td className="tabular">{r.approved}</td>
                    <td className="tabular">{r.deferred}</td><td className="tabular">{r.needs_evidence}</td><td className="tabular">{r.resolved}</td>
                    <td className="tabular">{r.total ? Math.round((done / r.total) * 100) : 0}%</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Card>
      {readiness && (
        <div className="mt-6 rounded-lg border border-dashed border-border bg-card/40 px-4 py-3 text-sm text-muted-foreground">
          Import readiness — schema blockers {readiness.schemaBlockers.length} · high-severity {readiness.highSeverityIssues} ·{' '}
          <span className="text-gold">import is dry-run only</span> · last activity: {progress.lastActivity ?? 'none yet'}
        </div>
      )}
    </div>
  )
}

function History() {
  const history = getRecentHistory(50)
  return (
    <Card className="p-5">
      <h2 className="mb-3 font-display font-semibold">Recent review decisions ({history.length})</h2>
      {history.length === 0 && <p className="text-sm text-muted-foreground">No decisions recorded yet.</p>}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted-foreground"><th className="py-1">Issue</th><th>Resolution</th><th>Status</th><th>v</th><th>Reviewer</th><th>When</th><th>Batch</th></tr>
          </thead>
          <tbody>
            {history.map((h, i) => (
              <tr key={i} className="border-t border-border">
                <td className="py-1.5 tabular text-xs">{h.issueId}</td>
                <td>{resolutionLabel(h.resolution)}</td>
                <td><Badge variant={['approved', 'resolved'].includes(h.status) ? 'success' : 'muted'}>{h.status}</Badge></td>
                <td className="tabular">{h.version}</td>
                <td className="text-xs">{h.reviewer}</td>
                <td className="text-xs text-muted-foreground">{h.timestamp}</td>
                <td className="text-xs text-muted-foreground">{h.batchId ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

function Readiness({ readiness, progress }: { readiness: any; progress: any }) {
  return (
    <Card className="p-5 text-sm">
      <h2 className="mb-3 font-display font-semibold">Import readiness</h2>
      {!readiness ? (
        <p className="text-muted-foreground">Run archive:validate to generate readiness data.</p>
      ) : (
        <ul className="space-y-1 text-muted-foreground">
          <li>Genuine schema blockers: <span className="text-foreground">{readiness.schemaBlockers.length}</span></li>
          <li>High-severity issues: <span className="text-foreground">{readiness.highSeverityIssues}</span></li>
          <li>High-severity remaining (unapplied): <span className="text-foreground">{progress.highSeverityRemaining}</span></li>
          <li>Advisory remaining: <span className="text-foreground">{progress.advisoryRemaining}</span></li>
          <li>Ready for a reviewed import: <span className="text-foreground">{String(readiness.readyForReviewedImport)}</span></li>
          <li className="text-gold">Real database import remains disabled (dry-run only).</li>
        </ul>
      )}
    </Card>
  )
}

function Stat({ v, l, ok, muted }: { v: number; l: string; ok?: boolean; muted?: boolean }) {
  return (
    <Card className="p-4">
      <div className={'tabular text-2xl font-semibold ' + (ok ? 'text-success' : muted ? 'text-muted-foreground' : '')}>{v}</div>
      <div className="text-xs text-muted-foreground">{l}</div>
    </Card>
  )
}
/* eslint-enable @typescript-eslint/no-explicit-any */
