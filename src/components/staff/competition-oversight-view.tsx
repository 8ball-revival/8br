'use client'
import { CompetitionBadge } from '@/components/competitions/competition-badge'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import type { CompRow } from '@/lib/staff/oversight'

const sel = 'rounded-md border border-input bg-card px-2.5 py-1.5 text-sm outline-none focus-visible:border-brand'

export function CompetitionOversightView({ rows }: { rows: CompRow[] }) {
  const [type, setType] = useState('')
  const [status, setStatus] = useState('')
  const [format, setFormat] = useState('')
  const [year, setYear] = useState('')

  const years = useMemo(() => [...new Set(rows.map((r) => r.year))].sort((a, b) => b - a), [rows])
  const statuses = useMemo(() => [...new Set(rows.map((r) => r.phase))], [rows])
  const formats = useMemo(() => [...new Set(rows.map((r) => r.format))], [rows])

  const filtered = rows.filter((r) =>
    (!type || r.type === type) && (!status || r.phase === status) && (!format || r.format === format) && (!year || String(r.year) === year),
  )

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 rounded-lg border border-border bg-card/40 p-3">
        <select value={type} onChange={(e) => setType(e.target.value)} className={sel} aria-label="Type"><option value="">All types</option><option>Season</option><option>Tournament</option></select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className={sel} aria-label="Status"><option value="">All statuses</option>{statuses.map((s) => <option key={s}>{s}</option>)}</select>
        <select value={format} onChange={(e) => setFormat(e.target.value)} className={sel} aria-label="Format"><option value="">All formats</option>{formats.map((f) => <option key={f}>{f}</option>)}</select>
        <select value={year} onChange={(e) => setYear(e.target.value)} className={sel} aria-label="Year"><option value="">All years</option>{years.map((y) => <option key={y}>{y}</option>)}</select>
        <span className="ml-auto self-center text-xs text-muted-foreground">{filtered.length} of {rows.length}</span>
      </div>

      <div className="scrollbar-themed overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[820px] text-sm">
          <thead className="bg-card/60 text-left text-[0.7rem] uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Type</th><th className="px-3 py-2">Name</th><th className="px-3 py-2">Code</th>
              <th className="px-3 py-2">Phase</th><th className="px-3 py-2">Reg.</th><th className="px-3 py-2 text-right">Entrants</th>
              <th className="px-3 py-2 text-right">Unresolved</th><th className="px-3 py-2 text-right">Free agents</th>
              <th className="px-3 py-2 text-right">Incomplete</th><th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filtered.length === 0 && <tr><td colSpan={10} className="px-3 py-8 text-center text-muted-foreground">No competitions match.</td></tr>}
            {filtered.map((r) => (
              <tr key={`${r.type}-${r.id}`} className="hover:bg-muted/40">
                <td className="px-3 py-2"><span className={cn('rounded-full px-2 py-0.5 text-[0.65rem] font-semibold', r.type === 'Season' ? 'bg-[var(--gold)]/15 text-[var(--gold)]' : 'bg-brand/15 text-brand')}>{r.type}</span></td>
                <td className="px-3 py-2 font-medium text-foreground">
                  <span className="flex items-center gap-2">
                    {r.competition && (
                      <CompetitionBadge
                        name={r.competition.name}
                        shortName={r.competition.shortName}
                        iconMediaId={r.competition.iconMediaId}
                        size={18}
                      />
                    )}
                    <span>{r.name}</span>
                  </span>
                </td>
                <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{r.code}</td>
                <td className="px-3 py-2 text-xs">{r.phase}</td>
                <td className="px-3 py-2 text-xs">{r.registration}</td>
                <td className="px-3 py-2 text-right tabular-nums">{r.entrants}</td>
                <td className={cn('px-3 py-2 text-right tabular-nums', r.unresolved > 0 && 'font-semibold text-brand')}>{r.unresolved}</td>
                <td className={cn('px-3 py-2 text-right tabular-nums', r.waitingFreeAgents > 0 && 'text-brand')}>{r.waitingFreeAgents}</td>
                <td className={cn('px-3 py-2 text-right tabular-nums', r.incompleteTeams > 0 && 'text-brand')}>{r.incompleteTeams}</td>
                <td className="px-3 py-2 text-right"><Link href={r.manageHref} className="text-brand hover:underline">Manage →</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">Manage links open the full competition workspace, where lifecycle actions use their own permission, validation, and confirmation flow.</p>
    </div>
  )
}
