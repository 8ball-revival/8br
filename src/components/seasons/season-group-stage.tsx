'use client'

import { useMemo, useState, useTransition, useEffect, useId } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Info } from 'lucide-react'

import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import type { StageGroup, StageMatch, StageStandingRow } from '@/lib/seasons/views'
import { saveSeasonGroupAction, closeSeasonGroupsAction, reopenSeasonGroupsAction } from '@/lib/seasons/actions'

type Draft = Record<number, { home: string; away: string }>

/** Live group stage — the same head-to-head cross-table members see, with admin-editable result
 *  fields and one Save Group per group (batched, one transaction). Matches the tournament group design. */
export function SeasonGroupStage({ seasonId, groups, groupStageGames, canManage, canClose, canReopen }: { seasonId: number; groups: StageGroup[]; groupStageGames: number; canManage: boolean; canClose: boolean; canReopen: boolean }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const run = (fn: () => Promise<{ ok?: boolean; error?: string; message?: string }>) =>
    start(async () => { const r = await fn(); setMsg(r.error ? { ok: false, text: r.error } : { ok: true, text: r.message ?? 'Saved.' }); router.refresh() })

  return (
    <div className="mt-8 space-y-6">
      {msg && <div className={cn('rounded-md border px-3 py-2 text-sm', msg.ok ? 'border-success/30 bg-success/10 text-success' : 'border-destructive/40 bg-destructive/10 text-destructive')}>{msg.text}</div>}
      {canManage && <Legend />}
      {groups.map((g) => <GroupTable key={`${g.id}:${g.matches.map((m) => m.version).join(',')}`} seasonId={seasonId} group={g} groupStageGames={groupStageGames} canManage={canManage} />)}
      {!canManage && <MemberLegend />}

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

function Legend() {
  return (
    <div className="sticky top-2 z-20 rounded-md border border-border bg-card/90 px-3 py-2 text-xs text-muted-foreground backdrop-blur">
      <span className="font-semibold text-foreground">Score Entry:</span> Enter each player&apos;s game total (e.g. <code className="text-foreground">7</code> / <code className="text-foreground">3</code>).{' '}
      <b className="text-foreground">FF</b> = forfeit (FF in the forfeiting player&apos;s cell, opponent blank).{' '}
      <b className="text-foreground">KO</b> = kicked out (KO in the kicked player&apos;s cell only). Blank / 0–0 = unplayed.
    </div>
  )
}
function MemberLegend() {
  return <p className="text-xs text-muted-foreground"><b className="text-foreground">FF-W / FF-L</b> = forfeit win / loss (no games counted). <b className="text-foreground">KO</b> = kicked-out player; their matches are voided.</p>
}

// ---- Discord mark (matches the tournament crosstable) ----------------------
function DiscordLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className={className}>
      <path d="M20.317 4.3698a19.7913 19.7913 0 0 0-4.8851-1.5152.0741.0741 0 0 0-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 0 0-.0785-.037 19.7363 19.7363 0 0 0-4.8852 1.515.0699.0699 0 0 0-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 0 0 .0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 0 0 .0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 0 0-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 0 1-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 0 1 .0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 0 1 .0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 0 1-.0066.1276 12.2986 12.2986 0 0 1-1.873.8914.0766.0766 0 0 0-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 0 0 .0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 0 0 .0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 0 0-.0312-.0286ZM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189Zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z" />
    </svg>
  )
}
function DiscordIcon({ name, discord }: { name: string; discord: string | null }) {
  const base = 'inline-flex items-center justify-center transition-colors text-[color:var(--discord-icon)]'
  if (discord) return (
    <a href={`https://discord.com/users/${encodeURIComponent(discord)}`} target="_blank" rel="noopener noreferrer" title={`Message ${name} on Discord`} className={`${base} hover:text-[color:var(--discord-icon-active)] focus-visible:text-[color:var(--discord-icon-active)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring`}>
      <DiscordLogo className="size-4" /><span className="sr-only">Message {name} on Discord</span>
    </a>
  )
  return <span title={`${name} has no Discord linked`} aria-disabled className={`${base} cursor-default opacity-40`}><DiscordLogo className="size-4" /></span>
}

function PlayerName({ label, slug, className = '' }: { label: string; slug: string | null; className?: string }) {
  if (slug) return <Link href={`/players/${encodeURIComponent(slug)}`} title={label} className={`text-foreground hover:underline ${className}`}>{label}</Link>
  return <span title={label} className={`text-foreground ${className}`}>{label}</span>
}

const th = 'border border-border px-2.5 py-1.5 text-center align-middle'
const td = 'border border-border px-2.5 py-1.5 text-center align-middle tabular'

