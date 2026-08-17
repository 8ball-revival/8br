'use client'

import { useMemo, useState } from 'react'
import { Users } from 'lucide-react'

import { PublicPlayerIdentity } from '@/components/identity/public-player-identity'
import { matchesIdentity } from '@/lib/identity/display'

export interface EntrantListItem {
  name: string
  cueverseId?: string | null
  slug?: string | null
  /** Current Rankings (all-time Elo) rating; null = unrated (no ranked history yet). */
  rating?: number | null
}

/**
 * Public entrant list — renders each entrant as the shared `Preferred Name (CueVerse ID)`
 * public identity (linking to the profile when available). Never real email or raw Discord.
 * Used on tournament pages.
 */
export function EntrantList({
  entrants,
  collapsible = false,
  label = 'Entrants',
}: {
  entrants: EntrantListItem[]
  collapsible?: boolean
  label?: string
}) {
  const [q, setQ] = useState('')
  // Assign a stable 1-based entrant number from the full list order, then filter (the number is
  // preserved when searching, so "Entrant #" always refers to the same person).
  const numbered = useMemo(() => entrants.map((e, i) => ({ ...e, num: i + 1 })), [entrants])
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    // Search either half of the identity: typing a preferred name must still find a player whose
    // CueVerse ID is what the row leads with.
    return s ? numbered.filter((e) => matchesIdentity({ cueverseId: e.cueverseId, preferredName: e.name }, s)) : numbered
  }, [q, numbered])

  const body = (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search entrants…"
          className="w-full max-w-xs rounded-md border border-border bg-background px-3 py-1.5 text-sm"
        />
        <span className="text-xs text-muted-foreground">
          {filtered.length === entrants.length ? `${entrants.length} entrants` : `${filtered.length} of ${entrants.length}`}
        </span>
      </div>
      {filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground">No entrants match “{q}”.</p>
      ) : (
        // One long single-column list: Entrant # | Preferred Name + CueVerse ID | Rankings Rating.
        <div className="overflow-hidden rounded-md border border-border">
          <div className="flex items-center gap-3 border-b border-border bg-card/50 px-3 py-1.5 text-[0.65rem] uppercase tracking-wide text-muted-foreground">
            <span className="w-8 shrink-0 text-right">#</span>
            <span className="min-w-0 flex-1">Entrant</span>
            <span className="w-16 shrink-0 text-right">Rating</span>
          </div>
          <ul className="divide-y divide-border">
            {filtered.map((e) => (
              <li key={`${e.name}-${e.num}`} className="flex items-center gap-3 px-3 py-2 text-sm">
                <span className="tabular w-8 shrink-0 text-right text-xs text-muted-foreground">{e.num}</span>
                <span className="min-w-0 flex-1 truncate">
                  <PublicPlayerIdentity preferredName={e.name} cueverseId={e.cueverseId} slug={e.slug} muted />
                </span>
                <span className="tabular w-16 shrink-0 text-right font-semibold text-foreground">
                  {e.rating != null ? e.rating : <span className="font-normal text-muted-foreground">—</span>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  )

  if (collapsible) {
    return (
      <details className="mb-8 rounded-lg border border-border bg-card/30 p-4">
        <summary className="flex cursor-pointer items-center gap-2 text-sm font-medium text-foreground">
          <Users className="size-4 text-muted-foreground" /> {label} ({entrants.length})
        </summary>
        <div className="mt-4">{body}</div>
      </details>
    )
  }

  return (
    <section className="mb-8 rounded-lg border border-border bg-card/30 p-4">
      <h2 className="mb-3 flex items-center gap-2 font-display text-lg font-semibold">
        <Users className="size-5 text-brand" /> {label}
      </h2>
      {body}
    </section>
  )
}
