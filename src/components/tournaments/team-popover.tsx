'use client'

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import Link from 'next/link'
import { Crown } from 'lucide-react'

import { fromNameHandle, identityText } from '@/lib/identity/display'

import { cn } from '@/lib/utils'

export interface PopoverMember { name: string; handle?: string; slug?: string; rating?: number | null; captain?: boolean }

// ---- One-at-a-time coordinator (module-level; no provider needed) ----------
let openKey: string | null = null
const listeners = new Set<() => void>()
function setOpenKey(k: string | null) { openKey = k; listeners.forEach((l) => l()) }
function subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l) } }
function useIsOpen(key: string) {
  return useSyncExternalStore(subscribe, () => openKey === key, () => false)
}

/**
 * A team name in the bracket that opens an accessible details popover on hover / focus / click (and
 * tap on mobile). Only one card is open at a time (module coordinator). Escape or an outside click
 * closes it; the card is viewport-clamped (position: fixed, so overflow containers never clip it) and
 * rendered inline right after the trigger so keyboard tab-order stays natural.
 */
export function TeamName({
  name,
  seed,
  members,
  record,
  avgRating,
  won,
  dim,
  variant = 'name',
}: {
  name: string
  seed?: number
  members: PopoverMember[]
  record?: string
  avgRating?: number | null
  won?: boolean
  dim?: boolean
  /**
   * `name` renders the team name as the trigger, which is how a standalone team label behaves.
   *
   * `details` renders a small affordance instead, for the bracket, where the row itself now prints
   * the team name and its roster's CueVerse IDs. The popover keeps what identity does not cover —
   * ratings and record — so nothing is lost by taking the names out from behind the hover.
   */
  variant?: 'name' | 'details'
}) {
  const key = useId()
  const open = useIsOpen(key)
  const [pinned, setPinned] = useState(false)
  const btnRef = useRef<HTMLButtonElement>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)

  const close = useCallback(() => { setPinned(false); if (openKey === key) setOpenKey(null) }, [key])
  const openNow = useCallback(() => { if (closeTimer.current) clearTimeout(closeTimer.current); setOpenKey(key) }, [key])
  const scheduleClose = useCallback(() => {
    if (pinned) return
    if (closeTimer.current) clearTimeout(closeTimer.current)
    closeTimer.current = setTimeout(() => { if (!pinned) close() }, 140)
  }, [pinned, close])

  // Position the card under the trigger, clamped to the viewport.
  useLayoutEffect(() => {
    if (!open || !btnRef.current) return
    const r = btnRef.current.getBoundingClientRect()
    const W = 268, margin = 8
    const estH = 120 + members.length * 22
    let left = Math.min(Math.max(margin, r.left), window.innerWidth - W - margin)
    let top = r.bottom + 6
    if (top + estH > window.innerHeight - margin) top = Math.max(margin, r.top - estH - 6) // flip above near the bottom edge
    left = Math.max(margin, Math.min(left, window.innerWidth - W - margin))
    setPos({ top, left })
  }, [open, members.length])

  // Escape closes + restores focus; outside click / scroll closes.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { close(); btnRef.current?.focus() } }
    const onDown = (e: PointerEvent) => { const t = e.target as Node; if (!btnRef.current?.contains(t) && !cardRef.current?.contains(t)) close() }
    const onScroll = () => close()
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onDown, true)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onScroll)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onScroll)
    }
  }, [open, close])

  useEffect(() => () => { if (closeTimer.current) clearTimeout(closeTimer.current) }, [])

  const avg = avgRating != null ? avgRating : (() => { const rs = members.map((m) => m.rating).filter((r): r is number => r != null); return rs.length ? Math.round(rs.reduce((s, v) => s + v, 0) / rs.length) : null })()

  return (
    <span className="relative inline-flex min-w-0 max-w-full">
      <button
        ref={btnRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onMouseEnter={openNow}
        onMouseLeave={scheduleClose}
        onFocus={openNow}
        onBlur={scheduleClose}
        onClick={() => { if (open && pinned) { close() } else { setPinned(true); openNow() } }}
        className={cn(
          'rounded text-left outline-none focus-visible:ring-2 focus-visible:ring-[var(--bracket-focus)]',
          variant === 'details'
            ? 'inline-flex size-[0.95rem] shrink-0 items-center justify-center border border-[var(--bracket-outline)] rounded-full text-[0.55rem] leading-none text-[var(--bracket-text-neutral)] hover:text-[var(--bracket-text)]'
            : cn(
              'block max-w-full truncate text-[1.02rem] leading-snug tracking-tight',
              won ? 'font-bold text-foreground' : dim ? 'bracket-loser-name font-bold italic' : 'font-medium text-foreground',
              'underline decoration-dotted decoration-muted-foreground/40 underline-offset-2 hover:decoration-brand',
            ),
        )}
        title={variant === 'details' ? `${name} — roster, rating and record` : name}
        aria-label={variant === 'details' ? `${name} — team details` : undefined}
      >
        {variant === 'details' ? <span aria-hidden>i</span> : name}
      </button>

      {open && pos && (
        <div
          ref={cardRef}
          role="dialog"
          aria-label={`${name} — team details`}
          onMouseEnter={() => { if (closeTimer.current) clearTimeout(closeTimer.current) }}
          onMouseLeave={scheduleClose}
          style={{ position: 'fixed', top: pos.top, left: pos.left, width: 268 }}
          className="z-[60] rounded-lg border border-border bg-popover p-3 text-sm shadow-2xl"
        >
          <div className="mb-2 flex items-start justify-between gap-2 border-b border-border/60 pb-2">
            <div className="min-w-0">
              <p className="break-words font-bold leading-tight text-foreground">{name}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {seed != null && <>Seed {seed}</>}
                {seed != null && record && <span className="px-1">·</span>}
                {record && <>Record {record}</>}
              </p>
            </div>
            {avg != null && (
              <div className="shrink-0 text-right">
                <div className="text-base font-bold tabular-nums text-brand">{avg}</div>
                <div className="text-[0.6rem] uppercase tracking-wide text-muted-foreground">Avg</div>
              </div>
            )}
          </div>
          <ul className="space-y-1">
            {members.map((m, i) => {
              const id = identityText(fromNameHandle(m))
              return (
                <li key={i} className="flex items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-1.5">
                    {m.captain && <Crown className="size-3 shrink-0 text-brand" aria-label="Captain" />}
                    {m.slug ? (
                      <Link href={`/players/${encodeURIComponent(m.slug)}`} className="truncate hover:text-brand hover:underline">{id}</Link>
                    ) : (
                      <span className="truncate">{id}</span>
                    )}
                  </span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">{m.rating != null ? m.rating : '—'}</span>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </span>
  )
}

/**
 * The bracket's team affordance: ratings and record behind a small trigger.
 *
 * The team name and its roster's CueVerse IDs are printed on the row itself, so this carries only
 * what identity does not — which is why hiding it behind a hover is reasonable and hiding the names
 * there was not.
 */
export function TeamDetails(props: Omit<Parameters<typeof TeamName>[0], 'variant'>) {
  return <TeamName {...props} variant="details" />
}
