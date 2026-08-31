'use client'

import { RotateCcw } from 'lucide-react'

import { cn } from '@/lib/utils'
import { BADGES, DESCRIPTION_MAX, badgeByKey } from '@/lib/competition/flair'

export interface FlairValue {
  description: string | null
  badge: string | null
}

export const EMPTY_FLAIR: FlairValue = { description: null, badge: null }

const input = 'w-full rounded-none border border-input bg-card px-3 py-2 text-sm text-foreground outline-none focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/25'

/** Controlled editor for a tournament's curated flair (badge + description). Shared by the create
 *  form and the manage page. Per-tournament colors were removed — theming is a personal account
 *  preference now (see the Theme option in the account menu). */
export function FlairEditor({ value, onChange }: { value: FlairValue; onChange: (v: FlairValue) => void }) {
  const set = (patch: Partial<FlairValue>) => onChange({ ...value, ...patch })

  return (
    <div className="space-y-5">
      {/* Badge */}
      <div>
        <label className="mb-1.5 block text-[0.8rem] font-semibold text-foreground">Badge <span className="font-normal text-muted-foreground/60">(optional)</span></label>
        <div className="flex flex-wrap gap-1.5">
          <button type="button" onClick={() => set({ badge: null })} aria-pressed={!value.badge} className={cn('rounded-md border px-3 py-1.5 text-xs font-medium', !value.badge ? 'border-brand bg-[var(--selected-surface)] text-brand' : 'border-border bg-card text-muted-foreground hover:text-foreground')}>None</button>
          {BADGES.map((b) => (
            <button key={b.key} type="button" onClick={() => set({ badge: b.key })} aria-pressed={value.badge === b.key} title={b.label}
              className={cn('rounded-md border px-2.5 py-1.5 text-base leading-none', value.badge === b.key ? 'border-brand bg-[var(--selected-surface)]' : 'border-border bg-card hover:border-border/70')}>
              <span aria-hidden>{b.emoji}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Description */}
      <div>
        <label className="mb-1.5 block text-[0.8rem] font-semibold text-foreground">Description / announcement <span className="font-normal text-muted-foreground/60">(optional)</span></label>
        <textarea value={value.description ?? ''} onChange={(e) => set({ description: e.target.value || null })} maxLength={DESCRIPTION_MAX} rows={3} placeholder="A short note shown on the Tournament page — plain text." className={cn(input, 'resize-y')} />
        <p className="mt-1 text-right text-[0.7rem] text-muted-foreground/60">{(value.description ?? '').length}/{DESCRIPTION_MAX}</p>
      </div>

      <button type="button" onClick={() => onChange({ ...EMPTY_FLAIR })} className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground">
        <RotateCcw className="size-3.5" /> Clear
      </button>
    </div>
  )
}

/** Live preview of how the tournament header will look with the chosen flair. */
export function FlairPreview({ value, name }: { value: FlairValue; name: string }) {
  const badge = badgeByKey(value.badge)
  return (
    <div className="overflow-hidden rounded-none border border-border bg-background">
      <div className="h-2 bg-brand" />
      <div className="p-4">
        <div className="flex items-center gap-2">
          {badge && <span className="text-lg" aria-hidden>{badge.emoji}</span>}
          <span className="text-[0.66rem] font-semibold uppercase tracking-[0.16em] text-brand">Tournament</span>
        </div>
        <h4 className="mt-1 text-lg font-bold tracking-tight text-foreground">{name.trim() || 'Untitled Tournament'}</h4>
        {value.description && <p className="mt-1.5 whitespace-pre-wrap text-xs text-muted-foreground">{value.description}</p>}
        <div className="mt-3 flex items-center gap-2">
          <span className="cyber-clip-sm bg-brand px-2.5 py-1 text-[0.65rem] font-semibold text-primary-foreground">Registration Open</span>
          <span className="rounded-md border border-brand px-2.5 py-1 text-[0.65rem] font-semibold text-brand">Register</span>
        </div>
      </div>
    </div>
  )
}
