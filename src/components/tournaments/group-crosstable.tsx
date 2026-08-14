'use client'

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import Link from 'next/link'
import { Info, MessageCircle } from 'lucide-react'

// Local, client-safe prop types (structurally compatible with live.ts's WorkspaceGroup). We deliberately
// do NOT import from '@/lib/tournaments/live' — it is a `server-only` module, and importing even a type
// from it pulls server-only into this client bundle and breaks hydration.
interface XPlayer { registrationId: number; cueverseId: string; preferredName: string | null; slug: string | null; discord: string | null }
interface XStanding { registrationId: number; played: number; wins: number; losses: number; gamesWon: number; gamesLost: number; points: number; rank: number }
interface XMatch { id: number; homeRegistrationId: number; awayRegistrationId: number; homeUsername: string; awayUsername: string; homeGames: number | null; awayGames: number | null; winnerRegistrationId: number | null; completedAt: string | null }
export interface XGroup { id: number; name: string; players: XPlayer[]; standings: XStanding[]; matches: XMatch[] }

/**
 * Head-to-head crosstable for one round-robin group — the main, default Group view. Every player is a
 * row AND a column; each completed cell shows who beat whom and the final score, so who-played-whom is
 * readable at a glance. Interactive: hovering/focusing/tapping a score highlights the two players
 * (row + column + both name headers), and clicking opens an accessible match-details card. Sorting,
 * scoring, tiebreakers and qualification logic are unchanged — this is presentation only.
 */

// ---- small helpers ----------------------------------------------------------
function PlayerName({ label, title, slug, gold = false, className = '' }: { label: string; title?: string; slug: string | null; gold?: boolean; className?: string }) {
  const hover = title ?? label
  const color = gold ? 'text-[color:var(--player-name)]' : 'text-foreground'
  if (slug) {
    return <Link href={`/players/${encodeURIComponent(slug)}`} title={hover} className={`${color} hover:underline ${className}`}>{label}</Link>
  }
  return <span title={hover} className={`${color} ${className}`}>{label}</span>
}

function DiscordIcon({ name, discord }: { name: string; discord: string | null }) {
  if (discord) {
    return (
      <a href={`https://discord.com/users/${encodeURIComponent(discord)}`} target="_blank" rel="noopener noreferrer" title={`Message ${name} on Discord`}
        className="inline-flex text-muted-foreground transition-colors hover:text-brand focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
        <MessageCircle className="size-3" aria-hidden />
        <span className="sr-only">Message {name} on Discord</span>
      </a>
    )
  }
  return <span title={`${name} has no Discord linked`} aria-disabled="true" className="inline-flex cursor-default text-muted-foreground/30"><MessageCircle className="size-3" aria-hidden /></span>
}

interface Cell {
  match: XMatch
  rowGames: number
  colGames: number
  rowWon: boolean
  rowName: string
  colName: string
}

