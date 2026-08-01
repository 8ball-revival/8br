import { ShieldCheck, ShieldQuestion, ShieldAlert } from 'lucide-react'

import { cn } from '@/lib/utils'
import type { ChampionshipConfidence } from '@/lib/preview-players'

type Tone = 'success' | 'muted' | 'caution'

const CONFIG: Record<
  ChampionshipConfidence,
  { label: string; tone: Tone; explanation: string; Icon: typeof ShieldCheck }
> = {
  explicit: {
    label: 'Archive verified',
    tone: 'success',
    explanation: 'Recorded directly in the archive source.',
    Icon: ShieldCheck,
  },
  heuristic: {
    label: 'Heuristic',
    tone: 'muted',
    explanation: 'Inferred from surrounding archive data with high confidence.',
    Icon: ShieldQuestion,
  },
  reconstructed: {
    label: 'Reconstructed',
    tone: 'muted',
    explanation: 'Rebuilt from partial archive data; awaiting source confirmation.',
    Icon: ShieldQuestion,
  },
  unknown: {
    label: 'Limited source data',
    tone: 'caution',
    explanation: 'The archive lacks enough detail to fully confirm this result.',
    Icon: ShieldAlert,
  },
}

const TONE: Record<Tone, string> = {
  success: 'border-success/30 bg-success/10 text-success',
  muted: 'border-border bg-muted text-muted-foreground',
  // Low confidence stays on-brand (gold), not alarming red — it's uncertainty, not error.
  caution: 'border-gold/30 bg-gold/10 text-gold',
}

/**
 * Source-confidence pill with a keyboard-accessible, CSS-only tooltip. The label
 * never hides uncertainty; the tooltip (shown on hover AND focus) explains it.
 */
export function VerificationBadge({ confidence }: { confidence: ChampionshipConfidence }) {
  const c = CONFIG[confidence] ?? CONFIG.unknown
  const { Icon } = c
  return (
    <span className="group relative inline-flex">
      <span
        tabIndex={0}
        aria-label={`${c.label}. ${c.explanation}`}
        className={cn(
          'inline-flex cursor-help items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap outline-none focus-visible:ring-2 focus-visible:ring-ring',
          TONE[c.tone],
        )}
      >
        <Icon className="size-3" aria-hidden /> {c.label}
      </span>
      <span
        role="tooltip"
        className="pointer-events-none absolute top-full left-0 z-30 mt-1.5 w-52 rounded-md border border-border bg-card p-2 text-xs leading-snug text-muted-foreground opacity-0 shadow-md transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100 motion-reduce:transition-none"
      >
        {c.explanation}
      </span>
    </span>
  )
}
