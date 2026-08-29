'use client'

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Maximize2, Minimize2, Move, RotateCcw, Scan, ZoomIn, ZoomOut } from 'lucide-react'

import type { BracketMatch, BracketRound, BracketSlot } from '@/lib/tournaments/fixtures'
import { cn } from '@/lib/utils'

/**
 * The shared double-elimination bracket, for the public Season page and for Creator.
 *
 * ── What it is not allowed to do ─────────────────────────────────────────────────────────────────
 * Decide anything. It receives rounds from the bracket engine and draws them. It never works out a
 * winner, a score, a forfeit or who advances — including the `Loser of W12` labels and the codes
 * they point at, which arrive as data. A renderer that computes advancement becomes a second, silent
 * source of truth, and the two disagree the first time a correction is entered.
 *
 * ── Why the layout is expanded rather than compressed ────────────────────────────────────────────
 * Every round gets its own labelled column and every round-one position is drawn, byes included.
 * Collapsing the twelve byes would make the first column four cards wide and hide the fact that
 * three quarters of the field started a round later — which is exactly the thing a reader is trying
 * to see. The bracket is wider as a result, which is what the pan and zoom are for.
 *
 * ── Why feeds are labels, not lines ──────────────────────────────────────────────────────────────
 * A losers position is fed from the OTHER half of the bracket. Drawing that faithfully means a line
 * from the far left to the far right, across every other match, and twenty of them at once is a
 * cross-hatch nobody can read. Inside a half, where the connection is local, real connectors are
 * drawn; across halves the position says where its occupant came from and highlights that match when
 * you point at it.
 */

/** Card geometry. About 20% larger than the previous bracket, which was legible only when zoomed. */
const CARD_W = 300
const CARD_MIN_H = 74
const COL_GAP = 76
const ROW_GAP = 18

const ZOOM_MIN = 0.45
const ZOOM_MAX = 2
const ZOOM_STEP = 0.15
const STORAGE_KEY = '8br.bracket.zoom'

/**
 * The zoom this browser was last using, for THIS session only.
 *
 * Session rather than local storage on purpose: it is a viewing preference for the bracket in front
 * of you, not a setting, and it should not follow somebody into next week when the bracket has
 * changed underneath it. Returns 1 on the server and whenever storage is unavailable.
 */
function readStoredZoom(): number {
  if (typeof window === 'undefined') return 1
  try {
    const v = window.sessionStorage.getItem(STORAGE_KEY)
    const n = v ? Number(v) : NaN
    return Number.isFinite(n) ? Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, n)) : 1
  } catch {
    return 1
  }
}

export interface DoubleElimBracketProps {
  rounds: BracketRound[]
  note?: string | null
  champion?: string | null
  /** Creator passes an editable card; the public page passes nothing and gets the read-only one. */
  renderCard?: (match: BracketMatch, ctx: { round: BracketRound; roundIndex: number }) => React.ReactNode
  className?: string
}

const isBye = (s?: BracketSlot) => s?.name === 'Bye'
const isTbd = (s?: BracketSlot) => !s || (!s.name && s.score == null)

