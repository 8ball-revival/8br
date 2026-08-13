'use client'

import type { CSSProperties } from 'react'
import type { ThemeVars } from '@/lib/theme/theme'

/**
 * A scoped, self-contained sample of the site under a candidate theme. The derived CSS variables are
 * applied to this wrapper only, so descendants that use the token classes (bg-card, text-foreground,
 * bg-primary…) render exactly what the whole site will look like — without touching the rest of the
 * page. Shows navigation, a card, text, a button, a form field, a table row, and a small bracket.
 */
export function ThemePreview({ vars }: { vars: ThemeVars }) {
  return (
    <div
      style={vars as CSSProperties}
      className="overflow-hidden rounded-lg border border-border bg-background text-foreground"
      aria-label="Theme preview"
    >
      {/* Navigation */}
      <div className="flex items-center justify-between border-b border-nav-border bg-nav-bg px-3 py-2 text-nav-foreground">
        <span className="text-sm font-bold">WCC</span>
        <div className="flex items-center gap-3 text-xs">
          <span className="font-semibold text-brand">Tournaments</span>
          <span className="opacity-70">Rankings</span>
          <span className="opacity-70">Rules</span>
        </div>
      </div>

      <div className="grid gap-3 p-3 sm:grid-cols-2">
        {/* Card + text + button + form */}
        <div className="rounded-lg border border-border bg-card p-3 text-card-foreground">
          <p className="text-sm font-semibold">Card heading</p>
          <p className="mt-1 text-xs">Body text on a raised surface.</p>
          <p className="text-xs text-muted-foreground">Muted secondary text.</p>
          <a href="#preview" onClick={(e) => e.preventDefault()} className="text-xs text-brand underline">A link</a>
          <div className="mt-2 flex items-center gap-2">
            <span className="rounded-md bg-primary px-2.5 py-1 text-xs font-semibold text-primary-foreground">Primary</span>
            <span className="rounded-md border border-input px-2.5 py-1 text-xs">Outline</span>
          </div>
          <input
            readOnly
            value="Form field"
            aria-label="Sample form field"
            className="mt-2 w-full rounded-md border border-input bg-surface px-2 py-1 text-xs text-foreground"
          />
        </div>

        {/* Table + small bracket */}
        <div className="space-y-3">
          <div className="overflow-hidden rounded-lg border border-border">
            <div className="flex items-center justify-between bg-muted px-3 py-1.5 text-[0.65rem] font-medium uppercase tracking-wide text-muted-foreground">
              <span>Player</span><span>Rating</span>
            </div>
            <div className="flex items-center justify-between border-t border-border px-3 py-1.5 text-xs">
              <span>ProCue</span><span className="tabular-nums">1842</span>
            </div>
            <div className="flex items-center justify-between border-t border-border bg-surface px-3 py-1.5 text-xs">
              <span>RailRunner</span><span className="tabular-nums">1790</span>
            </div>
          </div>

          <div className="rounded-lg border border-border bg-card p-2">
            <div className="flex items-center gap-2 text-xs">
              <div className="flex-1 space-y-1">
                <div className="flex items-center justify-between rounded bg-win/[0.08] px-2 py-1 font-semibold text-win">
                  <span>Alpha</span><span className="tabular-nums">5</span>
                </div>
                <div className="flex items-center justify-between rounded px-2 py-1 text-muted-foreground">
                  <span>Bravo</span><span className="tabular-nums">3</span>
                </div>
              </div>
              <div className="h-px w-4 bg-brand/60" aria-hidden />
              <div className="rounded bg-win/[0.08] px-2 py-1 font-semibold text-win">Alpha</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
