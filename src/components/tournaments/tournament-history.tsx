import type { TournamentHistoryEvent } from '@/lib/competition/tournament-lifecycle'

const DOT: Record<string, string> = {
  created: 'bg-muted-foreground',
  registration_open: 'bg-success',
  registration_closed: 'bg-amber-500',
  bracket_generated: 'bg-sky-500',
  bracket_regenerated: 'bg-sky-500',
  tournament_started: 'bg-destructive',
  match_result: 'bg-muted-foreground',
  entrant_added: 'bg-muted-foreground',
  entrant_removed: 'bg-muted-foreground',
  ladder_applied: 'bg-brand',
  tournament_completed: 'bg-brand',
  tournament_cancelled: 'bg-muted-foreground',
  recovery: 'bg-destructive',
  other: 'bg-muted-foreground',
}

function fmt(iso: string): string {
  // Deterministic, locale-agnostic YYYY-MM-DD HH:mm (UTC) — no client/server drift.
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())} UTC`
}

/**
 * Chronological cup history derived from the audit log. Admins pass `admin` to see the fuller
 * version (actor + reason); public callers get the simplified, non-sensitive projection. The events
 * are already filtered/redacted server-side by getTournamentHistory — this only renders them.
 */
export function TournamentHistory({ events, admin = false }: { events: TournamentHistoryEvent[]; admin?: boolean }) {
  if (!events.length) return <p className="text-sm text-muted-foreground">No history recorded yet.</p>
  // Most recent first for display.
  const ordered = [...events].reverse()
  return (
    <ol className="space-y-3">
      {ordered.map((e, i) => (
        <li key={`${e.at}-${i}`} className="flex gap-3">
          <span className={`mt-1.5 size-2 shrink-0 rounded-full ${DOT[e.kind] ?? 'bg-muted-foreground'}`} aria-hidden />
          <div className="min-w-0">
            <p className="text-sm text-foreground">
              {e.label}
              {admin && e.actor && <span className="ml-2 text-xs text-muted-foreground">by {e.actor}</span>}
            </p>
            <p className="text-[0.7rem] tabular text-muted-foreground">{fmt(e.at)}</p>
            {admin && e.detail && <p className="mt-0.5 text-xs italic text-muted-foreground">{e.detail}</p>}
          </div>
        </li>
      ))}
    </ol>
  )
}
