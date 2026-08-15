import Link from 'next/link'
import { Diamond } from 'lucide-react'

import type { SeasonSummary } from '@/lib/seasons/service'
import { SEASON_STATE_LABEL } from '@/lib/seasons/shared'

/**
 * Prestige Season card — deliberately grander than an ordinary Tournament card: fully-opaque charcoal
 * surface (no page texture showing through), a metallic-gold border with a brighter gold left edge, a
 * subtle gold hover glow, and the glowing diamond that matches the Season Champion achievement. No
 * bright-gold fill, no continuous animation.
 */
export function SeasonCard({ season }: { season: SeasonSummary }) {
  const phase = phaseLine(season)
  return (
    <Link
      href={`/seasons/${season.number}`}
      className="group relative block overflow-hidden rounded-xl border border-[#8a6d24] bg-[#0c0c0d] p-5 shadow-[0_0_0_1px_rgba(198,161,91,0.12)] transition-shadow hover:shadow-[0_0_22px_-4px_rgba(214,174,66,0.45)]"
    >
      {/* Brighter gold left edge. */}
      <span aria-hidden className="absolute inset-y-0 left-0 w-1 bg-gradient-to-b from-[#f0d283] via-[#d6ae42] to-[#8a6d24]" />

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-[0.6rem] font-bold uppercase tracking-[0.18em] text-[#d6ae42]">
            <Diamond className="size-3 shrink-0 fill-[#e6c463] text-[#e6c463] drop-shadow-[0_0_5px_rgba(230,196,99,0.8)]" aria-hidden />
            Season Championship
          </p>
          <h3 className="mt-2 truncate font-display text-xl font-bold text-[#f5f1e6]">
            {season.subtitle?.trim() || season.title}
          </h3>
          {season.subtitle?.trim() && (
            <p className="truncate text-sm font-semibold text-[#d6ae42]">{season.title}</p>
          )}
        </div>
        {!season.subtitle?.trim() && (
          <span className="shrink-0 rounded-full border border-[#8a6d24]/60 px-2.5 py-1 text-[0.65rem] font-semibold text-[#d6ae42]">
            #{season.number}
          </span>
        )}
      </div>

      {/* Subtle gold divider. */}
      <div aria-hidden className="my-4 h-px bg-gradient-to-r from-[#8a6d24]/70 via-[#8a6d24]/25 to-transparent" />

      {season.isCompleted ? (
        <dl className="space-y-1.5 text-sm">
          <Row k="Champion" v={season.championName ?? '—'} gold />
          <Row k="Runner-up" v={season.runnerUpName ?? '—'} />
          <Row k="Entrants" v={String(season.entrantsCount)} />
        </dl>
      ) : (
        <div className="flex items-center justify-between gap-3 text-sm">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-[#8a6d24]/50 bg-[#d6ae42]/[0.06] px-2.5 py-1 text-xs font-semibold text-[#e6c463]">
            <span className="size-1.5 rounded-full bg-[#e6c463]" /> {SEASON_STATE_LABEL[season.lifecycleState]}
          </span>
          <span className="text-muted-foreground">{phase}</span>
        </div>
      )}
    </Link>
  )
}

function Row({ k, v, gold }: { k: string; v: string; gold?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted-foreground">{k}</dt>
      <dd className={gold ? 'truncate font-semibold text-[#e6c463]' : 'truncate font-medium text-[#f5f1e6]'}>{v}</dd>
    </div>
  )
}

/** Phase-relevant one-liner for an active Season card. */
function phaseLine(s: SeasonSummary): string {
  switch (s.lifecycleState) {
    case 'REGISTRATION_SCHEDULED':
      return 'Registration opening soon'
    case 'REGISTRATION_OPEN':
    case 'REGISTRATION_CLOSED':
      return `${s.entrantsCount} entrant${s.entrantsCount === 1 ? '' : 's'}`
    case 'GROUP_SETUP':
    case 'GROUP_STAGE_LIVE':
    case 'GROUPS_CLOSED':
      return 'Group stage · Top 3 advance'
    case 'PLAYOFF_SETUP':
    case 'PLAYOFFS_LIVE':
      return 'Playoffs underway'
    default:
      return ''
  }
}
