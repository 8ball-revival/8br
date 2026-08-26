'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { Info } from 'lucide-react'

import { GROUP_STAGE_GAMES } from '@/lib/competition/match-format'
import { PlayerName } from '@/components/identity/player-name'

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
 * readable at a glance. A clean, cohesive grid: one text colour for all names, opaque matte zebra rows,
 * no hover highlighting; clicking/activating a played cell opens an accessible match-details card.
 * Sorting, scoring, tiebreakers and qualification logic are unchanged — this is presentation only.
 */

// ---- small helpers ----------------------------------------------------------

/** Official Discord logo mark (lucide has no brand icons). Inherits colour via currentColor. */
function DiscordLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className={className}>
      <path d="M20.317 4.3698a19.7913 19.7913 0 0 0-4.8851-1.5152.0741.0741 0 0 0-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 0 0-.0785-.037 19.7363 19.7363 0 0 0-4.8852 1.515.0699.0699 0 0 0-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 0 0 .0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 0 0 .0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 0 0-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 0 1-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 0 1 .0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 0 1 .0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 0 1-.0066.1276 12.2986 12.2986 0 0 1-1.873.8914.0766.0766 0 0 0-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 0 0 .0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 0 0 .0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 0 0-.0312-.0286ZM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189Zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z" />
    </svg>
  )
}

function DiscordIcon({ name, discord }: { name: string; discord: string | null }) {
  // Muted silver by default; only the ICON turns Discord blurple on hover/focus (class-based so the
  // hover variant wins). Cells/rows/names never change on hover.
  const base = 'inline-flex items-center justify-center transition-colors text-[color:var(--discord-icon)]'
  if (discord) {
    return (
      <a href={`https://discord.com/users/${encodeURIComponent(discord)}`} target="_blank" rel="noopener noreferrer" title={`Message ${name} on Discord`}
        className={`${base} hover:text-[color:var(--discord-icon-active)] focus-visible:text-[color:var(--discord-icon-active)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring`}>
        <DiscordLogo className="size-4" />
        <span className="sr-only">Message {name} on Discord</span>
      </a>
    )
  }
  return (
    <span title={`${name} has no Discord linked`} aria-disabled="true" className={`${base} cursor-default opacity-40`}>
      <DiscordLogo className="size-4" /><span className="sr-only">{name} has no Discord linked</span>
    </span>
  )
}

interface Cell {
  match: XMatch
  rowGames: number
  colGames: number
  rowWon: boolean
  rowName: string
  colName: string
}

