'use client'

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import Link from 'next/link'
import { Search, X } from 'lucide-react'
import { searchPlayersAction } from '@/lib/players/profile-actions'
import type { PlayerOption } from '@/lib/players/picker-search'
import type { HeadToHeadRow, ProfileMatchRow } from '@/lib/players/profile'
import { ResultPill, Td, Th } from './window-parts'
import { cn } from '@/lib/utils'

/**
 * Head to Head: nothing until an opponent is chosen.
 *
 * ── Why it starts empty ─────────────────────────────────────────────────────────────────────────
 * It used to render every opponent this player had ever met — 112 rows for an archive career, most
 * of them a single match from 2007. That is a table nobody reads and a lot of markup to reach the
 * one comparison somebody actually came for. The tab now asks the question instead: pick a player,
 * and it shows that matchup.
 *
 * ── The search is the site's search ─────────────────────────────────────────────────────────────
 * Same `searchPlayers` behind it as the header field and the Creator's picker, so CueVerse ID, name
 * and alias all work here exactly as they do everywhere else, and a merged-away handle still
 * resolves to the person who holds it now. No second definition of who a name means.
 */
export function HeadToHeadPanel({
  rows, matches, selfName,
}: {
  /** Every opponent this player has met, already computed — filtered client-side once one is picked. */
  rows: HeadToHeadRow[]
  /** The player's full match list, so the chosen matchup can show its own matches. */
  matches: ProfileMatchRow[]
  selfName: string
}) {
  const [opponent, setOpponent] = useState<PlayerOption | null>(null)

  if (!opponent) {
    return (
      <section aria-label="Head to head" className="pf-panel">
        <h3 className="pf-heading">Head to Head</h3>
        <p className="mt-2 max-w-prose text-sm" style={{ color: 'var(--pf-muted)' }}>
          Choose a player to compare with {selfName}. Search by CueVerse ID, display name or a known
          alias.
        </p>
        <div className="mt-3 max-w-md">
          <OpponentPicker onPick={setOpponent} />
        </div>
      </section>
    )
  }

  /*
    Matched by player id where the archive resolved one, and by name where it did not.

    A 2005 handle that was never linked to a profile is still somebody this player met, and the
    head-to-head rows are keyed the same way, so the comparison finds them either way.
  */
  const row = rows.find((r) => (
    (r.opponentId && r.opponentId === opponent.id)
    || r.opponentName.toLowerCase() === (opponent.cueverseId || opponent.name).toLowerCase()
    || r.opponentName.toLowerCase() === opponent.name.toLowerCase()
  )) ?? null

  const theirMatches = matches.filter((m) => (
    !m.isTeamMatch && row != null && m.opponentName.toLowerCase() === row.opponentName.toLowerCase()
  ))

  const label = opponent.cueverseId || opponent.name

  return (
    <section aria-label="Head to head" className="pf-panel">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="pf-heading">{selfName} vs {label}</h3>
        <div className="flex gap-2">
          <ChangePlayer onPick={setOpponent} />
          <button type="button" onClick={() => setOpponent(null)} className="pf-btn inline-flex items-center gap-1.5 px-2.5 py-1.5">
            <X className="size-3.5" aria-hidden />
            Clear Comparison
          </button>
        </div>
      </div>

      {!row ? (
        <p className="mt-4 text-sm" style={{ color: 'var(--pf-muted)' }}>
          No completed matches are recorded between {selfName} and {label}. Only matches that exist in
          the record can be compared — nothing is estimated.
        </p>
      ) : (
        <>
          <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-5">
            <Figure label="Played" value={String(row.played)} />
            <Figure label={`${selfName} wins`} value={String(row.wins)} accent />
            <Figure label={`${label} wins`} value={String(row.losses)} />
            <Figure label="Draws" value={String(row.draws)} />
            <Figure label="Win %" value={`${row.winPct.toFixed(1)}%`} />
          </dl>
          <p className="mt-2 text-xs" style={{ color: 'var(--pf-muted)' }}>
            Last met {row.lastMet}{row.lastCompetition ? ` · ${row.lastCompetition}` : ''}
          </p>

          <div className="pf-scroll mt-4 max-h-[46vh] overflow-auto">
            <table className="w-full min-w-[34rem] border-collapse text-sm">
              <thead className="sticky top-0 z-10" style={{ background: 'var(--pf-panel)' }}>
                <tr className="border-b pf-rule text-left">
                  <Th>Date</Th>
                  <Th>Competition</Th>
                  <Th>Round</Th>
                  <Th className="text-right">Score</Th>
                  <Th>Result</Th>
                </tr>
              </thead>
              <tbody>
                {theirMatches.map((m) => (
                  <tr key={m.sequence} className="border-b pf-rule last:border-b-0">
                    <Td className="whitespace-nowrap" style={{ color: 'var(--pf-muted)' }}>{m.dateLabel}</Td>
                    <Td>
                      {m.competitionHref
                        ? <Link href={m.competitionHref} className="pf-link">{m.competitionLabel}</Link>
                        : m.competitionLabel}
                    </Td>
                    <Td style={{ color: 'var(--pf-muted)' }}>{m.roundLabel ?? (m.stage === 'PLAYOFF' ? 'Playoffs' : 'Group')}</Td>
                    <Td className="text-right tabular-nums">{m.score ?? '—'}</Td>
                    <Td><ResultPill result={m.result} isForfeit={m.isForfeit} /></Td>
                  </tr>
                ))}
                {theirMatches.length === 0 && (
                  <tr><Td colSpan={5} style={{ color: 'var(--pf-muted)' }}>No individual matches recorded.</Td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  )
}

function ChangePlayer({ onPick }: { onPick: (p: PlayerOption) => void }) {
  const [open, setOpen] = useState(false)
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="pf-btn px-2.5 py-1.5">
        Change Player
      </button>
    )
  }
  return (
    <div className="w-64">
      <OpponentPicker autoFocus onPick={(p) => { onPick(p); setOpen(false) }} />
    </div>
  )
}

/**
 * A compact player search.
 *
 * A combobox, wired the way the pattern says: arrow keys move `aria-activedescendant` rather than
 * focus, Enter chooses, Escape closes, and the result count is announced.
 */
function OpponentPicker({ onPick, autoFocus }: { onPick: (p: PlayerOption) => void; autoFocus?: boolean }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<PlayerOption[]>([])
  const [active, setActive] = useState(0)
  const [busy, setBusy] = useState(false)
  const seq = useRef(0)
  // `useId` rather than a random string: stable across a re-render, and the same on server and
  // client, which a random value is not.
  const listId = useId()

  useEffect(() => {
    const term = query.trim()
    if (term.length < 2) return
    const mine = ++seq.current
    const timer = setTimeout(async () => {
      setBusy(true)
      try {
        const found = await searchPlayersAction(term)
        if (mine === seq.current) { setResults(found); setActive(0) }
      } catch {
        if (mine === seq.current) setResults([])
      } finally {
        if (mine === seq.current) setBusy(false)
      }
    }, 180)
    return () => clearTimeout(timer)
  }, [query])

  const choose = useCallback((p: PlayerOption) => { setQuery(''); setResults([]); onPick(p) }, [onPick])

  const shown = query.trim().length >= 2 ? results : []

  return (
    <div className="relative">
      <label htmlFor={listId} className="sr-only">Search for an opponent by CueVerse ID, name or alias</label>
      <div className="relative">
        <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2" style={{ color: 'var(--pf-muted)' }} aria-hidden />
        <input
          id={listId}
          role="combobox"
          autoComplete="off"
          autoFocus={autoFocus}
          aria-expanded={shown.length > 0}
          aria-controls={`${listId}-list`}
          aria-autocomplete="list"
          aria-activedescendant={shown[active] ? `${listId}-opt-${active}` : undefined}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') { setQuery(''); setResults([]); return }
            if (shown.length === 0) return
            if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => (i + 1) % shown.length) }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => (i - 1 + shown.length) % shown.length) }
            else if (e.key === 'Enter') { e.preventDefault(); const p = shown[active]; if (p) choose(p) }
          }}
          placeholder="Search players"
          className="w-full border py-1.5 pl-7 pr-2 text-sm"
          style={{ background: 'var(--pf-surface)', borderColor: 'var(--pf-border)', color: 'var(--pf-text)' }}
        />
      </div>
      <span aria-live="polite" className="sr-only">
        {busy ? 'Searching' : shown.length > 0 ? `${shown.length} players found` : ''}
      </span>
      {shown.length > 0 && (
        <ul
          id={`${listId}-list`}
          role="listbox"
          aria-label="Opponents"
          className="pf-scroll absolute z-40 mt-1 max-h-64 w-full overflow-auto border shadow-lg"
          style={{ background: 'var(--pf-panel)', borderColor: 'var(--pf-border)' }}
        >
          {shown.map((p, i) => (
            <li
              key={p.id}
              id={`${listId}-opt-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => { e.preventDefault(); choose(p) }}
              className={cn('cursor-pointer px-2.5 py-1.5 text-sm')}
              style={i === active ? { background: 'var(--pf-accent-soft)', color: 'var(--pf-text)' } : { color: 'var(--pf-text)' }}
            >
              <span className="block truncate font-semibold">{p.cueverseId || p.name}</span>
              {p.name && p.name.toLowerCase() !== (p.cueverseId || '').toLowerCase() && (
                <span className="block truncate text-xs" style={{ color: 'var(--pf-muted)' }}>{p.name}</span>
              )}
              {p.matchedOn === 'alias' && p.matchedValue && (
                <span className="block truncate text-xs" style={{ color: 'var(--pf-muted)' }}>also known as {p.matchedValue}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function Figure({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="pf-label truncate">{label}</dt>
      <dd className={cn('pf-figure mt-1', accent && 'pf-figure-accent')}>{value}</dd>
    </div>
  )
}
