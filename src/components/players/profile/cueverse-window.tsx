'use client'

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { ArrowLeft, ExternalLink } from 'lucide-react'
import type { CueverseResult, CueverseGame } from '@/lib/cueverse/profile'
import { cn } from '@/lib/utils'

/**
 * The CueVerse window: their record, their last hundred games, and their replays.
 *
 * ── This is CueVerse's data and it stays CueVerse's ─────────────────────────────────────────────
 * Nothing in here is mixed with an 8 Ball Registry figure. The rating is CueVerse's rating, the
 * wins are CueVerse's wins, and the rating after each game is the number CueVerse recorded at the
 * time — passed through, never recomputed. The two careers sit in different windows for exactly
 * this reason: a combined number would belong to neither ladder and could not be checked against
 * either.
 *
 * ── No filters, by instruction ──────────────────────────────────────────────────────────────────
 * CueVerse's own page has a timezone picker and 20/50/100 buttons. Those are gone here: always the
 * latest 100, always the visitor's own timezone. The table scrolls inside itself with the headings
 * pinned, so the controls that used to manage a short table are not needed.
 *
 * ── Replays ─────────────────────────────────────────────────────────────────────────────────────
 * One at a time, mounted only when chosen and unmounted the moment it is left, so no iframe is ever
 * running in the background. Watching replaces the table inside this same window rather than
 * opening a page — and coming back returns to the row that was clicked, which is what makes
 * watching three games in a row bearable.
 */

const IFRAME_TITLE = 'CueVerse replay'