function GroupTable({ seasonId, group, groupStageGames, canManage }: { seasonId: number; group: StageGroup; groupStageGames: number; canManage: boolean }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [err, setErr] = useState<string | null>(null)
  const tipId = useId()

  const rows = group.standings // already sorted by rank
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
  const setCell = (matchId: number, side: 'home' | 'away', v: string) => setDraft((d) => ({ ...d, [matchId]: { ...d[matchId], [side]: v } }))

  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => { if (dirty.length) { e.preventDefault(); e.returnValue = '' } }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [dirty.length])

  const save = (opts: { confirmFF?: boolean; confirmKO?: boolean; koReason?: string } = {}) => start(async () => {
    setErr(null)
    const entries = dirty.map((id) => { const mt = group.matches.find((x) => x.id === id)!; return { matchId: id, home: draft[id].home, away: draft[id].away, version: mt.version } })
    if (!entries.length) { setErr('No changes to save.'); return }
    const r = await saveSeasonGroupAction(seasonId, group.id, entries, opts)
    if (r.needConfirmFF?.length) { if (window.confirm(`Record forfeit(s)?\n\n${r.needConfirmFF.map((f) => `${f.forfeiter} forfeits to ${f.opponent}`).join('\n')}`)) save({ ...opts, confirmFF: true }); return }
    if (r.needConfirmKO?.length) { const reason = window.prompt(`KICK OUT ${r.needConfirmKO.map((k) => k.name).join(', ')}?\n\nThis voids ALL their group matches and removes them from playoff eligibility. Enter a reason:`); if (reason?.trim()) save({ ...opts, confirmKO: true, koReason: reason.trim() }); return }
    if (r.conflict) { setErr(r.error ?? 'Someone else edited this group — refresh.'); return }
    if (!r.ok) { setErr(r.error ?? 'Could not save.'); return }
    router.refresh()
  })

  const winPct = (gw: number, gl: number) => { const t = gw + gl; return t ? Math.round((gw / t) * 100) : 0 }
  const minWidth = `${10.5 + (rows.length + 3) * 4.4}rem`
  const zebra = (idx: number) => (idx % 2 === 0 ? 'bg-card' : 'bg-surface')

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        <span className="text-muted-foreground">{rows.length} Players</span>
        <span className="text-muted-foreground">·</span>
        <span className="text-muted-foreground">{groupStageGames} games per match</span>
        <span className="text-muted-foreground">·</span>
        <span className="text-muted-foreground">Top 3 Advance</span>
        {canManage && (
          <span className="ml-auto flex items-center gap-2">
            {dirty.length > 0 && <span className="text-xs text-amber-500">{dirty.length} unsaved</span>}
            <Button size="sm" disabled={pending || dirty.length === 0} onClick={() => save()}>Save Group</Button>
          </span>
        )}
      </div>
      {err && <p className="mb-2 rounded border border-destructive/40 bg-destructive/10 px-2 py-1 text-xs text-destructive">{err}</p>}

      <div className="scrollbar-themed max-h-[75vh] w-full overflow-auto pb-1">
        <table aria-label={`${group.name || group.code} head-to-head results`} className="w-full table-fixed border-collapse text-sm" style={{ minWidth }}>
          <colgroup>
            <col style={{ width: '10.5rem' }} />
            {rows.map((p) => <col key={p.entrantId} />)}
            <col /><col /><col />
          </colgroup>
          <thead>
            <tr>
              <th scope="col" rowSpan={2} className={`${th} sticky left-0 top-0 z-30 bg-surface`}>
                <span className="font-display text-base font-bold" style={{ color: '#ff2d46' }}>{group.name || `Group ${group.code}`}</span>
              </th>
              {rows.map((p) => (
                <th key={p.entrantId} scope="col" className={`${th} sticky top-0 z-20 bg-surface font-medium`}>
                  <PlayerName label={p.preferredName ?? p.cueverseId ?? p.username} slug={p.slug} className="block truncate" />
                </th>
              ))}
              <th scope="col" colSpan={2} className={`${th} sticky top-0 z-20 border-l-2 border-l-border bg-surface text-xs uppercase tracking-wide text-muted-foreground`}>Sets</th>
              <th scope="col" className={`${th} sticky top-0 z-20 bg-surface text-xs uppercase tracking-wide text-muted-foreground`}>Games</th>
            </tr>
            <tr>
              {rows.map((p) => (
                <th key={p.entrantId} scope="col" className={`${th} sticky top-[calc(2.25rem)] z-20 border-[color:var(--discord-row-border)] bg-[color:var(--discord-row-bg)]`}>
                  <DiscordIcon name={p.cueverseId ?? p.username} discord={p.discord} />
                </th>
              ))}
              <th scope="col" className={`${th} sticky top-[calc(2.25rem)] z-20 border-l-2 border-l-border bg-surface text-[0.65rem] uppercase text-muted-foreground`}>
                <span className="inline-flex items-center gap-1">Pts
                  <span className="group/tip relative inline-flex">
                    <button type="button" aria-describedby={tipId} className="inline-flex text-muted-foreground hover:text-foreground"><Info className="size-3" aria-hidden /><span className="sr-only">How standings are sorted</span></button>
                    <span id={tipId} role="tooltip" className="pointer-events-none absolute right-0 top-5 z-40 hidden w-56 rounded-md border border-border bg-popover p-2 text-left text-[0.7rem] normal-case tracking-normal text-muted-foreground shadow-lg group-hover/tip:block group-focus-within/tip:block">
                      Points: Win = 2, Draw = 1, plus 1 for completing all your sets. Ties are broken by head-to-head result, then win percentage.
                    </span>
                  </span>
                </span>
              </th>
              <th scope="col" className={`${th} sticky top-[calc(2.25rem)] z-20 bg-surface text-[0.65rem] uppercase text-muted-foreground`}>W-L-D</th>
              <th scope="col" className={`${th} sticky top-[calc(2.25rem)] z-20 bg-surface text-[0.65rem] uppercase text-muted-foreground`}>Win %</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => {
              const rowBg = zebra(idx)
              return (
                <tr key={row.entrantId}>
                  <th scope="row" className={`${td} sticky left-0 z-10 text-center font-medium ${rowBg}`}>
                    <span className={cn('mx-auto block max-w-full truncate text-base font-bold', row.kickedOut && 'text-muted-foreground line-through')}>
                      <PlayerName label={row.cueverseId ?? row.username} slug={row.slug} className="text-inherit" />
                    </span>
                    {row.kickedOut && <span className="text-[0.6rem] font-bold text-destructive">KO</span>}
                  </th>
                  {rows.map((col) => (
                    <ResultCell key={col.entrantId} row={row} col={col} matchOf={matchOf} draft={draft} dirty={dirty} rowBg={rowBg} canManage={canManage} setCell={setCell} />
                  ))}
                  <td className={`${td} ${rowBg} border-l-2 border-l-border font-semibold text-foreground`}>{row.points}</td>
                  <td className={`${td} ${rowBg} text-muted-foreground`}>{row.wins}-{row.losses}-{row.draws}</td>
                  <td className={`${td} ${rowBg} text-muted-foreground`}>{winPct(row.gamesWon, row.gamesLost)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function ResultCell({ row, col, matchOf, draft, dirty, rowBg, canManage, setCell }: { row: StageStandingRow; col: StageStandingRow; matchOf: Map<string, { match: StageMatch; homeId: number }>; draft: Draft; dirty: number[]; rowBg: string; canManage: boolean; setCell: (m: number, s: 'home' | 'away', v: string) => void }) {
  if (row.entrantId === col.entrantId) {
    return <td aria-hidden className="border border-border bg-background bg-[repeating-linear-gradient(45deg,var(--surface),var(--surface)_6px,transparent_6px,transparent_12px)]" />
  }
  const entry = matchOf.get(`${row.entrantId}-${col.entrantId}`)
  if (!entry) return <td className={`${td} ${rowBg} text-muted-foreground/40`}>–</td>
  const { match, homeId } = entry
  const side: 'home' | 'away' = homeId === row.entrantId ? 'home' : 'away'
  const value = draft[match.id]?.[side] ?? ''
  const isDirty = dirty.includes(match.id)

  if (canManage) {
    return (
      <td className={`${td} ${isDirty ? 'bg-amber-500/15' : rowBg} px-1 py-1`}>
        <input value={value} onChange={(e) => setCell(match.id, side, e.target.value)} className={cn('h-7 w-full max-w-[3rem] rounded border bg-card/70 text-center text-xs tabular outline-none focus-visible:border-brand', isDirty ? 'border-amber-500' : 'border-input')} aria-label={`${row.cueverseId ?? row.username} vs ${col.cueverseId ?? col.username}`} />
      </td>
    )
  }
  // Read-only member cell: row–col score (winner bold), FF-W/FF-L, or KO.
  if (match.status === 'VOID') return <td className={`${td} ${rowBg} text-muted-foreground/60`}>KO</td>
  if (match.status === 'FORFEIT') {
    const rowForfeited = match.forfeitEntrantId === row.entrantId
    return <td className={`${td} ${rowBg} text-muted-foreground`}>{rowForfeited ? 'FF-L' : 'FF-W'}</td>
  }
  if (match.status !== 'COMPLETED' || match.homeGames == null || match.awayGames == null) return <td className={`${td} ${rowBg} text-muted-foreground/40`}>–</td>
  const rowGames = side === 'home' ? match.homeGames : match.awayGames
  const colGames = side === 'home' ? match.awayGames : match.homeGames
  const rowWon = match.winnerEntrantId === row.entrantId
  return (
    <td className={`${td} ${rowBg}`}>
      <span className={rowWon ? 'font-bold text-foreground' : 'text-muted-foreground'}>{rowGames}</span>
      <span className="text-muted-foreground/50">–</span>
      <span className={!rowWon && match.winnerEntrantId != null ? 'font-bold text-foreground' : 'text-muted-foreground'}>{colGames}</span>
    </td>
  )
}
