'use client'

import { useState, useTransition } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Search, Download, ChevronDown } from 'lucide-react'

import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { formatDateTime } from '@/lib/format'
import { exportActivityCsvAction } from '@/lib/staff/activity-actions'
import { ACTIVITY_CATEGORIES, type ActivityRow, type ActivityFilters } from '@/lib/staff/activity-shared'

const SEVERITIES = ['info', 'notice', 'warning', 'critical'] as const
const sevClass: Record<string, string> = {
  info: 'bg-muted text-muted-foreground', notice: 'bg-sky-500/15 text-sky-400',
  warning: 'bg-[var(--selected-surface)] text-[var(--gold)]', critical: 'bg-destructive/15 text-destructive',
}
const input = 'rounded-md border border-input bg-card px-2.5 py-1.5 text-sm outline-none focus-visible:border-brand'

export function ActivityLogView({ rows, total, page, pageSize, filters, canExportFull }: {
  rows: ActivityRow[]; total: number; page: number; pageSize: number; filters: ActivityFilters; canExportFull: boolean
}) {
  const router = useRouter()
  const sp = useSearchParams()
  const [expanded, setExpanded] = useState<number | null>(null)
  const [exporting, startExport] = useTransition()

  const setParam = (patch: Record<string, string | undefined>) => {
    const q = new URLSearchParams(sp.toString())
    for (const [k, v] of Object.entries(patch)) { if (v == null || v === '') q.delete(k); else q.set(k, v) }
    if (!('page' in patch)) q.delete('page') // any filter change resets to page 1
    router.push(`/staff/audit?${q.toString()}`)
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  const exportCsv = () => startExport(async () => {
    const r = await exportActivityCsvAction(filters)
    if (!r.ok || !r.csv) return
    const blob = new Blob([r.csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = r.filename ?? 'activity.csv'; a.click(); URL.revokeObjectURL(url)
  })

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="grid gap-2 rounded-lg border border-border bg-card/40 p-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="relative sm:col-span-2 lg:col-span-2">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" aria-hidden />
          <input defaultValue={filters.search ?? ''} onBlur={(e) => setParam({ search: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') setParam({ search: (e.target as HTMLInputElement).value }) }} placeholder="Search action, actor, reason…" className={cn(input, 'w-full pl-8')} aria-label="Search activity" />
        </div>
        <input type="date" defaultValue={filters.from ?? ''} onChange={(e) => setParam({ from: e.target.value })} className={input} aria-label="From date" />
        <input type="date" defaultValue={filters.to ?? ''} onChange={(e) => setParam({ to: e.target.value })} className={input} aria-label="To date" />
        <input defaultValue={filters.actor ?? ''} onBlur={(e) => setParam({ actor: e.target.value })} placeholder="Actor" className={input} aria-label="Actor filter" />
        <input defaultValue={filters.target ?? ''} onBlur={(e) => setParam({ target: e.target.value })} placeholder="Target ID" className={input} aria-label="Target filter" />
        <select value={filters.category ?? ''} onChange={(e) => setParam({ category: e.target.value })} className={input} aria-label="Category filter">
          <option value="">All categories</option>
          {ACTIVITY_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={filters.severity ?? ''} onChange={(e) => setParam({ severity: e.target.value })} className={input} aria-label="Severity filter">
          <option value="">All severities</option>
          {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="inline-flex items-center gap-2 text-sm text-muted-foreground">
          <input type="checkbox" checked={!!filters.includeAutomated} onChange={(e) => setParam({ automated: e.target.checked ? '1' : undefined })} className="size-4 accent-[var(--gold)]" />
          Include System &amp; QA events
        </label>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{total} event{total === 1 ? '' : 's'}</span>
          <Button variant="outline" size="sm" disabled={exporting} onClick={exportCsv}><Download className="size-4" /> {exporting ? 'Exporting…' : canExportFull ? 'Export CSV' : 'Export CSV (operational)'}</Button>
        </div>
      </div>

      {/* Table */}
      <div className="scrollbar-themed overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="bg-card/60 text-left text-[0.7rem] uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-semibold">When</th>
              <th className="px-3 py-2 font-semibold">Actor</th>
              <th className="px-3 py-2 font-semibold">Action</th>
              <th className="px-3 py-2 font-semibold">Category</th>
              <th className="px-3 py-2 font-semibold">Severity</th>
              <th className="px-3 py-2 font-semibold">Target</th>
              <th className="px-3 py-2 font-semibold" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.length === 0 && <tr><td colSpan={7} className="px-3 py-8 text-center text-muted-foreground">No matching events.</td></tr>}
            {rows.map((r) => (
              <>
                <tr key={r.id} className="hover:bg-muted/40">
                  <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">{formatDateTime(r.createdAt)}</td>
                  <td className="px-3 py-2 font-medium">{r.actorUsername}</td>
                  <td className="px-3 py-2 font-mono text-xs">{r.action}</td>
                  <td className="px-3 py-2"><span className="rounded-full bg-muted px-2 py-0.5 text-[0.65rem]">{r.category}</span></td>
                  <td className="px-3 py-2"><span className={cn('rounded-full px-2 py-0.5 text-[0.65rem] font-semibold', sevClass[r.severity])}>{r.severity}</span></td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{r.entity}{r.entityId ? ` #${r.entityId}` : ''}</td>
                  <td className="px-3 py-2 text-right">
                    {(r.reason || r.oldValue != null || r.newValue != null) && (
                      <button type="button" onClick={() => setExpanded(expanded === r.id ? null : r.id)} aria-label="Details" className="text-muted-foreground hover:text-foreground"><ChevronDown className={cn('size-4 transition-transform', expanded === r.id && 'rotate-180')} /></button>
                    )}
                  </td>
                </tr>
                {expanded === r.id && (
                  <tr key={`${r.id}-d`} className="bg-background/60">
                    <td colSpan={7} className="px-3 py-3 text-xs">
                      {r.reason && <p className="mb-1"><span className="text-muted-foreground">Reason:</span> {r.reason}</p>}
                      <div className="grid gap-2 sm:grid-cols-2">
                        <div><p className="text-muted-foreground">Before</p><pre className="mt-0.5 max-h-40 overflow-auto rounded bg-card/60 p-2">{r.oldValue != null ? JSON.stringify(r.oldValue, null, 2) : '—'}</pre></div>
                        <div><p className="text-muted-foreground">After</p><pre className="mt-0.5 max-h-40 overflow-auto rounded bg-card/60 p-2">{r.newValue != null ? JSON.stringify(r.newValue, null, 2) : '—'}</pre></div>
                      </div>
                    </td>
                  </tr>
                )}
              </>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between text-sm">
        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setParam({ page: String(page - 1) })}>Previous</Button>
        <span className="text-muted-foreground">Page {page} of {totalPages}</span>
        <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setParam({ page: String(page + 1) })}>Next</Button>
      </div>
    </div>
  )
}
