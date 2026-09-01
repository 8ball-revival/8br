'use client'

import { useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'
import type { ProfileMatchRow, StageRecord } from '@/lib/players/profile'

/**
 * The pieces Seasons and Tournaments both need, written once.
 *
 * Both windows are the same shape — a list of competitions on the left, the selected one's real
 * record on the right, sub-views inside it — so the selector, the figure grid, the sub-view strip
 * and the match table live here rather than being written twice and drifting apart.
 */

/** A list of competitions to choose between. A listbox, so arrow keys work as they look like they should. */
export function ItemSelector<T extends { key: string; title: string; meta: string; badge?: string | null; dimmed?: boolean }>({
  items, selectedKey, onSelect, label, retainScroll,
}: {
  items: T[]
  selectedKey: string | null
  onSelect: (key: string) => void
  label: string
  /** A box the list writes its scroll offset into, so reopening the window returns to the same place. */
  retainScroll?: { current: number }
}) {
  const listRef = useRef<HTMLDivElement>(null)

  /*
    Restore on mount, save on unmount.

    The window unmounts when it closes, which is what makes reopening cheap; without this the list
    would come back at the top and a reader with forty seasons would lose their place every time.
  */
  useEffect(() => {
    const el = listRef.current
    if (!el || !retainScroll) return
    el.scrollTop = retainScroll.current
    return () => { retainScroll.current = el.scrollTop }
  }, [retainScroll])

  const index = items.findIndex((i) => i.key === selectedKey)

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (items.length === 0) return
    if (e.key === 'ArrowDown') { e.preventDefault(); onSelect(items[Math.min(items.length - 1, index + 1)].key) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); onSelect(items[Math.max(0, index - 1)].key) }
    else if (e.key === 'Home') { e.preventDefault(); onSelect(items[0].key) }
    else if (e.key === 'End') { e.preventDefault(); onSelect(items[items.length - 1].key) }
  }

  return (
    <div
      ref={listRef}
      role="listbox"
      aria-label={label}
      tabIndex={0}
      onKeyDown={onKeyDown}
      className="max-h-[28vh] overflow-auto border-b border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] lg:max-h-none lg:border-b-0 lg:border-r"
    >
      {items.map((item) => {
        const selected = item.key === selectedKey
        return (
          <div
            key={item.key}
            role="option"
            aria-selected={selected}
            onClick={() => onSelect(item.key)}
            className={cn(
              'cursor-pointer border-b border-border/60 px-3 py-2 last:border-b-0',
              selected ? 'bg-[var(--selected-surface,var(--accent))]' : 'hover:bg-accent/50',
            )}
          >
            <span className="flex items-baseline justify-between gap-2">
              <span className={cn('truncate text-sm font-semibold', item.dimmed ? 'text-muted-foreground' : 'text-foreground')}>
                {item.title}
              </span>
              {item.badge && (
                <span className="shrink-0 text-[0.62rem] font-bold uppercase tracking-wide text-[var(--gold)]">{item.badge}</span>
              )}
            </span>
            <span className="block truncate text-xs text-muted-foreground">{item.meta}</span>
          </div>
        )
      })}
      {items.length === 0 && <p className="px-3 py-4 text-sm text-muted-foreground">Nothing recorded yet.</p>}
    </div>
  )
}

/** The sub-views inside a window — Overview, Group Stage, Playoffs, Matches. */
export function SubViews({ views, active, onChange }: {
  views: { key: string; label: string; disabled?: boolean }[]
  active: string
  onChange: (key: string) => void
}) {
  return (
    <div role="tablist" aria-label="Section" className="flex flex-wrap gap-1 border-b border-border px-3">
      {views.map((v) => (
        <button
          key={v.key}
          role="tab"
          aria-selected={v.key === active}
          disabled={v.disabled}
          onClick={() => onChange(v.key)}
          className={cn(
            '-mb-px border-b-2 px-2.5 py-2 text-xs font-semibold uppercase tracking-wide transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]',
            v.disabled && 'cursor-not-allowed opacity-40',
            v.key === active ? 'border-[var(--gold)] text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
          )}
        >
          {v.label}
        </button>
      ))}
    </div>
  )
}

/** One figure. `—` where the records do not support a number, never a zero standing in for one. */
export function Figure({ label, value, tone }: { label: string; value: string | null; tone?: 'up' | 'down' }) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-[0.62rem] uppercase tracking-wider text-muted-foreground">{label}</dt>
      <dd className={cn(
        'font-display text-base font-bold',
        value == null ? 'text-muted-foreground'
          : tone === 'up' ? 'text-[var(--win,inherit)]'
            : tone === 'down' ? 'text-[var(--loss,inherit)]' : 'text-foreground',
      )}>
        {value ?? '—'}
      </dd>
    </div>
  )
}