export function CueverseWindow({ result, cueverseId }: { result: CueverseResult; cueverseId: string | null }) {
  const [replay, setReplay] = useState<CueverseGame | null>(null)
  const tableRef = useRef<HTMLDivElement>(null)
  /** Where the table was scrolled to when Watch was pressed. */
  const savedScroll = useRef(0)
  const backRef = useRef<HTMLButtonElement>(null)
  const returnFocusTo = useRef<HTMLAnchorElement | HTMLButtonElement | null>(null)

  /*
    Restore the reading position when the replay closes.

    Layout has to have happened before the scroll can be set, so this runs after the table is back.
  */
  useEffect(() => {
    if (replay) { backRef.current?.focus(); return }
    const el = tableRef.current
    if (el && savedScroll.current) el.scrollTop = savedScroll.current
    returnFocusTo.current?.focus()
    returnFocusTo.current = null
  }, [replay])

  if (result.status === 'no-id') {
    return (
      <Notice
        title="No CueVerse profile linked"
        body="This player has no CueVerse ID recorded, so there is no CueVerse profile to read. Archive players from before CueVerse often have none."
      />
    )
  }
  if (result.status === 'not-found') {
    return (
      <Notice
        title="CueVerse has no profile for this ID"
        body={`CueVerse does not recognise “${result.cueverseId}”. The ID may have been changed on CueVerse, or the account may no longer exist.`}
      />
    )
  }
  if (result.status === 'unavailable') {
    return (
      <Notice
        title="CueVerse is unavailable"
        body={`${result.reason} The 8 Ball Registry record on this profile is unaffected — it does not come from CueVerse.`}
        href={cueverseId ? `https://cueverse.gg/profile/?name=${encodeURIComponent(cueverseId)}&game=pool` : null}
      />
    )
  }

  const { profile, fetchedAt } = result
  const r = profile.record

  if (replay) {
    return (
      <div className="flex h-full min-h-[70vh] flex-col">
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
          <button
            type="button"
            ref={backRef}
            onClick={() => setReplay(null)}
            className="inline-flex items-center gap-1.5 border border-border px-2.5 py-1.5 text-xs font-semibold uppercase tracking-wide text-foreground transition-colors hover:border-[var(--line-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
          >
            <ArrowLeft className="size-3.5" aria-hidden />
            Back to Game History
          </button>
          <span className="min-w-0 truncate text-xs text-muted-foreground">
            vs {replay.opponent || '—'} · {replay.variation}
          </span>
          <a
            href={replay.watchHref ?? '#'}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 border border-border px-2.5 py-1.5 text-xs font-semibold uppercase tracking-wide text-foreground transition-colors hover:border-[var(--line-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
          >
            Open on CueVerse
            <ExternalLink className="size-3.5" aria-hidden />
          </a>
        </div>
        {/*
          Nearly the whole window, per the brief — a replay in a letterbox is not watchable.

          The sandbox is the minimum the replay needs: it runs its own scripts and talks to its own
          API, and `allow-same-origin` grants it ITS origin, not ours. Forms, popups, downloads and
          top-level navigation are all withheld.
        */}
        <iframe
          key={replay.id}
          src={replay.watchHref ?? ''}
          title={`${IFRAME_TITLE} — game ${replay.id}`}
          className="min-h-0 w-full flex-1 border-0 bg-black"
          sandbox="allow-scripts allow-same-origin"
          allow="fullscreen"
          loading="lazy"
          referrerPolicy="no-referrer"
        />
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-border p-3">
        <dl className="grid grid-cols-3 gap-x-4 gap-y-3 sm:grid-cols-6">
          <Stat label="Rating" value={String(r.rating)} accent note={r.provisional ? 'Provisional' : null} />
          <Stat label="Wins" value={String(r.wins)} />
          <Stat label="Losses" value={String(r.losses)} />
          <Stat label="Draws" value={String(r.draws)} />
          <Stat label="Total Games" value={String(r.total)} />
          <Stat label="Streak" value={profile.streakLabel} />
        </dl>
        <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span>CueVerse data, shown as CueVerse reports it. Not part of the 8 Ball Registry record.</span>
          <a
            href={profile.profileHref}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-brand hover:text-brand-soft"
          >
            View on CueVerse
            <ExternalLink className="size-3" aria-hidden />
          </a>
          {/* The last time CueVerse actually answered, so a stale panel can be recognised as stale. */}
          <span>Updated <LocalTime at={Date.parse(fetchedAt)} timeOnly /></span>
        </p>
      </div>

      <div ref={tableRef} className="min-h-0 flex-1 overflow-auto">
        <table className="w-full min-w-[44rem] border-collapse text-sm">
          {/* Sticky headings, because a hundred rows scrolls past the labels immediately. */}
          <thead className="sticky top-0 z-10 bg-card">
            <tr className="border-b border-border text-left">
              <Th>Date</Th>
              <Th>Opponent</Th>
              <Th>Result</Th>
              <Th>Game</Th>
              <Th className="text-right">Rating</Th>
              <Th className="text-right">Change</Th>
              <Th className="text-right">Watch</Th>
            </tr>
          </thead>
          <tbody>
            {profile.games.map((g) => (
              <tr key={g.id} className="border-b border-border/50 last:border-b-0">
                <Td className="whitespace-nowrap text-muted-foreground"><LocalTime at={g.at} /></Td>
                <Td className="text-foreground">
                  {/* CueVerse's own links, including the punctuation between names in a 2v2. */}
                  {g.opponentParts.map((part, i) => part.href ? (
                    <a
                      key={i}
                      href={part.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-brand hover:text-brand-soft"
                    >
                      {part.text}
                    </a>
                  ) : (
                    <span key={i}>{part.text}</span>
                  ))}
                </Td>
                <Td>
                  <span className={cn(
                    'inline-block px-2 py-0.5 text-xs font-semibold',
                    g.result === 'won' ? 'bg-[var(--win,transparent)]/15 text-[var(--win,inherit)]'
                      : g.result === 'lost' ? 'bg-[var(--loss,transparent)]/15 text-[var(--loss,inherit)]'
                        : 'bg-muted text-muted-foreground',
                  )}>
                    {g.resultLabel}
                  </span>
                </Td>
                <Td className="text-muted-foreground">{g.variation}</Td>
                <Td className="text-right tabular-nums text-foreground">{g.ratingAfter ?? '—'}</Td>
                <Td className="text-right tabular-nums">
                  {g.ratingChange == null ? <span className="text-muted-foreground">—</span> : (
                    <span className={g.ratingChange > 0 ? 'text-[var(--win,inherit)]' : g.ratingChange < 0 ? 'text-[var(--loss,inherit)]' : 'text-muted-foreground'}>
                      {g.ratingChange > 0 ? `+${g.ratingChange}` : g.ratingChange}
                    </span>
                  )}
                </Td>
                <Td className="text-right">
                  {g.watchHref ? (
                    <button
                      type="button"
                      onClick={(e) => {
                        savedScroll.current = tableRef.current?.scrollTop ?? 0
                        returnFocusTo.current = e.currentTarget
                        setReplay(g)
                      }}
                      className="border border-border px-2 py-1 text-xs font-semibold uppercase tracking-wide text-foreground transition-colors hover:border-[var(--line-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                    >
                      Watch
                    </button>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </Td>
              </tr>
            ))}
            {profile.games.length === 0 && (
              <tr><Td className="text-muted-foreground" colSpan={7}>CueVerse has no recorded games for this player.</Td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/**
 * A time in the visitor's own timezone.
 *
 * The server has no idea where the reader is, so formatting there would bake its own zone into the
 * HTML for everybody. It renders the ISO date — unambiguous rather than wrong — and the browser
 * replaces it with a local one after hydration.
 *
 * `useSyncExternalStore` is what says "this differs between server and client" without a state
 * update in an effect: the server snapshot is false, the client snapshot is true, and React handles
 * the swap as part of hydration instead of as a second render triggered from a side effect.
 */
const NO_SUBSCRIBE = () => () => {}
const useHydrated = () => useSyncExternalStore(NO_SUBSCRIBE, () => true, () => false)

function LocalTime({ at, timeOnly }: { at: number; timeOnly?: boolean }) {
  const hydrated = useHydrated()
  const iso = Number.isFinite(at) && at > 0 ? new Date(at).toISOString() : null
  if (!iso) return <span>—</span>

  let text = iso.slice(0, 10)
  if (hydrated) {
    try {
      text = new Intl.DateTimeFormat(undefined, timeOnly
        ? { timeStyle: 'short' }
        : { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(at))
    } catch {
      text = iso
    }
  }
  return <time dateTime={iso} suppressHydrationWarning>{text}</time>
}

function Notice({ title, body, href }: { title: string; body: string; href?: string | null }) {
  return (
    <div className="p-4">
      <div className="border border-dashed border-border p-4">
        <p className="text-sm font-semibold text-foreground">{title}</p>
        <p className="mt-1 text-sm text-muted-foreground">{body}</p>
        {href && (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-flex items-center gap-1 text-sm text-brand hover:text-brand-soft"
          >
            Try CueVerse directly
            <ExternalLink className="size-3.5" aria-hidden />
          </a>
        )}
      </div>
    </div>
  )
}

function Stat({ label, value, accent, note }: { label: string; value: string; accent?: boolean; note?: string | null }) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-[0.62rem] uppercase tracking-wider text-muted-foreground">{label}</dt>
      <dd className={cn('font-display text-lg font-bold', accent ? 'text-[var(--gold)]' : 'text-foreground')}>{value}</dd>
      {note && <p className="text-[0.62rem] uppercase tracking-wide text-muted-foreground">{note}</p>}
    </div>
  )
}

function Th({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <th scope="col" className={cn('border-b border-border px-3 py-2 text-[0.62rem] font-bold uppercase tracking-wider text-muted-foreground', className)}>
      {children}
    </th>
  )
}

function Td({ children, className, colSpan }: { children: React.ReactNode; className?: string; colSpan?: number }) {
  return <td colSpan={colSpan} className={cn('px-3 py-2 align-middle', className)}>{children}</td>
}
