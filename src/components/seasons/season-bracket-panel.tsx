'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'

import { cn } from '@/lib/utils'
import { identityText, fromNameHandle } from '@/lib/identity/display'
import {
  BracketCard, BracketIdentity, BracketRow, BracketRowDivider, BracketScore, BracketSeed, slotState,
} from '@/components/bracket/primitives'
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

/**
 * Card geometry. A bigger field gets narrower cards and tighter gutters so more rounds fit.
 *
 * `cardMin`/`cardW` are a RANGE, not a fixed size: the lanes share out whatever width the panel has,
 * so a card grows and shrinks with the window while the type stays the size it was. Shrinking the
 * card is what keeps a bracket on screen; shrinking the words is a last resort, and that is what the
 * scale below the minimum is for.
 */
interface Metrics { cardW: number; cardMin: number; rowH: number; matchGap: number; laneGap: number }
const WIDE: Metrics = { cardW: 208, cardMin: 143, rowH: 38, matchGap: 10, laneGap: 24 }
const TIGHT: Metrics = { cardW: 190, cardMin: 132, rowH: 36, matchGap: 8, laneGap: 20 }
const metricsFor = (players: number): Metrics => (players >= 32 ? TIGHT : WIDE)

/**
 * How far the bracket may be shrunk to fit before legibility gives out.
 *
 * At 0.62 a 278px card is still ~172px and the names are around 8.5px — small, but readable. Below
 * that the bracket stops shrinking and the panel scrolls instead, which is the same trade the group
 * tables make rather than squeezing their cells into illegibility.
 */
export const MIN_SCALE = 0.62

/**
 * The scale that fits `natural` pixels of bracket into `available` pixels of panel.
 *
 * Pure, so the rule can be tested without a browser: never magnified past 1, never shrunk past the
 * legibility floor, and left alone entirely when the width has not been measured yet.
 */
export function fitScaleFor(available: number, natural: number): number {
  if (!available || !natural) return 1
  return Math.min(1, Math.max(MIN_SCALE, (available - 2) / natural))
}

/** The bracket's width at scale 1, with cards at their widest. */
export function naturalBracketWidth(roundCount: number, m: { cardW: number; laneGap: number }): number {
  if (roundCount <= 0) return 0
  return roundCount * (m.cardW + m.laneGap)
}

/**
 * The narrowest the bracket can get on card width alone, before anything has to be scaled.
 *
 * Down to this width the cards simply flex; below it they would stop being readable, so the panel
 * scales instead — and below the scale floor it scrolls.
 */
export function minimumBracketWidth(roundCount: number, m: { cardMin: number; laneGap: number }): number {
  if (roundCount <= 0) return 0
  return roundCount * (m.cardMin + m.laneGap)
}

/** The two geometries, exported so tests can reason about real card sizes. */
export const BRACKET_METRICS = { WIDE, TIGHT, metricsFor }

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
  /** The scale in force. 1 until measured; auto-fitting narrows it to whatever the panel allows. */
  const [scale, setScale] = useState(1)
  /** The champion's key, so their whole route can be lit without re-deriving it per card. */
  const championKey = useMemo(
    () => (champion ? champion.cueverseId ?? champion.preferredName ?? null : null),
    [champion],
  )

  /**
   * The bracket's width at scale 1, computed from the geometry rather than measured.
   *
   * Measuring the rendered tree would feed its own scaled width back into the next calculation and
   * oscillate. The lanes are a known size, so the natural width is simply their sum: every lane is
   * a card plus its two half-gutters, and the Final's card is a little wider.
   */
  // Scaling only has to cover what flexing cannot: the point where even the narrowest cards overflow.
  const floorWidth = useMemo(
    () => minimumBracketWidth(rounds.length, metrics),
    [rounds.length, metrics],
  )

  /**
   * Scale the bracket to the width available, exactly as the group tables fill theirs.
   *
   * Clamped at both ends: never magnified past its natural size, and never shrunk below the point
   * where names and scores stop being readable. Past that floor the bracket keeps its size and the
   * panel's own scroller takes over, which is the same bargain the group matrices strike.
   */
  const autoFit = useCallback(() => {
    const scroller = scrollerRef.current
    if (!scroller || !floorWidth) return
    const available = scroller.clientWidth
    if (!available) return
    setScale(fitScaleFor(available, floorWidth))
  }, [floorWidth])

  /**
   * Refit whenever the panel's width changes — a window resize, the sidebar, a zoom of the browser
   * itself. Observing the scroller rather than the window catches all of them.
   */
  useEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller) return
    autoFit()
    const ro = new ResizeObserver(autoFit)
    ro.observe(scroller)
    return () => ro.disconnect()
  }, [autoFit])

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
      className="dl-surface w-full overflow-hidden cyber-clip border border-border bg-card"
    >
      <header className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-2.5">
        <h2 className="text-[0.68rem] font-extrabold uppercase tracking-[0.18em] text-[var(--gold)]">
          Playoff Bracket
        </h2>
        <span className="text-[0.7rem] text-muted-foreground">
          {players} player{players === 1 ? '' : 's'} · {rounds.length} round{rounds.length === 1 ? '' : 's'}
        </span>
        {scale < 1 && (
          <span className="ml-auto text-[0.7rem] text-muted-foreground">
            Scaled to {Math.round(scale * 100)}% to fit
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
          className="bp-tree flex w-full min-w-min items-stretch"
          style={{
            ['--bp-card-w' as string]: `${metrics.cardW}px`,
            ['--bp-card-min' as string]: `${metrics.cardMin}px`,
            ['--bp-row-h' as string]: `${metrics.rowH}px`,
            ['--bp-match-gap' as string]: `${metrics.matchGap}px`,
            ['--bp-lane-gap' as string]: `${metrics.laneGap}px`,
            // `zoom` scales layout as well as text, so the connectors and cards stay aligned.
            ...(scale !== 1 ? { zoom: scale } : {}),
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
                <p className="bp-lane-head sticky top-0 z-20 whitespace-nowrap px-3 pb-3 pt-3 text-center text-[0.66rem] font-extrabold uppercase tracking-[0.14em] text-muted-foreground">
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
                          /* Gold traces the winner's path and nothing else; an undecided tie leaves
                             its connectors grey. */
                          (m.winner === 'a' || m.winner === 'b') && 'bp-path-won',
                          onActivePath ? 'bp-path-lit' : onChampPath ? 'bp-path-champ' : null,
                          activeKey != null && !onActivePath && 'bp-muted',
                        )}
                      >
                        <MatchCard match={m} activeKey={activeKey} championKey={championKey} />
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
          <span aria-hidden className="mt-[3px] flex size-3.5 shrink-0 items-center justify-center rounded-full border border-[var(--gold-dim)] text-[0.66rem] text-[var(--gold-dim)]">i</span>
          <span>{note}</span>
        </footer>
      )}
    </section>
  )
}

