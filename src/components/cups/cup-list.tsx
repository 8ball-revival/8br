'use client'

import { useMemo, useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { Search } from 'lucide-react'

import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import type { CupListItem } from '@/lib/cups/list'

const nk = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

const PFMT = (p: string, size: number | null) => (p === 'INDIVIDUAL' ? '1v1' : size === 2 ? '2v2' : size ? `${size}v${size}` : 'Team')
const TFMT: Record<string, string> = {
  SINGLE_ELIM: 'Single Elimination', DOUBLE_ELIM: 'Double Elimination', GROUPS_PLAYOFFS: 'Groups + Playoffs', ROUND_ROBIN: 'Round Robin', TEAM_KNOCKOUT: 'Team Knockout',
}
const isActive = (s: string) => s === 'live' || s === 'upcoming'

/** Searchable, filterable, URL-stateful Cup list (Active & Upcoming + Archive). */
export function CupList({ cups }: { cups: CupListItem[] }) {
  const router = useRouter()
  const pathname = usePathname()
  const sp = useSearchParams()

  const [q, setQ] = useState(sp.get('q') ?? '')
  const [status, setStatus] = useState(sp.get('status') ?? 'all')
  const [pformat, setPformat] = useState(sp.get('pformat') ?? 'all')
  const [tformat, setTformat] = useState(sp.get('tformat') ?? 'all')
  const [year, setYear] = useState(sp.get('year') ?? 'all')

  // Reflect state in the URL (shareable), without scrolling.
  useEffect(() => {
    const p = new URLSearchParams()
    if (q.trim()) p.set('q', q.trim())
    if (status !== 'all') p.set('status', status)
    if (pformat !== 'all') p.set('pformat', pformat)
    if (tformat !== 'all') p.set('tformat', tformat)
    if (year !== 'all') p.set('year', year)
    const qs = p.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }, [q, status, pformat, tformat, year, pathname, router])

  const years = useMemo(() => [...new Set(cups.map((c) => c.year).filter((y): y is number => y != null))].sort((a, b) => b - a), [cups])
  const nkq = nk(q)

  const matches = useMemo(() => {
    return cups.filter((c) => {
      if (nkq && !nk(c.searchBlob).includes(nkq)) return false
      if (status === 'active' && !isActive(c.status)) return false
      if (status === 'completed' && isActive(c.status)) return false
      if (pformat !== 'all' && c.participantFormat !== pformat) return false
      if (tformat !== 'all' && c.tournamentFormat !== tformat) return false
      if (year !== 'all' && String(c.year) !== year) return false
      return true
    })
  }, [cups, nkq, status, pformat, tformat, year])

  const active = matches.filter((c) => isActive(c.status)).sort((a, b) => (a.status === 'live' ? -1 : 1) - (b.status === 'live' ? -1 : 1) || b.number - a.number)
  const archive = matches.filter((c) => !isActive(c.status)).sort((a, b) => b.number - a.number)

  // Relationship annotation for the current query (how the searched entity relates).
  const relFor = (c: CupListItem): { display: string; relationship: string } | null => {
    if (!nkq) return null
    const p = c.participants.find((pp) => pp.keys.some((k) => k.includes(nkq)))
    return p ? { display: p.display, relationship: p.relationship } : null
  }

  return (
    <div>
      {/* Search + filters */}
      <div className="mb-6 space-y-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search cups, players, teams, aliases, champions…" className="h-10 pl-9" />
        </div>
        <div className="flex flex-wrap gap-2 text-sm">
          <Select label="Status" value={status} onChange={setStatus} options={[['all', 'All statuses'], ['active', 'Active & Upcoming'], ['completed', 'Completed']]} />
          <Select label="Format" value={pformat} onChange={setPformat} options={[['all', 'All formats'], ['INDIVIDUAL', '1v1'], ['TEAM', 'Team']]} />
          <Select label="Structure" value={tformat} onChange={setTformat} options={[['all', 'All structures'], ...Object.entries(TFMT)]} />
          <Select label="Year" value={year} onChange={setYear} options={[['all', 'All years'], ...years.map((y) => [String(y), String(y)] as [string, string])]} />
        </div>
      </div>

      {active.length > 0 && (
        <section className="mb-8">
          <h2 className="eyebrow mb-3 text-gold">Active &amp; Upcoming</h2>
          <ul className="space-y-2">{active.map((c) => <Row key={c.number} c={c} rel={relFor(c)} />)}</ul>
        </section>
      )}

      <section>
        <h2 className="eyebrow mb-3 text-muted-foreground">Cup Archive {archive.length > 0 && `· ${archive.length}`}</h2>
        {archive.length === 0 && active.length === 0 ? (
          <p className="text-sm text-muted-foreground">No cups match your search.</p>
        ) : (
          <ul className="space-y-2">{archive.map((c) => <Row key={c.number} c={c} rel={relFor(c)} />)}</ul>
        )}
      </section>
    </div>
  )
}

function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <label className="inline-flex items-center gap-1.5">
      <span className="sr-only">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="h-9 rounded-md border border-input bg-background/60 px-2 text-sm" aria-label={label}>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  )
}

function Row({ c, rel }: { c: CupListItem; rel: { display: string; relationship: string } | null }) {
  const completed = !isActive(c.status)
  return (
    <li>
      <Link href={`/cups/${c.number}`} className="block rounded-lg border border-border bg-card/40 p-3 transition-colors hover:border-gold/40 hover:bg-card/70">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="tabular text-sm font-semibold text-gold">Cup #{c.number}</span>
          <span className="tabular text-xs text-muted-foreground">{c.code}</span>
          <span className="font-display font-semibold text-foreground">{c.name}</span>
          {c.year && <span className="text-xs text-muted-foreground">· {c.year}</span>}
          {rel && <Badge variant="gold" className="ml-1">{rel.display}: {rel.relationship}</Badge>}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <span>{PFMT(c.participantFormat, c.teamSize)}</span>
          <span>· {c.gameType ?? '8-Ball'}</span>
          {c.tournamentFormat && <span>· {TFMT[c.tournamentFormat] ?? c.tournamentFormat}</span>}
          {c.entrantsCount != null && <span>· {c.entrantsCount} {c.participantFormat === 'TEAM' ? 'teams' : 'entrants'}</span>}
          {isActive(c.status) ? (
            <Badge variant={c.status === 'live' ? 'success' : 'muted'}>{c.status === 'live' ? `In Progress${c.currentRound ? ` · ${c.currentRound}` : ''}` : 'Upcoming'}</Badge>
          ) : (
            <Badge variant="muted">Completed</Badge>
          )}
        </div>
        {completed && c.champion && (
          <p className="mt-1 text-xs text-muted-foreground">
            Champion: <span className="font-medium text-foreground">{c.champion.name}</span>
            {c.runnerUp && <> · Runner-up: <span className="text-foreground">{c.runnerUp.name}</span></>}
          </p>
        )}
      </Link>
    </li>
  )
}
