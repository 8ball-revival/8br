import Link from 'next/link'
import { CompetitionBadge } from '@/components/competitions/competition-badge'
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
      className="group relative block overflow-hidden rounded-xl border border-[var(--gold-dim)] bg-card p-5 shadow-[0_0_0_1px_color-mix(in_oklch,var(--gold)_12%,transparent)] transition-shadow hover:shadow-[0_0_22px_-4px_color-mix(in_oklch,var(--gold)_45%,transparent)]"
    >
      {/* Brighter gold left edge. */}
      <span aria-hidden className="absolute inset-y-0 left-0 w-1 bg-gradient-to-b from-[var(--gold-soft)] via-[var(--gold)] to-[var(--gold-dim)]" />

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-[0.6rem] font-bold uppercase tracking-[0.18em] text-[var(--gold)]">
            <Diamond className="size-3 shrink-0 fill-[var(--gold-soft)] text-[var(--gold-soft)] drop-shadow-[0_0_5px_rgba(230,196,99,0.8)]" aria-hidden />
            Season Championship
          </p>
          <h3 className="mt-2 flex items-center gap-2 font-display text-xl font-bold text-foreground">
            <CompetitionBadge
              name={season.competition.name}
              shortName={season.competition.shortName}
              iconMediaId={season.competition.iconMediaId}
              size={20}
            />
            <span className="truncate">{season.subtitle?.trim() || season.title}</span>
          </h3>
          {season.subtitle?.trim() && (
            <p className="truncate text-sm font-semibold text-[var(--gold)]">{season.title}</p>
          )}
        </div>
        {!season.subtitle?.trim() && (
          <span className="shrink-0 rounded-full border border-[var(--gold-dim)]/60 px-2.5 py-1 text-[0.65rem] font-semibold text-[var(--gold)]">
            #{season.number}
          </span>
        )}
      </div>

      {/* Subtle gold divider. */}
      <div aria-hidden className="my-4 h-px bg-gradient-to-r from-[var(--gold-dim)]/70 via-[var(--gold-dim)]/25 to-transparent" />

      {season.isCompleted ? (
        <dl className="space-y-1.5 text-sm">
          <Row k="Champion" v={season.championName ?? '—'} gold />
          <Row k="Runner-up" v={season.runnerUpName ?? '—'} />
          <Row k="Entrants" v={String(season.entrantsCount)} />
        </dl>
      ) : (
        <div className="flex items-center justify-between gap-3 text-sm">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--gold-dim)]/50 bg-[var(--gold)]/[0.06] px-2.5 py-1 text-xs font-semibold text-[var(--gold-soft)]">
            <span className="size-1.5 rounded-full bg-[var(--gold-soft)]" /> {SEASON_STATE_LABEL[season.lifecycleState]}
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
      <dd className={gold ? 'truncate font-semibold text-[var(--gold-soft)]' : 'truncate font-medium text-foreground'}>{v}</dd>
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