export function DoubleElimBracket({ rounds, note, champion, renderCard, className }: DoubleElimBracketProps) {
  const wb = rounds.filter((r) => r.section === 'WB' || r.section == null)
  const lb = rounds.filter((r) => r.section === 'LB')
  const gf = rounds.filter((r) => r.section === 'GF')
  const mirrored = lb.length > 0

  /*
   * Read once, during the first render, rather than set from an effect.
   *
   * Restoring it in an effect means rendering at 100% and then immediately re-rendering at the
   * stored zoom -- a cascading render, and a visible jump on every page load. On the server there is
   * no sessionStorage, so that render is always 100% and the canvas is marked
   * `suppressHydrationWarning`: the difference is intended, and it is one attribute on one element.
   */
  const [zoom, setZoom] = useState(readStoredZoom)
  const [highlight, setHighlight] = useState<string | null>(null)
  const [full, setFull] = useState(false)
  const viewportRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLDivElement>(null)
  const shellRef = useRef<HTMLDivElement>(null)
  const labelId = useId()

  /*
   * ── Why zoom is a layout scale and not a transform ───────────────────────────────────────────
   *
   * `transform: scale()` leaves the layout box alone, so a zoomed bracket either overlaps whatever
   * follows it or needs a JS-measured spacer to hold the space — and a spacer is only as reliable as
   * its measurement. Measured while the panel was hidden it comes back zero, and the section then
   * collapses and renders an empty box, which is exactly what happened here.
   *
   * `--dxb-scale` multiplies the real card widths, gaps and font sizes instead, so the browser lays
   * the bracket out at its actual size. The section is therefore always exactly as tall as the
   * bracket it draws, at any zoom, with nothing to measure and nothing to keep in sync.
   */

  useEffect(() => {
    try { sessionStorage.setItem(STORAGE_KEY, String(zoom)) } catch { /* ignore */ }
  }, [zoom])

  const clamp = (z: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(z * 100) / 100))

  /**
   * Fit the whole bracket WIDTH, connectors and padding included.
   *
   * Width only. The section is as tall as the bracket and the page scrolls to reach the rest of it,
   * so fitting the height would shrink a perfectly readable bracket to solve a problem that no
   * longer exists.
   */
  const fit = useCallback(() => {
    const vp = viewportRef.current
    const cv = canvasRef.current
    if (!vp || !cv) return
    const w = cv.offsetWidth
    if (!w) return
    // The canvas is already laid out at the current scale, so the new one is relative to it.
    setZoom((z) => clamp(z * (vp.clientWidth - 24) / w))
    vp.scrollTo({ left: 0 })
  }, [])

  // Drag to pan, on the background only, so a drag that starts on a card still selects text.
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null)
  const onPointerDown = (e: React.PointerEvent) => {
    const vp = viewportRef.current
    if (!vp) return
    if ((e.target as HTMLElement).closest('a,button,input,[data-no-pan]')) return
    drag.current = { x: e.clientX, y: e.clientY, left: vp.scrollLeft, top: vp.scrollTop }
    vp.setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const vp = viewportRef.current
    if (!vp || !drag.current) return
    vp.scrollLeft = drag.current.left - (e.clientX - drag.current.x)
    vp.scrollTop = drag.current.top - (e.clientY - drag.current.y)
  }
  const endDrag = (e: React.PointerEvent) => {
    drag.current = null
    viewportRef.current?.releasePointerCapture(e.pointerId)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && full) setFull(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [full])


  if (!rounds.length) return null

  const Controls = (
    <div className="flex flex-wrap items-center gap-1.5" data-no-pan>
      <ToolButton label="Zoom out" onClick={() => setZoom((z) => clamp(z - ZOOM_STEP))}><ZoomOut className="size-4" /></ToolButton>
      <span className="tabular w-12 text-center text-[0.7rem] text-muted-foreground">{Math.round(zoom * 100)}%</span>
      <ToolButton label="Zoom in" onClick={() => setZoom((z) => clamp(z + ZOOM_STEP))}><ZoomIn className="size-4" /></ToolButton>
      <ToolButton label="Reset zoom" onClick={() => { setZoom(1); viewportRef.current?.scrollTo({ left: 0, top: 0 }) }}><RotateCcw className="size-4" /></ToolButton>
      <ToolButton label="Fit bracket" onClick={fit}><Scan className="size-4" /></ToolButton>
      <ToolButton label={full ? 'Exit full screen' : 'Full screen'} onClick={() => setFull((f) => !f)}>
        {full ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
      </ToolButton>
    </div>
  )

  const section = (rs: BracketRound[], heading: string, reversed = false) => {
    if (!rs.length) return null
    const cols = reversed ? [...rs].reverse() : rs
    return (
      <div className={cn('dxb-section', reversed && 'dxb-section--mirrored')}>
        <p className="dxb-heading">{heading}</p>
        <div className="dxb-cols">
          {cols.map((r, i) => {
            // In a mirrored section the columns are drawn right to left, so "the next round" is the
            // one BEFORE this in display order. The connector still has to point inward either way.
            const nextInPlay = reversed ? cols[i - 1] : cols[i + 1]
            return (
              <div key={`${r.name}-${i}`} className="dxb-col">
                <p className="dxb-col-head">{r.name}</p>
                <div className="dxb-cells">
                  {r.matches.map((m, j) => (
                    <div
                      key={m.id ?? j}
                      className={cn('dxb-cell', connectorClass(r.matches.length, nextInPlay?.matches.length, j))}
                    >
                      {renderCard
                        ? renderCard(m, { round: r, roundIndex: i })
                        : <ReadOnlyCard match={m} highlight={highlight} setHighlight={setHighlight} labelId={labelId} />}
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  const body = (
    <>
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-2.5">
        <h2 className="text-[0.68rem] font-extrabold uppercase tracking-[0.18em] text-[var(--gold)]">Playoff Bracket</h2>
        {champion && <span className="text-[0.72rem] text-muted-foreground">Champion <span className="font-semibold text-[var(--gold)]">{champion}</span></span>}
        <span className="ml-auto hidden items-center gap-1.5 text-[0.65rem] text-muted-foreground sm:flex">
          <Move className="size-3.5" aria-hidden /> drag to pan
        </span>
        {Controls}
      </div>

      <div
        ref={viewportRef}
        className="dxb-viewport scrollbar-themed"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <div
          ref={canvasRef}
          className={cn('dxb-canvas', mirrored && 'dxb-canvas--mirrored')}
          style={{ '--dxb-scale': zoom } as React.CSSProperties}
          suppressHydrationWarning
        >
          {section(wb, 'Winners Bracket')}
          {gf.length > 0 && (
            <div className="dxb-section dxb-section--final">
              <p className="dxb-heading dxb-heading--final">Grand Final</p>
              <div className="dxb-cols">
                {gf.map((r, i) => (
                  <div key={`gf-${i}`} className="dxb-col">
                    <p className="dxb-col-head">{r.name}</p>
                    <div className="dxb-cells">
                      {r.matches.map((m, j) => (
                        <div key={m.id ?? j} className="dxb-cell">
                          {renderCard
                            ? renderCard(m, { round: r, roundIndex: i })
                            : <ReadOnlyCard match={m} highlight={highlight} setHighlight={setHighlight} labelId={labelId} />}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {section(lb, 'Losers Bracket', true)}
        </div>
      </div>

      {note && (
        <footer className="border-t border-border px-4 py-2.5 text-[0.72rem] leading-relaxed text-muted-foreground">{note}</footer>
      )}
    </>
  )

  return (
    <div
      ref={shellRef}
      className={cn(
        'dl-surface cyber-clip border border-border bg-card',
        full ? 'dxb-fullscreen' : 'w-full overflow-hidden',
        className,
      )}
    >
      {body}
    </div>
  )
}

function ToolButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="grid size-7 place-items-center rounded border border-border text-muted-foreground transition-colors hover:border-[var(--gold)]/50 hover:text-[var(--gold)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
    >
      {children}
    </button>
  )
}

/**
 * Which connector this cell draws toward the next column.
 *
 * Two shapes cover every round in a double-elimination bracket: a round that feeds one of the same
 * size connects straight across, and a round that feeds one half its size joins its cells in pairs.
 * Anything else draws nothing rather than a line that would assert a pairing the bracket may not
 * have — the engine, not this file, knows how the rounds are wired.
 */
export function connectorClass(count: number, nextCount: number | undefined, index: number): string | undefined {
  if (!nextCount) return undefined
  if (nextCount === count) return 'dxb-cell--straight'
  if (nextCount * 2 === count) return index % 2 === 0 ? 'dxb-cell--join-down' : 'dxb-cell--join-up'
  return undefined
}

function ReadOnlyCard({
  match, highlight, setHighlight, labelId,
}: {
  match: BracketMatch
  highlight: string | null
  setHighlight: (c: string | null) => void
  labelId: string
}) {
  const decided = match.winner != null
  const lit = match.code != null && highlight === match.code
  return (
    <div
      className={cn('dxb-card', decided && 'dxb-card--done', lit && 'dxb-card--lit')}
      data-match-code={match.code}
      aria-describedby={lit ? labelId : undefined}
    >
      {match.code && <span className="dxb-code">{match.code}</span>}
      <SlotLine slot={match.a} won={match.winner === 'a'} decided={decided} source={match.sourceA} setHighlight={setHighlight} />
      <SlotLine slot={match.b} won={match.winner === 'b'} decided={decided} source={match.sourceB} setHighlight={setHighlight} />
    </div>
  )
}

function SlotLine({
  slot, won, decided, source, setHighlight,
}: {
  slot?: BracketSlot
  won: boolean
  decided: boolean
  source?: { label: string; code: string }
  setHighlight: (c: string | null) => void
}) {
  const bye = isBye(slot)
  const tbd = isTbd(slot)

  return (
    <div className={cn('dxb-slot', won && 'dxb-slot--won', bye && 'dxb-slot--bye', tbd && 'dxb-slot--tbd')}>
      <span className="dxb-seed">{slot?.seed ?? ''}</span>
      <span className="dxb-name">
        {bye ? 'Bye' : slot?.name ?? (
          /*
           * An empty position says where its occupant will come FROM rather than just "TBD", and
           * points at that match when you hover it. This is the whole reason the bracket does not
           * need a line drawn from one half of the screen to the other.
           */
          source
            ? (
              <button
                type="button"
                data-no-pan
                className="dxb-source"
                onMouseEnter={() => setHighlight(source.code)}
                onMouseLeave={() => setHighlight(null)}
                onFocus={() => setHighlight(source.code)}
                onBlur={() => setHighlight(null)}
                onClick={() => setHighlight(source.code)}
              >
                {source.label}
              </button>
            )
            : 'TBD'
        )}
      </span>
      {slot?.forfeit
        ? <span className="dxb-score dxb-score--ff">FF</span>
        : <span className="dxb-score">{slot?.score ?? (decided ? '' : '')}</span>}
    </div>
  )
}

export const BRACKET_GEOMETRY = { CARD_W, CARD_MIN_H, COL_GAP, ROW_GAP, ZOOM_MIN, ZOOM_MAX }
