'use client'

import { useMemo, useState } from 'react'
import { Users } from 'lucide-react'

/**
 * Public Season entrant list — CueVerse IDs only (never real names, email or Discord).
 * Used on the Groups page: shown expanded before groups are drawn, and inside a
 * collapsible section afterward so the group tables stay the focus.
 */
export function EntrantList({
  entrants,
  collapsible = false,
}: {
  entrants: { name: string }[]
  collapsible?: boolean
}) {
  const [q, setQ] = useState('')
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    return s ? entrants.filter((e) => e.name.toLowerCase().includes(s)) : entrants
  }, [q, entrants])

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
        <ul className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-4">
          {filtered.map((e, i) => (
            <li key={`${e.name}-${i}`} className="truncate rounded-md border border-border bg-card/40 px-2.5 py-1.5 text-sm">
              {e.name}
            </li>
          ))}
        </ul>
      )}
    </>
  )

  if (collapsible) {
    return (
      <details className="mb-8 rounded-lg border border-border bg-card/30 p-4">
        <summary className="flex cursor-pointer items-center gap-2 text-sm font-medium text-foreground">
          <Users className="size-4 text-muted-foreground" /> Season 2 entrants ({entrants.length})
        </summary>
        <div className="mt-4">{body}</div>
      </details>
    )
  }

  return (
    <section className="mb-8 rounded-lg border border-border bg-card/30 p-4">
      <h2 className="mb-3 flex items-center gap-2 font-display text-lg font-semibold">
        <Users className="size-5 text-gold" /> Season 2 entrants
      </h2>
      {body}
    </section>
  )
}