export const recordText = (r: StageRecord | null): string | null =>
  r == null ? null : `${r.wins}–${r.losses}${r.draws > 0 ? `–${r.draws}` : ''}`

export const played = (r: StageRecord | null): number => (r ? r.wins + r.losses + r.draws : 0)

export const signed = (n: number | null): string | null =>
  n == null ? null : n > 0 ? `+${n}` : String(n)

/**
 * Why a competition has no figures, said plainly.
 *
 * The alternative — a 0-0 record and a 0% win rate — is a statement that somebody turned up and
 * played nothing, which the archive does not say and which is usually false. What is missing is the
 * match records, not the matches.
 */
export function RosterOnlyNotice({ what }: { what: string }) {
  return (
    <div className="border border-dashed border-border p-4">
      <p className="text-sm font-semibold text-foreground">On the roster; no match records</p>
      <p className="mt-1 text-sm text-muted-foreground">
        This player is recorded as an entrant in this {what}, but the archive holds no completed
        matches for them in it. No record, rating change or win percentage is shown, because none can
        be worked out from what survives.
      </p>
    </div>
  )
}

/** The verified matches, exactly as the ledger holds them. */
export function MatchTable({ matches, emptyText }: { matches: ProfileMatchRow[]; emptyText: string }) {
  if (matches.length === 0) {
    return <p className="px-3 py-4 text-sm text-muted-foreground">{emptyText}</p>
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[38rem] border-collapse text-sm">
        <thead>
          <tr className="border-b border-border text-left">
            <Th>Phase</Th>
            <Th>Round</Th>
            <Th>Opponent</Th>
            <Th className="text-right">Score</Th>
            <Th>Result</Th>
            <Th className="text-right">Rating</Th>
          </tr>
        </thead>
        <tbody>
          {matches.map((m) => (
            <tr key={`${m.sequence}`} className="border-b border-border/50 last:border-b-0">
              <Td className="text-muted-foreground">{m.stage === 'PLAYOFF' ? 'Playoffs' : 'Group'}</Td>
              <Td className="text-muted-foreground">{m.roundLabel ?? '—'}</Td>
              <Td className="font-medium text-foreground">
                {m.opponentName}
                {m.isTeamMatch && m.teamName && (
                  <span className="block text-xs text-muted-foreground">for {m.teamName}</span>
                )}
              </Td>
              {/* A dash, not 0–0: the frames for this match were never recorded. */}
              <Td className="text-right tabular-nums text-foreground">{m.score ?? '—'}</Td>
              <Td>
                <ResultPill result={m.result} isForfeit={m.isForfeit} />
              </Td>
              <Td className="text-right tabular-nums">
                <span className={m.ratingChange > 0 ? 'text-[var(--win,inherit)]' : m.ratingChange < 0 ? 'text-[var(--loss,inherit)]' : 'text-muted-foreground'}>
                  {m.ratingChange > 0 ? `+${m.ratingChange}` : m.ratingChange}
                </span>
                <span className="ml-2 text-muted-foreground">{m.ratingAfter}</span>
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function ResultPill({ result, isForfeit }: { result: 'WIN' | 'LOSS' | 'DRAW'; isForfeit?: boolean }) {
  const label = isForfeit ? (result === 'WIN' ? 'Won (FF)' : 'Lost (FF)') : result === 'WIN' ? 'Won' : result === 'LOSS' ? 'Lost' : 'Draw'
  return (
    <span className={cn(
      'inline-block px-2 py-0.5 text-xs font-semibold',
      result === 'WIN' ? 'bg-[var(--win,transparent)]/15 text-[var(--win,inherit)]'
        : result === 'LOSS' ? 'bg-[var(--loss,transparent)]/15 text-[var(--loss,inherit)]'
          : 'bg-muted text-muted-foreground',
    )}>
      {label}
    </span>
  )
}

export function Th({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <th scope="col" className={cn('px-3 py-2 text-[0.62rem] font-bold uppercase tracking-wider text-muted-foreground', className)}>
      {children}
    </th>
  )
}

export function Td({ children, className, colSpan }: {
  children: React.ReactNode
  className?: string
  colSpan?: number
}) {
  return <td colSpan={colSpan} className={cn('px-3 py-2 align-top', className)}>{children}</td>
}
