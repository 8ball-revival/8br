'use client'

import { useMemo, useState, useTransition, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import type { StageGroup, StageMatch } from '@/lib/seasons/views'
import { saveSeasonGroupAction, closeSeasonGroupsAction, reopenSeasonGroupsAction } from '@/lib/seasons/actions'

type Draft = Record<number, { home: string; away: string }>

/** Live group stage. The cross-table is the primary view (who played whom). Members see it read-only;
 *  admins edit result fields directly in it and Save Group (batched, one transaction). */
export function SeasonGroupStage({ seasonId, groups, canManage, canClose, canReopen }: { seasonId: number; groups: StageGroup[]; canManage: boolean; canClose: boolean; canReopen: boolean }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const run = (fn: () => Promise<{ ok?: boolean; error?: string; message?: string }>) =>
    start(async () => { const r = await fn(); setMsg(r.error ? { ok: false, text: r.error } : { ok: true, text: r.message ?? 'Saved.' }); router.refresh() })

  return (
    <div className="mt-8 space-y-6">
      {msg && <div className={cn('rounded-md border px-3 py-2 text-sm', msg.ok ? 'border-success/30 bg-success/10 text-success' : 'border-destructive/40 bg-destructive/10 text-destructive')}>{msg.text}</div>}

      <Legend canManage={canManage} />

      {/* Keyed by the group's match versions so a server refresh remounts with fresh initial values. */}
      {groups.map((g) => <GroupTable key={`${g.id}:${g.matches.map((m) => m.version).join(',')}`} seasonId={seasonId} group={g} canManage={canManage} />)}

      {canManage && (canClose || canReopen) && (
        <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
          {canClose && (
            <Button size="sm" disabled={pending} onClick={() => {
              const unresolved = groups.flatMap((g) => g.matches).filter((m) => m.status === 'SCHEDULED')
              const ok = window.confirm(unresolved.length ? `Close Groups?\n\n${unresolved.length} match(es) are still unresolved and will be marked No Contest (no points, no Ladder effect). Continue anyway?` : 'Close Groups and lock the final standings?')
              if (ok) run(() => closeSeasonGroupsAction(seasonId))
            }}>Close Groups</Button>
          )}
          {canReopen && (
            <Button size="sm" variant="outline" disabled={pending} onClick={() => { if (window.confirm('Reopen Groups?\n\nAny private draft playoff bracket will be discarded because standings may change.')) run(() => reopenSeasonGroupsAction(seasonId)) }}>Reopen Groups</Button>
          )}
        </div>
      )}
    </div>
  )
}

function Legend({ canManage }: { canManage: boolean }) {
  return (
    <div className="sticky top-2 z-10 rounded-md border border-border bg-card/80 px-3 py-2 text-xs text-muted-foreground backdrop-blur">
      <span className="font-semibold text-foreground">Score Entry:</span>{' '}
      {canManage ? (
        <>Enter each player&apos;s game total (e.g. <code className="text-foreground">7</code> and <code className="text-foreground">3</code>). <b className="text-foreground">FF</b> = forfeit (put FF in the forfeiting player&apos;s field, leave the opponent blank). <b className="text-foreground">KO</b> = kicked out (put KO in the kicked player&apos;s field only). Blank / 0–0 = unplayed.</>
      ) : (
        <><b className="text-foreground">FF-W/FF-L</b> = forfeit win/loss (no games counted). <b className="text-foreground">KO</b> = a kicked-out player; their matches are voided.</>
      )}
    </div>
  )
}

function GroupTable({ seasonId, group, canManage }: { seasonId: number; group: StageGroup; canManage: boolean }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [err, setErr] = useState<string | null>(null)

  // matchup lookup: `${a}-${b}` (a<b not required) → { match, aIsHome }
  const matchOf = useMemo(() => {
    const m = new Map<string, { match: StageMatch; homeId: number }>()
    for (const mt of group.matches) { m.set(`${mt.homeEntrantId}-${mt.awayEntrantId}`, { match: mt, homeId: mt.homeEntrantId }); m.set(`${mt.awayEntrantId}-${mt.homeEntrantId}`, { match: mt, homeId: mt.homeEntrantId }) }
    return m
  }, [group.matches])

  const initial = useMemo<Draft>(() => {
    const d: Draft = {}
    for (const mt of group.matches) {
      if (mt.status === 'COMPLETED') d[mt.id] = { home: String(mt.homeGames ?? ''), away: String(mt.awayGames ?? '') }
      else if (mt.status === 'FORFEIT') d[mt.id] = { home: mt.forfeitEntrantId === mt.homeEntrantId ? 'FF' : '', away: mt.forfeitEntrantId === mt.awayEntrantId ? 'FF' : '' }
      else if (mt.status === 'VOID') d[mt.id] = { home: 'KO', away: 'KO' }
      else d[mt.id] = { home: '', away: '' }
    }
    return d
  }, [group.matches])

  const [draft, setDraft] = useState<Draft>(initial)
  const dirty = useMemo(() => group.matches.filter((m) => draft[m.id]?.home !== initial[m.id]?.home || draft[m.id]?.away !== initial[m.id]?.away).map((m) => m.id), [draft, initial, group.matches])

  // Warn before leaving with unsaved edits.
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => { if (dirty.length) { e.preventDefault(); e.returnValue = '' } }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [dirty.length])

  const rows = group.standings
  const setCell = (matchId: number, side: 'home' | 'away', v: string) => setDraft((d) => ({ ...d, [matchId]: { ...d[matchId], [side]: v } }))

  const save = (opts: { confirmFF?: boolean; confirmKO?: boolean; koReason?: string } = {}) => start(async () => {
    setErr(null)
    const entries = dirty.map((id) => { const mt = group.matches.find((x) => x.id === id)!; return { matchId: id, home: draft[id].home, away: draft[id].away, version: mt.version } })
    if (!entries.length) { setErr('No changes to save.'); return }
    const r = await saveSeasonGroupAction(seasonId, group.id, entries, opts)
    if (r.needConfirmFF?.length) { const list = r.needConfirmFF.map((f) => `${f.forfeiter} forfeits to ${f.opponent}`).join('\n'); if (window.confirm(`Record forfeit(s)?\n\n${list}`)) save({ ...opts, confirmFF: true }); return }
    if (r.needConfirmKO?.length) { const reason = window.prompt(`KICK OUT ${r.needConfirmKO.map((k) => k.name).join(', ')}?\n\nThis voids ALL their group matches and removes them from playoff eligibility. Enter a reason:`); if (reason?.trim()) save({ ...opts, confirmKO: true, koReason: reason.trim() }); return }
    if (r.conflict) { setErr(r.error ?? 'Someone else edited this group — refresh.'); return }
    if (!r.ok) { setErr(r.error ?? 'Could not save.'); return }
    router.refresh()
  })

  return (
    <section className="rounded-lg border border-border bg-card/40">
      <div className="sticky top-14 z-[5] flex items-center justify-between gap-2 border-b border-border bg-card/80 px-4 py-2 backdrop-blur">
        <h3 className="font-display text-base font-bold" style={{ color: '#ff2d46' }}>{group.name || `Group ${group.code}`}</h3>
        {canManage && (
          <div className="flex items-center gap-2">
            {dirty.length > 0 && <span className="text-xs text-amber-500">{dirty.length} unsaved</span>}
            <Button size="sm" disabled={pending || dirty.length === 0} onClick={() => save()}>Save Group</Button>
          </div>
        )}
      </div>
      {err && <p className="mx-4 mt-2 rounded border border-destructive/40 bg-destructive/10 px-2 py-1 text-xs text-destructive">{err}</p>}

      <div className="overflow-x-auto p-3">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              <th className="sticky left-0 bg-card px-2 py-1.5 text-left text-xs text-muted-foreground">#</th>
              <th className="bg-card px-2 py-1.5 text-left text-xs text-muted-foreground">Player</th>
              {rows.map((c) => <th key={c.entrantId} className="bg-card px-1 py-1.5 text-center text-[0.65rem] text-muted-foreground" title={c.username}>{c.username.slice(0, 6)}</th>)}
              <th className="bg-card px-2 py-1.5 text-center text-xs text-muted-foreground">Pts</th>
              <th className="bg-card px-2 py-1.5 text-center text-xs text-muted-foreground">W-L-D</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, ri) => (
              <tr key={r.entrantId} className={cn(ri % 2 === 0 ? 'bg-surface' : 'bg-transparent', r.qualified && 'font-medium')}>
                <td className="sticky left-0 bg-inherit px-2 py-1 text-xs text-muted-foreground">{r.rank}</td>
                <td className="whitespace-nowrap px-2 py-1">
                  <span className={cn(r.rank <= 3 && !r.kickedOut && 'text-[#e6c463]', r.kickedOut && 'text-muted-foreground line-through')}>{r.username}</span>
                  {r.kickedOut && <span className="ml-1 text-[0.6rem] font-bold text-destructive">KO</span>}
                </td>
                {rows.map((c) => <Cell key={c.entrantId} rowId={r.entrantId} colId={c.entrantId} matchOf={matchOf} draft={draft} dirty={dirty} canManage={canManage} setCell={setCell} />)}
                <td className="px-2 py-1 text-center font-semibold tabular-nums">{r.points}</td>
                <td className="px-2 py-1 text-center tabular-nums text-muted-foreground">{r.wins}-{r.losses}-{r.draws}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function Cell({ rowId, colId, matchOf, draft, dirty, canManage, setCell }: { rowId: number; colId: number; matchOf: Map<string, { match: StageMatch; homeId: number }>; draft: Draft; dirty: number[]; canManage: boolean; setCell: (m: number, s: 'home' | 'away', v: string) => void }) {
  if (rowId === colId) return <td className="bg-background/60 px-1 py-1 text-center text-muted-foreground/40">—</td>
  const entry = matchOf.get(`${rowId}-${colId}`)
  if (!entry) return <td className="px-1 py-1 text-center text-muted-foreground/40">·</td>
  const { match, homeId } = entry
  const side: 'home' | 'away' = homeId === rowId ? 'home' : 'away'
  const value = draft[match.id]?.[side] ?? ''
  const isDirty = dirty.includes(match.id)
  const voided = match.status === 'VOID'
  if (!canManage) {
    // Read-only: show this player's games / FF label / KO.
    let text = value
    if (match.status === 'FORFEIT') text = match.forfeitEntrantId === (side === 'home' ? match.homeEntrantId : match.awayEntrantId) ? 'FF-L' : 'FF-W'
    else if (voided) text = 'KO'
    return <td className={cn('px-1 py-1 text-center tabular-nums', voided && 'text-muted-foreground/60')} title={match.status}>{text || '·'}</td>
  }
  return (
    <td className={cn('px-0.5 py-0.5 text-center', isDirty && 'bg-amber-500/15')}>
      <input value={value} onChange={(e) => setCell(match.id, side, e.target.value)} className={cn('h-7 w-9 rounded border bg-card text-center text-xs tabular-nums outline-none focus-visible:border-brand', isDirty ? 'border-amber-500' : 'border-input')} aria-label={`result vs opponent`} />
    </td>
  )
}
