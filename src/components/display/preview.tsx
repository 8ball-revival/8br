'use client'

import { useEffect, useRef } from 'react'

import { applyDisplay, type DisplaySettings } from '@/lib/display/settings'
import { cn } from '@/lib/utils'

/**
 * The live preview: the real rendering of a setting, at a size that fits in a drawer.
 *
 * ── Why this is not a mock-up ────────────────────────────────────────────────────────────────────
 * The container carries `data-dl-scope` and has the draft settings written onto it by the SAME
 * function that writes them to <html>. Every rule in display.css is an attribute selector, so all of
 * them match here too — the frame, the corner geometry, the texture, the interior light, the
 * background and the effects are the actual ones, evaluated by the browser at this element. There is
 * no second implementation to keep in step, and nothing a reader sees here can turn out to mean
 * something different once saved.
 *
 * ── Why the content is Competition History ───────────────────────────────────────────────────────
 * It is the panel a visitor meets first, and it is the hardest case: an accent ground carrying dark
 * ink, a red call to action, technical corner marks and a bordered column of links. A treatment that
 * works here works on the graphite panels; the reverse is not true. `.dl-on-light` tells the texture
 * layer to draw in ink rather than white, which is the one thing an accent-ground panel needs.
 */
export function DisplayPreview({ settings, mode }: {
  settings: DisplaySettings
  mode: 'panel' | 'page'
}) {
  const scope = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (scope.current) applyDisplay(scope.current, settings)
  }, [settings])

  return (
    <div
      ref={scope}
      data-dl-scope
      className="relative isolate overflow-hidden border border-[var(--line)] bg-[var(--void)] p-3"
    >
      {/*
        The preview's own decorative layers, confined to this box. `dl-layer-inset` swaps the fixed
        positioning for absolute; everything else about them is identical to the page's.
      */}
      <div className="dl-bg-layer dl-layer-inset" aria-hidden>
        <div className="dl-bg-image" />
        <div className="dl-bg-scrim" />
      </div>
      <div className="dl-grain-layer dl-layer-inset" aria-hidden />
      <div className="dl-vignette-layer dl-layer-inset" aria-hidden />

      <div className="relative z-[1] space-y-2">
        {/* The accent-ground feature panel, in miniature and with real type. */}
        <div className="dl-surface dl-on-light cyber-clip grid gap-3 border-[var(--acid-dim)] bg-[var(--acid)] p-3 text-[var(--acid-ink)] sm:grid-cols-[minmax(0,60fr)_minmax(0,40fr)]">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-[0.55rem] font-bold uppercase tracking-[0.16em] text-[var(--acid-ink)]/70">
              Welcome to 8 Ball Registry
              <span aria-hidden className="text-[var(--hot-red)]">{'//'}</span>
            </p>
            <p className="mt-1.5 font-display text-xl font-bold uppercase leading-[0.95] tracking-tight">
              Competition
              <br />
              History
            </p>
            <p className="mt-2 text-[0.7rem] font-semibold leading-snug">
              Explore seasons, tournaments, champions, and results.
            </p>
            <span className="cyber-clip-sm mt-3 inline-flex bg-[var(--hot-red)] px-3 py-1.5 text-[0.6rem] font-bold uppercase tracking-[0.12em] text-[var(--clean-white)]">
              Rankings
            </span>
          </div>
          <div className="min-w-0 border-t border-[var(--acid-ink)]/25 pt-2 sm:border-l sm:border-t-0 sm:pl-3 sm:pt-0">
            <p className="text-[0.55rem] font-bold uppercase tracking-[0.16em] text-[var(--acid-ink)]/70">Latest News</p>
            <ul className="mt-2 space-y-1.5">
              {['Season 9 groups are drawn', 'Playoff bracket published'].map((t) => (
                <li key={t} className="flex gap-1.5 border-b border-[var(--acid-ink)]/15 pb-1.5 last:border-b-0 last:pb-0">
                  <span aria-hidden className="mt-[0.35rem] size-1 shrink-0 rounded-full bg-[var(--hot-red)]" />
                  <span className="text-[0.68rem] font-semibold leading-snug">{t}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/*
          A graphite panel beside it, because most of the site is graphite.

          Judging a frame on the accent panel alone is judging it on the one surface that is not
          representative — and the dense row inside carries `.dl-quiet`, which is the restraint
          promised for tables: whatever the frame is doing to panels, it is not doing it to rows.
        */}
        <div className="dl-surface cyber-clip bg-[var(--card)] p-3">
          <p className="text-[0.55rem] font-bold uppercase tracking-[0.16em] text-muted-foreground">Live Rankings</p>
          <ul className="mt-2 space-y-1">
            {[['1', 'DEV_CutShotCarla', '1842'], ['2', 'DEV_RailRunner', '1790']].map(([rank, name, rating]) => (
              <li key={rank} className="dl-quiet flex items-center gap-2 border border-[var(--line)] px-2 py-1 text-[0.7rem]">
                <span className="tabular w-4 text-muted-foreground">{rank}</span>
                <span className="min-w-0 flex-1 truncate text-[var(--cyan)]">{name}</span>
                <span className="tabular font-semibold text-[var(--tier-gold)]">{rating}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {mode === 'page' && (
        <p className={cn(
          'relative z-[1] mt-2 border border-dashed border-[var(--acid)]/50 px-2 py-1.5',
          'text-[0.62rem] font-semibold uppercase tracking-wider text-[var(--acid)]',
        )}>
          Previewing the whole page — scroll behind this panel to see it
        </p>
      )}
    </div>
  )
}