/* ---------------------------------------------------------------- an ordinary matchup */

function MatchCard({
  match, activeKey, championKey,
}: {
  match: BracketMatch
  activeKey: string | null
  /** Who won the Season, so their row alone can be marked as they advance. */
  championKey: string | null
}) {
  /*
   * The Final is the same card as every other tie.
   *
   * It used to carry a soft bloom behind it. That was an ornament doing a job the results already
   * do: a finished bracket carries an unbroken gold path into the Final, and the eye arrives there
   * without being shown where to look.
   */
  return (
    <BracketCard className="bp-card w-full">
      <SlotRow slot={match.a} won={match.winner === 'a'} activeKey={activeKey} championKey={championKey} />
      <BracketRowDivider />
      <SlotRow slot={match.b} won={match.winner === 'b'} activeKey={activeKey} championKey={championKey} />
    </BracketCard>
  )
}

function SlotRow({
  slot, won, activeKey, championKey = null,
}: {
  slot?: BracketSlot
  /**
   * A winner is marked by gold, never filled with it — a rail on the leading edge, a gold ID and a
   * gold score. Gold at low opacity over charcoal mixes to olive-brown rather than to a pale wash,
   * which is what the old highlight was.
   */
  won: boolean
  activeKey: string | null
  /** Retained so the champion's route stays addressable; the rail itself is now every winner's. */
  championKey?: string | null
}) {
  const state = slotState(slot)
  const k = keyOf(slot)
  const lit = k != null && activeKey === k

  if (state !== 'player') {
    return (
      <div
        className="flex items-center px-2.5 text-[0.78rem] italic text-[var(--bracket-text-muted)]"
        style={{ height: 'var(--bp-row-h)' }}
      >
        {state === 'bye' ? 'bye' : 'TBD'}
      </div>
    )
  }

  return (
    <BracketRow
      won={won}
      state={state}
      data-player={k ?? undefined}
      data-champion={k != null && championKey === k ? 'true' : undefined}
      tabIndex={0}
      role="button"
      aria-pressed={lit}
      /*
        The accessible name carries both halves too. A screen reader announcing only "Chris" in a
        bracket of two Chrises is the same failure as printing it, just less visible.
      */
      aria-label={`${identityText(fromNameHandle(slot))}${slot?.seed != null ? `, seed ${slot.seed}` : ''}${won ? ', winner' : ''}${slot?.score != null ? `, ${slot.score}` : ''}`}
      className={cn(
        'cursor-pointer gap-2.5 outline-none transition-colors',
        lit && 'bg-[var(--bracket-surface-raised)]',
        'focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--bracket-focus)]',
      )}
      style={{ height: 'var(--bp-row-h)' }}
    >
      <BracketSeed seed={slot?.seed} />
      <span className="min-w-0 flex-1">
        <BracketIdentity slot={slot} won={won} state={state} />
      </span>
      <BracketScore slot={slot} won={won} state={state} />
    </BracketRow>
  )
}