export function GroupCrosstable({ group, qualifiersPerGroup }: { group: XGroup; qualifiersPerGroup: number | null }) {
  const standing = new Map(group.standings.map((s) => [s.registrationId, s]))
  // Rows AND columns follow the official standings order (highest points first) — never seed order.
  const byId = new Map(group.players.map((p) => [p.registrationId, p]))
  const players = [
    ...group.standings.map((s) => byId.get(s.registrationId)).filter((p): p is (typeof group.players)[number] => !!p),
    ...group.players.filter((p) => !standing.has(p.registrationId)),
  ]
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

  // Only interaction: click/Enter a played cell to open its match-details card. No hover highlighting.
  const [open, setOpen] = useState<{ cell: Cell; rect: DOMRect } | null>(null)
  const tipId = useId()

  const th = 'border border-border px-2.5 py-1.5 text-center align-middle'
  const td = 'border border-border px-2.5 py-1.5 text-center align-middle tabular'
  const minWidth = `${10.5 + (players.length + 3) * 4.4}rem`
  // Opaque matte zebra shades (theme-aware): even rows sit on --card, odd rows on --surface, so a
  // player's results are easy to follow across the row and the page texture never shows through.
  const zebra = (idx: number) => (idx % 2 === 0 ? 'bg-card' : 'bg-surface')

  return (
    <div>
      {/* Group summary (real settings). The group name itself lives in the table's top-left corner cell. */}
      <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        <span className="text-muted-foreground">{players.length} Players</span>
        <span className="text-muted-foreground">·</span>
        <span className="text-muted-foreground">{GROUP_STAGE_GAMES} games per match</span>
        {qualifiersPerGroup != null && qualifiersPerGroup > 0 && (
          <>
            <span className="text-muted-foreground">·</span>
            <span className="text-muted-foreground">Top {qualifiersPerGroup} Advance</span>
          </>
        )}
      </div>

      <div className="scrollbar-themed max-h-[75vh] w-full overflow-auto pb-1">
        <table aria-label={`${group.name} head-to-head results`} className="w-full table-fixed border-collapse text-sm" style={{ minWidth }}>
          <colgroup>
            <col style={{ width: '10.5rem' }} />
            {players.map((p) => <col key={p.registrationId} />)}
            <col /><col /><col />
          </colgroup>
          <thead>
            <tr>
              <th scope="col" rowSpan={2} className={`${th} sticky left-0 top-0 z-30 bg-surface`}>
                <span className="font-display text-base font-bold" style={{ color: 'var(--gold)' }}>{group.name}</span>
              </th>
              {players.map((p) => (
                <th key={p.registrationId} scope="col" className={`${th} sticky top-0 z-20 bg-surface font-medium`}>
                  <PlayerName
                    identity={{ cueverseId: p.cueverseId, preferredName: p.preferredName }}
                    href={p.slug ? `/players/${encodeURIComponent(p.slug)}` : null}
                    size="sm"
                    className="text-foreground"
                  />
                </th>
              ))}
              <th scope="col" colSpan={2} className={`${th} sticky top-0 z-20 border-l-2 border-l-border bg-surface text-xs uppercase tracking-wide text-muted-foreground`}>Sets</th>
              <th scope="col" className={`${th} sticky top-0 z-20 bg-surface text-xs uppercase tracking-wide text-muted-foreground`}>Games</th>
            </tr>
            <tr>
              {players.map((p) => (
                // Discord contact row only: distinct opaque matte bg + subtle borders (does not extend to
                // the corner, Sets/Games, or the result grid).
                <th key={p.registrationId} scope="col" className={`${th} sticky top-[calc(2.25rem)] z-20 border-[color:var(--discord-row-border)] bg-[color:var(--discord-row-bg)]`}>
                  <DiscordIcon name={p.cueverseId} discord={p.discord} />
                </th>
              ))}
              <th scope="col" className={`${th} sticky top-[calc(2.25rem)] z-20 border-l-2 border-l-border bg-surface text-[0.65rem] uppercase text-muted-foreground`}>
                <span className="inline-flex items-center gap-1">Pts
                  <span className="group/tip relative inline-flex">
                    <button type="button" aria-describedby={tipId} className="inline-flex text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
                      <Info className="size-3" aria-hidden /><span className="sr-only">How standings are sorted</span>
                    </button>
                    <span id={tipId} role="tooltip" className="pointer-events-none absolute right-0 top-5 z-40 hidden w-56 rounded-none border border-border bg-popover p-2 text-left text-[0.7rem] normal-case tracking-normal text-muted-foreground shadow-lg group-hover/tip:block group-focus-within/tip:block">
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
            {players.map((row, idx) => {
              const s = standing.get(row.registrationId)
              const draws = s ? Math.max(0, s.played - s.wins - s.losses) : 0
              const rowBg = zebra(idx)
              return (
                <tr key={row.registrationId}>
                  <th scope="row" className={`${td} sticky left-0 z-10 text-center font-medium ${rowBg}`}>
                    <PlayerName
                      identity={{ cueverseId: row.cueverseId, preferredName: row.preferredName }}
                      href={row.slug ? `/players/${encodeURIComponent(row.slug)}` : null}
                      size="lg"
                      className="mx-auto max-w-full text-foreground"
                    />
                  </th>
                  {players.map((col) => {
                    if (col.registrationId === row.registrationId) {
                      // Self cell: opaque, distinct darker matte with a restrained diagonal — not a result.
                      return <td key={col.registrationId} aria-hidden className="border border-border bg-background bg-[repeating-linear-gradient(45deg,var(--surface),var(--surface)_6px,transparent_6px,transparent_12px)]" />
                    }
                    const c = cellMap.get(`${row.registrationId}:${col.registrationId}`)
                    if (!c) {
                      // Pending: quiet centered dash, not a result.
                      return <td key={col.registrationId} className={`${td} ${rowBg} text-muted-foreground/40`}><span aria-hidden>–</span><span className="sr-only">not played</span></td>
                    }
                    const label = `${c.rowName} ${c.rowGames}, ${c.colName} ${c.colGames} — ${c.rowWon ? c.rowName : c.colName} won. Activate for match details.`
                    return (
                      <td
                        key={col.registrationId}
                        tabIndex={0}
                        role="button"
                        aria-label={label}
                        onClick={(e) => setOpen({ cell: c, rect: (e.currentTarget as HTMLElement).getBoundingClientRect() })}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen({ cell: c, rect: (e.currentTarget as HTMLElement).getBoundingClientRect() }) } }}
                        className={`${td} ${rowBg} cursor-pointer select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring`}
                      >
                        <span className={c.rowWon ? 'font-bold text-foreground' : 'text-muted-foreground'}>{c.rowGames}</span>
                        <span className="text-muted-foreground/50">–</span>
                        <span className={!c.rowWon ? 'font-bold text-foreground' : 'text-muted-foreground'}>{c.colGames}</span>
                      </td>
                    )
                  })}
                  <td className={`${td} ${rowBg} border-l-2 border-l-border font-semibold text-foreground`}>{s?.points ?? 0}</td>
                  <td className={`${td} ${rowBg} text-muted-foreground`}>{s ? `${s.wins}-${s.losses}-${draws}` : '0-0-0'}</td>
                  <td className={`${td} ${rowBg} text-muted-foreground`}>{s ? `${winPct(s.gamesWon, s.gamesLost)}` : '0'}</td>
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
      className="z-[70] rounded-none border border-border bg-popover p-3 text-sm shadow-2xl outline-none">
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
