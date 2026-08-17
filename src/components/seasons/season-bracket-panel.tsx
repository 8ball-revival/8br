'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { Trophy } from 'lucide-react'

import { cn } from '@/lib/utils'
import { identityLines, fromNameHandle } from '@/lib/identity/display'
import type { BracketRound, BracketMatch, BracketSlot } from '@/lib/tournaments/service'

/**
 * The Season playoff bracket, as one panel.
 *
 * Round lanes rather than a free-floating tree: a lane gives the heading somewhere to live and keeps
 * every card in a column the eye can follow. Within a lane each match occupies an equal share of the
 * height, which is what makes a later round sit centred against the ties that fed it — the geometry
 * that makes a bracket readable — without any of it being computed in script.
 *
 * Connectors are borders on the match cell, so they scale with the cards and cost nothing. Ordinary
 * paths are a muted gray-gold; the champion's route, and whichever player the reader is pointing at,
 * are lit brighter.
 *
 * All sideways movement happens inside this panel. The page body never scrolls horizontally.
 */

/** Card geometry. A bigger field gets narrower cards and tighter gutters so more rounds fit. */
interface Metrics { cardW: number; rowH: number; matchGap: number; laneGap: number }
const WIDE: Metrics = { cardW: 278, rowH: 38, matchGap: 10, laneGap: 24 }
const TIGHT: Metrics = { cardW: 254, rowH: 36, matchGap: 8, laneGap: 20 }
const metricsFor = (players: number): Metrics => (players >= 32 ? TIGHT : WIDE)

/** Identity key for a slot — what "the same player in a later round" means. */
const keyOf = (slot?: BracketSlot): string | null =>
  slot?.name && slot.name !== 'Bye' ? (slot.slug ?? slot.handle ?? slot.name) : null