export function GroupCrosstable({ group, raceLength, qualifiersPerGroup }: { group: XGroup; raceLength: number; qualifiersPerGroup: number | null }) {
  const standing = new Map(group.standings.map((s) => [s.registrationId, s]))
  // Rows AND columns follow the official standings order (highest points first) — never seed order.
  const byId = new Map(group.players.map((p) => [p.registrationId, p]))
  const players = [
    ...group.standings.map((s) => byId.get(s.registrationId)).filter((p): p is (typeof group.players)[number] => !!p),
    ...group.players.filter((p) => !standing.has(p.registrationId)),
  ]
  const top3 = new Set(group.standings.slice(0, 3).map((s) => s.registrationId))
  const nameById = new Map(players.map((p) => [p.registrationId, p.cueverseId]))

  // cell[row:col] = the row player's line in that head-to-head, or absent if unplayed.
  const cellMap = new Map<string, Cell>()
  for (const m of group.matches) {
    if (m.homeGames == null || m.awayGames == null) continue
    const hName = nameById.get(m.homeRegistrationId) ?? m.homeUsername
    const aName = nameById.get(m.awayRegistrationId) ?? m.awayUsername
    cellMap.set(`${m.homeRegistrationId}:${m.awayRegistrationId}`, { match: m, rowGames: m.homeGames, colGames: m.awayGames, rowWon: m.winnerRegistrationId === m.homeRegistrationId, rowName: hName, colName: aName })
    cellMap.set(`${m.awayRegistrationId}:${m.homeRegistrationId}`, { match: m, rowGames: m.awayGames, colGames: m.homeGames, rowWon: m.winnerRegistrationId === m.awayRegistrationId, rowName: aName, colName: hName })
  }

  const winPct = (gw: number, gl: number) => { const t = gw + gl; return t ? Math.round((gw / t) * 100) : 0 }

  // Interaction state: which (row, col) is highlighted, and which match's details card is open.
  const [hi, setHi] = useState<{ row: number | null; col: number | null }>({ row: null, col: null })
  const [open, setOpen] = useState<{ cell: Cell; rect: DOMRect } | null>(null)
  const highlight = useCallback((rowId: number | null, colId: number | null) => setHi({ row: rowId, col: colId }), [])
  const clear = useCallback(() => setHi({ row: null, col: null }), [])

  const tipId = useId()

  const th = 'border border-border px-2.5 py-1.5 text-center align-middle'
  const td = 'border border-border px-2.5 py-1.5 text-center align-middle tabular'
  const minWidth = `${10.5 + (players.length + 3) * 4.4}rem`
  const colHi = (id: number) => hi.col === id || hi.row === id // a column/row is emphasised when either player is active

  return (
    <div>
      {/* Group summary (real settings) */}
      <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        <span className="font-semibold text-foreground">{group.name}</span>
        <span className="text-muted-foreground">·</span>
        <span className="text-muted-foreground">{players.length} Players</span>
        <span className="text-muted-foreground">·</span>
        <span className="text-muted-foreground">Race to {raceLength}</span>
        {qualifiersPerGroup != null && qualifiersPerGroup > 0 && (
          <>
            <span className="text-muted-foreground">·</span>
            <span className="text-muted-foreground">Top {qualifiersPerGroup} Advance</span>
          </>
        )}
      </div>

      <div className="scrollbar-themed max-h-[75vh] w-full overflow-auto pb-1" onMouseLeave={clear}>
        <table aria-label={`${group.name} head-to-head results`} className="w-full table-fixed border-collapse text-sm" style={{ minWidth }}>
          <colgroup>
            <col style={{ width: '10.5rem' }} />
            {players.map((p) => <col key={p.registrationId} />)}
            <col /><col /><col />
          </colgroup>
          <thead>
            <tr>
              <th scope="col" rowSpan={2} className={`${th} sticky left-0 top-0 z-30 bg-card`}><span className="sr-only">Player</span></th>
              {players.map((p) => (
                <th key={p.registrationId} scope="col" className={`${th} sticky top-0 z-20 bg-card/95 font-medium backdrop-blur ${colHi(p.registrationId) ? 'bg-brand/10' : ''}`}>
                  <PlayerName label={p.preferredName ?? p.cueverseId} title={p.preferredName ?? p.cueverseId} slug={p.slug} gold={top3.has(p.registrationId)} className="block truncate" />
                </th>
              ))}
              <th scope="col" colSpan={2} className={`${th} sticky top-0 z-20 border-l-2 border-l-border bg-card/95 text-xs uppercase tracking-wide text-muted-foreground backdrop-blur`}>Sets</th>
              <th scope="col" className={`${th} sticky top-0 z-20 bg-card/95 text-xs uppercase tracking-wide text-muted-foreground backdrop-blur`}>Games</th>
            </tr>
            <tr>
              {players.map((p) => (
                <th key={p.registrationId} scope="col" className={`${th} sticky top-[calc(2.25rem)] z-20 bg-card/95 backdrop-blur ${colHi(p.registrationId) ? 'bg-brand/10' : ''}`}>
                  <DiscordIcon name={p.cueverseId} discord={p.discord} />
                </th>
              ))}
              <th scope="col" className={`${th} sticky top-[calc(2.25rem)] z-20 border-l-2 border-l-border bg-card/95 text-[0.65rem] uppercase text-muted-foreground backdrop-blur`}>
                <span className="inline-flex items-center gap-1">Pts
                  <span className="group/tip relative inline-flex">
                    <button type="button" aria-describedby={tipId} className="inline-flex text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
                      <Info className="size-3" aria-hidden /><span className="sr-only">How standings are sorted</span>
                    </button>
                    <span id={tipId} role="tooltip" className="pointer-events-none absolute right-0 top-5 z-40 hidden w-56 rounded-md border border-border bg-popover p-2 text-left text-[0.7rem] normal-case tracking-normal text-muted-foreground shadow-lg group-hover/tip:block group-focus-within/tip:block">
                      Sorted by Points (match wins), then game differential, games won, head-to-head result, and finally player name.
                    </span>
                  </span>
                </span>
              </th>
              <th scope="col" className={`${th} sticky top-[calc(2.25rem)] z-20 bg-card/95 text-[0.65rem] uppercase text-muted-foreground backdrop-blur`}>W-L-D</th>
              <th scope="col" className={`${th} sticky top-[calc(2.25rem)] z-20 bg-card/95 text-[0.65rem] uppercase text-muted-foreground backdrop-blur`}>Win %</th>
            </tr>
          </thead>
          <tbody>
            {players.map((row) => {
              const s = standing.get(row.registrationId)
              const draws = s ? Math.max(0, s.played - s.wins - s.losses) : 0
              const rowActive = colHi(row.registrationId)
              return (
                <tr key={row.registrationId} className={rowActive ? 'bg-brand/[0.04]' : ''}>
                  <th scope="row" className={`${td} sticky left-0 z-10 text-left font-medium ${rowActive ? 'bg-brand/10' : 'bg-background'}`}>
                    <PlayerName label={row.cueverseId} title={row.cueverseId} slug={row.slug} gold={top3.has(row.registrationId)} className="block max-w-full truncate text-base font-bold" />
                  </th>
                  {players.map((col) => {
                    if (col.registrationId === row.registrationId) {
                      // Self cell: distinct, non-interactive, not a result.
                      return <td key={col.registrationId} aria-hidden className="border border-border bg-muted/50 bg-[repeating-linear-gradient(45deg,transparent,transparent_5px,rgba(255,255,255,0.03)_5px,rgba(255,255,255,0.03)_10px)]" />
                    }
                    const c = cellMap.get(`${row.registrationId}:${col.registrationId}`)
                    const cellActive = hi.row === row.registrationId && hi.col === col.registrationId
                    const lineActive = hi.row === row.registrationId || hi.col === col.registrationId
                    if (!c) {
                      // Pending: quiet centered dash, not a result.
                      return <td key={col.registrationId} className={`${td} text-muted-foreground/40 ${lineActive ? 'bg-brand/[0.06]' : ''}`}><span aria-hidden>–</span><span className="sr-only">not played</span></td>
                    }
                    const label = `${c.rowName} ${c.rowGames}, ${c.colName} ${c.colGames} — ${c.rowWon ? c.rowName : c.colName} won. Activate for match details.`
                    return (
                      <td
                        key={col.registrationId}
                        tabIndex={0}
                        role="button"
                        aria-label={label}
                        onMouseEnter={() => highlight(row.registrationId, col.registrationId)}
                        onFocus={() => highlight(row.registrationId, col.registrationId)}
                        onClick={(e) => setOpen({ cell: c, rect: (e.currentTarget as HTMLElement).getBoundingClientRect() })}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen({ cell: c, rect: (e.currentTarget as HTMLElement).getBoundingClientRect() }) } }}
                        className={`${td} cursor-pointer select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${cellActive ? 'bg-brand/20' : lineActive ? 'bg-brand/[0.08]' : ''}`}
                      >
                        <span className={c.rowWon ? 'font-bold text-foreground' : 'text-muted-foreground'}>{c.rowGames}</span>
                        <span className="text-muted-foreground/50">–</span>
                        <span className={!c.rowWon ? 'font-bold text-foreground' : 'text-muted-foreground'}>{c.colGames}</span>
                      </td>
                    )
                  })}
                  <td className={`${td} border-l-2 border-l-border font-semibold text-foreground ${rowActive ? 'bg-brand/[0.06]' : ''}`}>{s?.points ?? 0}</td>
                  <td className={`${td} text-muted-foreground ${rowActive ? 'bg-brand/[0.06]' : ''}`}>{s ? `${s.wins}-${s.losses}-${draws}` : '0-0-0'}</td>
                  <td className={`${td} text-muted-foreground ${rowActive ? 'bg-brand/[0.06]' : ''}`}>{s ? `${winPct(s.gamesWon, s.gamesLost)}` : '0'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {open && <MatchDetails cell={open.cell} anchor={open.rect} onClose={() => setOpen(null)} />}
    </div>
  )
}

/** Small accessible match-details card. One at a time; Escape / outside-click closes; viewport-clamped. */
function MatchDetails({ cell, anchor, onClose }: { cell: Cell; anchor: DOMRect; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const winner = cell.rowWon ? cell.rowName : cell.colName

  // Viewport-clamped position, computed during render (this card only mounts on interaction, client-side).
  const pos = (() => {
    if (typeof window === 'undefined') return { top: anchor.bottom + 6, left: anchor.left }
    const W = 260, margin = 8, estH = 190
    const left = Math.max(margin, Math.min(anchor.left, window.innerWidth - W - margin))
    let top = anchor.bottom + 6
    if (top + estH > window.innerHeight - margin) top = Math.max(margin, anchor.top - estH - 6)
    return { top, left }
  })()

  useEffect(() => {
    ref.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); onClose() } }
    const onDown = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) onClose() }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onDown, true)
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('pointerdown', onDown, true) }
  }, [onClose])

  const recorded = cell.match.completedAt
    ? new Date(cell.match.completedAt).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : null

  return (
    <div ref={ref} role="dialog" aria-modal="false" aria-labelledby={titleId} tabIndex={-1}
      style={{ position: 'fixed', top: pos.top, left: pos.left, width: 260 }}
      className="z-[70] rounded-lg border border-border bg-popover p-3 text-sm shadow-2xl outline-none">
      <p id={titleId} className="mb-2 break-words border-b border-border/60 pb-2 font-semibold text-foreground">{cell.rowName} <span className="text-muted-foreground">vs</span> {cell.colName}</p>
      <dl className="space-y-1.5 text-xs">
        <div className="flex items-center justify-between gap-2"><dt className="text-muted-foreground">Score</dt>
          <dd className="tabular font-medium text-foreground">{cell.rowName} {cell.rowGames} – {cell.colGames} {cell.colName}</dd></div>
        <div className="flex items-center justify-between gap-2"><dt className="text-muted-foreground">Winner</dt>
          <dd className="font-semibold text-win">{winner}</dd></div>
        {recorded && <div className="flex items-center justify-between gap-2"><dt className="text-muted-foreground">Recorded</dt><dd className="text-right text-foreground">{recorded}</dd></div>}
      </dl>
    </div>
  )
}
