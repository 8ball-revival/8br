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

/**
 * Card geometry. A bigger field gets narrower cards and tighter gutters so more rounds fit.
 *
 * `cardMin`/`cardW` are a RANGE, not a fixed size: the lanes share out whatever width the panel has,
 * so a card grows and shrinks with the window while the type stays the size it was. Shrinking the
 * card is what keeps a bracket on screen; shrinking the words is a last resort, and that is what the
 * scale below the minimum is for.
 */
interface Metrics { cardW: number; cardMin: number; rowH: number; matchGap: number; laneGap: number }
const WIDE: Metrics = { cardW: 278, cardMin: 190, rowH: 38, matchGap: 10, laneGap: 24 }
const TIGHT: Metrics = { cardW: 254, cardMin: 176, rowH: 36, matchGap: 8, laneGap: 20 }
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
  const lane = m.cardW + m.laneGap
  const finalLane = Math.round(m.cardW * 1.06) + m.laneGap
  return (roundCount - 1) * lane + finalLane
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
      className="w-full overflow-hidden rounded-2xl border border-border bg-card"
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
                          <FinalBlock match={m} activeKey={activeKey} championKey={championKey} />
                        ) : (
                          <MatchCard match={m} activeKey={activeKey} championKey={championKey} />
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
  match, activeKey, championKey,
}: {
  match: BracketMatch
  activeKey: string | null
  /** Who won the Season, so their row alone can be marked as they advance. */
  championKey: string | null
}) {
  return (
    <div
      className="bp-card w-full overflow-hidden rounded-lg border border-border bg-card"
    >
      <SlotRow slot={match.a} won={match.winner === 'a'} lost={match.winner === 'b'} activeKey={activeKey} championKey={championKey} />
      <div className="h-px bg-border" />
      <SlotRow slot={match.b} won={match.winner === 'b'} lost={match.winner === 'a'} activeKey={activeKey} championKey={championKey} />
    </div>
  )
}

function SlotRow({
  slot, won, lost, activeKey, championKey = null, large = false,
}: {
  slot?: BracketSlot
  won: boolean
  lost: boolean
  activeKey: string | null
  /** When this row holds the champion, it carries the gold edge — the opponent's does not. */
  championKey?: string | null
  large?: boolean
}) {
  const lines = identityLines(fromNameHandle(slot))
  const isPlayer = !!slot?.name && slot.name !== 'Bye'
  const k = keyOf(slot)
  const lit = k != null && activeKey === k
  // A thin gold rule down the left of the champion's row, the same edge the group tables use to mark
  // a qualifier. It traces their route through the bracket without boxing in the player they beat.
  const isChampion = k != null && championKey === k

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
        isChampion && 'bp-champion-row',
        'focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--gold)]/60',
      )}
      style={{ height: large ? 'calc(var(--bp-row-h) * 1.5)' : 'var(--bp-row-h)' }}
    >
      <SeedBadge seed={slot?.seed} large={large} />
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
function SeedBadge({ seed, large }: { seed?: number; large?: boolean }) {
  // Plain numerals, one colour, no enclosure. The width is still reserved when a slot has no seed —
  // a bye, or an undecided tie — so names stay aligned down the column either way.
  const size = large ? 'w-6 text-[0.68rem]' : 'w-[19px] text-[0.58rem]'
  if (seed == null) return <span className={cn('shrink-0', size)} aria-hidden />
  return (
    <span
      aria-hidden
      className={cn('tabular shrink-0 text-center font-bold leading-none text-foreground', size)}
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
  match, activeKey, championKey,
}: {
  match: BracketMatch
  activeKey: string | null
  /** Carried through so the champion's gold edge runs to the last round, not just up to it. */
  championKey: string | null
}) {
  return (
    <div className="flex w-full flex-col items-center">
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

      {/* Neutral border, like every other card: the gold marks the CHAMPION'S row, not the tie, so
          the player they beat is not framed in it too. The trophy, the title and the soft bloom
          behind the card carry the occasion instead. */}
      <div className="bp-final w-full overflow-hidden rounded-xl border border-border bg-card">
        <SlotRow slot={match.a} won={match.winner === 'a'} lost={match.winner === 'b'} activeKey={activeKey} championKey={championKey} large />
        <div className="h-px bg-border" />
        <SlotRow slot={match.b} won={match.winner === 'b'} lost={match.winner === 'a'} activeKey={activeKey} championKey={championKey} large />
      </div>
    </div>
  )
}