export function SeasonBracketPanel({
  rounds,
  note,
  champion,
}: {
  rounds: BracketRound[]
  /** The explanatory playoff note, shown as a footer strip inside the panel. */
  note: string | null
  /** Present only for a closed Season; drives the Final's champion treatment. */
  champion: {
    cueverseId: string | null
    preferredName: string | null
    runnerUp: string | null
    finalScore: string | null
  } | null
}) {
  const players = useMemo(() => {
    const ids = new Set<string>()
    for (const r of rounds) for (const m of r.matches) for (const s of [m.a, m.b]) {
      const k = keyOf(s)
      if (k) ids.add(k)
    }
    return ids.size
  }, [rounds])

  const metrics = metricsFor(players)

  /** The player whose route is lit. Null means nothing is singled out. */
  const [focused, setFocused] = useState<string | null>(null)
  const scrollerRef = useRef<HTMLDivElement>(null)
  const treeRef = useRef<HTMLDivElement>(null)
  const [fitScale, setFitScale] = useState<number | null>(null)

  /** The champion's key, so their whole route can be lit without re-deriving it per card. */
  const championKey = useMemo(
    () => (champion ? champion.cueverseId ?? champion.preferredName ?? null : null),
    [champion],
  )

  /**
   * Fit the bracket to the panel: the tree's real width against the scroller's real width.
   * Scaling above 1 is deliberately not offered — a bracket blown up past its natural size looks
   * broken, and Zoom already covers wanting it larger.
   */
  const fit = useCallback(() => {
    const scroller = scrollerRef.current
    const tree = treeRef.current
    if (!scroller || !tree) return
    const available = scroller.clientWidth
    const natural = tree.scrollWidth / (fitScale ?? 1)
    if (!available || !natural) return
    setFitScale(Math.min(1, Math.max(0.4, (available - 2) / natural)))
  }, [fitScale])

  useEffect(() => {
    if (fitScale == null) return
    const onResize = () => fit()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [fitScale, fit])

  // The Fit control sits in the Season toolbar, which is a sibling, so it asks through an event.
  useEffect(() => {
    const onFit = () => fit()
    const onManual = () => setFitScale(null)
    window.addEventListener('8br:bracket-fit', onFit)
    window.addEventListener('8br:bracket-manual-zoom', onManual)
    return () => {
      window.removeEventListener('8br:bracket-fit', onFit)
      window.removeEventListener('8br:bracket-manual-zoom', onManual)
    }
  }, [fit])

  /**
   * Highlighting is delegated from the tree rather than bound per row.
   *
   * `focusin` and `pointerover` bubble; `focus` and `mouseenter` do not. Binding per row meant a
   * programmatic focus, and some real ones, never reached the handler at all.
   */
  const onPointerOver = (e: React.PointerEvent) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-player]')
    if (el) setFocused(el.dataset.player ?? null)
  }
  const onFocusIn = (e: React.FocusEvent) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-player]')
    if (el) setFocused(el.dataset.player ?? null)
  }

  const activeKey = focused ?? null

  return (
    <section
      aria-label="Playoff bracket"
      className="w-full overflow-hidden rounded-2xl border border-[color-mix(in_oklch,var(--gold-dim)_55%,transparent)] bg-card"
    >
      <header className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-2.5">
        <h2 className="text-[0.68rem] font-extrabold uppercase tracking-[0.18em] text-[var(--gold)]">
          Playoff Bracket
        </h2>
        <span className="text-[0.7rem] text-muted-foreground">
          {players} player{players === 1 ? '' : 's'} · {rounds.length} round{rounds.length === 1 ? '' : 's'}
        </span>
        {fitScale != null && (
          <span className="ml-auto text-[0.7rem] text-muted-foreground">
            Fitted to {Math.round(fitScale * 100)}% — Zoom takes manual control
          </span>
        )}
      </header>

      {/* The ONLY horizontal scroller in this view. */}
      <div ref={scrollerRef} className="scrollbar-themed overflow-x-auto">
        <div
          ref={treeRef}
          onPointerOver={onPointerOver}
          onPointerLeave={() => setFocused(null)}
          onFocusCapture={onFocusIn}
          onBlurCapture={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setFocused(null) }}
          className="bp-tree flex min-w-min items-stretch"
          style={{
            ['--bp-card-w' as string]: `${metrics.cardW}px`,
            ['--bp-row-h' as string]: `${metrics.rowH}px`,
            ['--bp-match-gap' as string]: `${metrics.matchGap}px`,
            ['--bp-lane-gap' as string]: `${metrics.laneGap}px`,
            ...(fitScale != null ? { zoom: fitScale } : {}),
          }}
        >
          {rounds.map((round, ri) => {
            const isFinal = ri === rounds.length - 1
            const isFirst = ri === 0
            return (
              <div
                key={ri}
                className={cn(
                  'bp-lane flex min-w-0 flex-col',
                  ri % 2 === 1 && 'bp-lane-alt',
                  ri < rounds.length - 1 && 'bp-lane-divider',
                )}
              >
                <p className="bp-lane-head sticky top-0 z-20 whitespace-nowrap px-3 pb-3 pt-3 text-center text-[0.6rem] font-extrabold uppercase tracking-[0.14em] text-muted-foreground">
                  {round.name}
                  <span className="text-[var(--gold-dim)]">
                    {' · '}{round.matches.length} match{round.matches.length === 1 ? '' : 'es'}
                  </span>
                </p>

                <div className={cn('bp-body flex flex-1 flex-col', !isFinal && 'bp-feeds', !isFirst && 'bp-receives')}>
                  {round.matches.map((m, mi) => {
                    const aKey = keyOf(m.a)
                    const bKey = keyOf(m.b)
                    const onChampPath = championKey != null && (aKey === championKey || bKey === championKey)
                    const onActivePath = activeKey != null && (aKey === activeKey || bKey === activeKey)
                    return (
                      <div
                        key={mi}
                        className={cn(
                          'bp-cell relative flex items-center',
                          onActivePath ? 'bp-path-lit' : onChampPath ? 'bp-path-champ' : null,
                          activeKey != null && !onActivePath && 'bp-muted',
                        )}
                      >
                        {isFinal && champion ? (
                          <FinalBlock match={m} champion={champion} activeKey={activeKey} />
                        ) : (
                          <MatchCard match={m} activeKey={activeKey} onChampPath={onChampPath} />
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {note && (
        <footer className="flex items-start gap-2 border-t border-border px-4 py-2.5 text-[0.7rem] leading-relaxed text-muted-foreground">
          <span aria-hidden className="mt-[3px] flex size-3.5 shrink-0 items-center justify-center rounded-full border border-[var(--gold-dim)] text-[0.55rem] text-[var(--gold-dim)]">i</span>
          <span>{note}</span>
        </footer>
      )}
    </section>
  )
}

/* ---------------------------------------------------------------- an ordinary matchup */

function MatchCard({
  match, activeKey, onChampPath,
}: {
  match: BracketMatch
  activeKey: string | null
  onChampPath: boolean
}) {
  return (
    <div
      className={cn(
        'bp-card overflow-hidden rounded-lg border bg-card',
        onChampPath ? 'border-[var(--gold-dim)]' : 'border-border',
      )}
      style={{ width: 'var(--bp-card-w)' }}
    >
      <SlotRow slot={match.a} won={match.winner === 'a'} lost={match.winner === 'b'} activeKey={activeKey} />
      <div className="h-px bg-border" />
      <SlotRow slot={match.b} won={match.winner === 'b'} lost={match.winner === 'a'} activeKey={activeKey} />
    </div>
  )
}

function SlotRow({
  slot, won, lost, activeKey, large = false,
}: {
  slot?: BracketSlot
  won: boolean
  lost: boolean
  activeKey: string | null
  large?: boolean
}) {
  const lines = identityLines(fromNameHandle(slot))
  const isPlayer = !!slot?.name && slot.name !== 'Bye'
  const k = keyOf(slot)
  const lit = k != null && activeKey === k

  if (!isPlayer) {
    return (
      <div className="flex items-center px-2.5 text-[0.78rem] italic text-muted-foreground/60" style={{ height: 'var(--bp-row-h)' }}>
        {slot?.name === 'Bye' ? 'bye' : 'TBD'}
      </div>
    )
  }

  const profile = slot?.slug ?? slot?.handle

  return (
    <div
      data-player={k ?? undefined}
      tabIndex={0}
      role="button"
      aria-pressed={lit}
      aria-label={`${lines.primary}${slot?.seed != null ? `, seed ${slot.seed}` : ''}${won ? ', winner' : ''}${slot?.score != null ? `, ${slot.score}` : ''}`}
      className={cn(
        'flex cursor-pointer items-center gap-2.5 px-2.5 outline-none transition-colors',
        won && 'bg-gold/[0.07]',
        lit && 'bg-gold/[0.16]',
        'focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--gold)]/60',
      )}
      style={{ height: large ? 'calc(var(--bp-row-h) * 1.5)' : 'var(--bp-row-h)' }}
    >
      <SeedBadge seed={slot?.seed} highlight={won || lit} large={large} />
      <span className="min-w-0 flex-1">
        {profile ? (
          <Link href={`/players/${encodeURIComponent(profile)}`} className="block min-w-0 hover:underline">
            <NameLines lines={lines} won={won} lost={lost} large={large} />
          </Link>
        ) : (
          <NameLines lines={lines} won={won} lost={lost} large={large} />
        )}
      </span>
      {slot?.score != null && (
        <span className={cn(
          'tabular shrink-0',
          large ? 'text-2xl' : 'text-sm',
          won ? 'font-bold text-gold' : 'text-muted-foreground',
        )}>
          {slot.score}
        </span>
      )}
    </div>
  )
}

function NameLines({
  lines, won, lost, large,
}: {
  lines: { primary: string; secondary: string | null }
  won: boolean
  lost: boolean
  large?: boolean
}) {
  return (
    <>
      <span className={cn(
        'block truncate leading-tight',
        large ? 'text-lg' : 'text-[0.82rem]',
        won ? 'font-bold text-gold' : lost ? 'text-muted-foreground' : 'text-foreground',
      )}>
        {lines.primary}
      </span>
      {lines.secondary && (
        <span className={cn('block truncate leading-tight text-muted-foreground', large ? 'text-xs' : 'text-[0.58rem]')}>
          {lines.secondary}
        </span>
      )}
    </>
  )
}

/** The seed, as a small circular badge. Every seeded player carries one, in every round. */
function SeedBadge({ seed, highlight, large }: { seed?: number; highlight: boolean; large?: boolean }) {
  const size = large ? 'size-6 text-[0.68rem]' : 'size-[19px] text-[0.58rem]'
  if (seed == null) return <span className={cn('shrink-0', size)} aria-hidden />
  return (
    <span
      aria-hidden
      className={cn(
        'tabular flex shrink-0 items-center justify-center rounded-full border font-bold leading-none',
        size,
        highlight
          ? 'border-[var(--gold-dim)] bg-[color-mix(in_oklch,var(--gold)_16%,transparent)] text-[var(--gold-soft)]'
          : 'border-border bg-surface text-muted-foreground',
      )}
    >
      {seed}
    </span>
  )
}

/* ---------------------------------------------------------------- the Final */

/**
 * The Final, given the weight it deserves without becoming a second banner.
 *
 * A trophy and the title sit above a slightly larger card carrying the same two rows as every other
 * matchup — same seeds, same names, same scores — so it stays part of the bracket rather than a
 * summary pasted beside it.
 */
function FinalBlock({
  match, champion, activeKey,
}: {
  match: BracketMatch
  champion: { cueverseId: string | null; preferredName: string | null; runnerUp: string | null; finalScore: string | null }
  activeKey: string | null
}) {
  return (
    <div className="flex flex-col items-center" style={{ width: 'calc(var(--bp-card-w) * 1.06)' }}>
      <div className="mb-2 flex items-center gap-2.5">
        <Trophy
          aria-hidden
          strokeWidth={1.5}
          className="size-8 shrink-0 fill-[color-mix(in_oklch,var(--gold)_30%,transparent)] text-[var(--gold-soft)] drop-shadow-[0_0_7px_color-mix(in_oklch,var(--gold)_60%,transparent)]"
        />
        <p className="whitespace-nowrap text-[0.66rem] font-extrabold uppercase tracking-[0.18em] text-[var(--gold-soft)]">
          Season Champion
        </p>
      </div>

      <div className="bp-final w-full overflow-hidden rounded-xl border border-[var(--gold)] bg-card">
        <SlotRow slot={match.a} won={match.winner === 'a'} lost={match.winner === 'b'} activeKey={activeKey} large />
        <div className="h-px bg-[var(--gold-dim)]/40" />
        <SlotRow slot={match.b} won={match.winner === 'b'} lost={match.winner === 'a'} activeKey={activeKey} large />
      </div>

      {champion.runnerUp && (
        <p className="mt-2 text-center text-[0.66rem] text-muted-foreground">
          def. <span className="text-foreground">{champion.runnerUp}</span>
          {champion.finalScore && <span className="text-[var(--gold)]"> · {champion.finalScore}</span>}
        </p>
      )}
    </div>
  )
}
