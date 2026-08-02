'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { UserPlus, Upload } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  searchEntrantCandidatesAction,
  addEntrantAction,
  bulkImportEntrantsAction,
  type EntrantCandidate,
  type BulkImportResult,
} from '@/lib/competition/actions'

/** Add entrants from the Player database — search by display name / primary CueVerse
 *  ID / verified alias, multi-select, and add. Already-entered profiles are shown as
 *  unavailable; empty searches report clearly. */
export function AddEntrantControl({ seasonId }: { seasonId: number }) {
  const router = useRouter()
  const [q, setQ] = useState('')
  const [results, setResults] = useState<EntrantCandidate[]>([])
  const [searching, setSearching] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [pending, startTransition] = useTransition()
  const [msg, setMsg] = useState<string | null>(null)
  const seq = useRef(0)

  useEffect(() => {
    const query = q.trim()
    const mine = ++seq.current
    const t = setTimeout(async () => {
      if (query.length < 2) { if (mine === seq.current) { setResults([]); setSearching(false) }; return }
      setSearching(true)
      const r = await searchEntrantCandidatesAction(seasonId, query)
      if (mine === seq.current) { setResults(r); setSearching(false) }
    }, 200)
    return () => clearTimeout(t)
  }, [q, seasonId])

  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })

  function addSelected() {
    if (selected.size === 0) return
    const fd = new FormData()
    fd.set('seasonId', String(seasonId)); fd.set('playerIds', [...selected].join(','))
    startTransition(async () => {
      const res = await addEntrantAction({}, fd)
      setMsg(res.error ?? res.message ?? 'Added.')
      setSelected(new Set()); setQ(''); setResults([])
      if (!res.error) router.refresh()
    })
  }

  const query = q.trim()
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <UserPlus className="size-4 text-muted-foreground" aria-hidden />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, CueVerse ID, or alias…" className="w-72" />
        {selected.size > 0 && (
          <Button type="button" size="sm" disabled={pending} onClick={addSelected}>Add {selected.size} selected</Button>
        )}
      </div>
      {query.length >= 2 && (
        <ul className="max-h-64 overflow-y-auto rounded-md border border-border bg-card">
          {searching ? (
            <li className="px-3 py-2 text-xs text-muted-foreground">Searching…</li>
          ) : results.length === 0 ? (
            <li className="px-3 py-2 text-xs text-destructive">No player profiles match “{query}”. Create the profile on the Players page first, or refine your search.</li>
          ) : (
            results.map((c) => (
              <li key={c.playerId}>
                <label className={`flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm ${c.alreadyEntered ? 'cursor-not-allowed opacity-50' : 'hover:bg-muted'}`}>
                  <input type="checkbox" disabled={c.alreadyEntered || pending} checked={selected.has(c.playerId)} onChange={() => toggle(c.playerId)} className="accent-gold" />
                  <span className="min-w-0 flex-1 truncate font-medium">{c.primaryName}{c.cueverseId && <span className="text-xs text-muted-foreground"> ({c.cueverseId})</span>}</span>
                  {c.alreadyEntered && <span className="shrink-0 text-xs text-muted-foreground">Already entered</span>}
                </label>
              </li>
            ))
          )}
        </ul>
      )}
      {msg && <p className="text-xs text-muted-foreground">{msg}</p>}
    </div>
  )
}

/** Bulk-add entrants by pasting CueVerse IDs (one per line). Reports matched / already-in / unmatched. */
export function BulkImportEntrants({ seasonId }: { seasonId: number }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const [report, setReport] = useState<BulkImportResult['report'] | null>(null)

  function submit(formData: FormData) {
    formData.set('seasonId', String(seasonId))
    startTransition(async () => {
      const res = await bulkImportEntrantsAction({}, formData)
      setReport(res.report ?? null)
      router.refresh()
    })
  }

  if (!open) return <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}><Upload className="size-4" /> Bulk import</Button>

  return (
    <div className="rounded-lg border border-border bg-card/40 p-3">
      <form action={submit} className="space-y-2">
        <label className="text-sm font-medium">Paste CueVerse IDs (one per line)</label>
        <textarea name="cueverseIds" rows={6} className="w-full rounded-md border border-input bg-background/60 p-2 font-mono text-xs" placeholder={'sixohtwo\nStarkiller\nBricycle'} />
        <div className="flex items-center gap-2">
          <Button type="submit" size="sm" disabled={pending}>{pending ? 'Importing…' : 'Import'}</Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => { setOpen(false); setReport(null) }}>Close</Button>
        </div>
      </form>
      {report && (
        <div className="mt-3 grid gap-2 text-xs sm:grid-cols-3">
          <ReportCol title={`Added (${report.added.length})`} items={report.added} tone="text-success" />
          <ReportCol title={`Already in (${report.duplicates.length})`} items={report.duplicates} tone="text-muted-foreground" />
          <ReportCol title={`Unmatched (${report.unmatched.length})`} items={report.unmatched} tone="text-destructive" />
        </div>
      )}
    </div>
  )
}

function ReportCol({ title, items, tone }: { title: string; items: string[]; tone: string }) {
  return (
    <div>
      <p className={`font-medium ${tone}`}>{title}</p>
      <ul className="mt-1 space-y-0.5 text-muted-foreground">
        {items.length === 0 ? <li className="text-muted-foreground/50">—</li> : items.map((i, k) => <li key={k} className="truncate" title={i}>{i}</li>)}
      </ul>
    </div>
  )
}
