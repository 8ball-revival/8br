import type { AuditLog } from '@prisma/client'

import { formatDateTime } from '@/lib/format'

/** Human label for the score inside an audit old/new value blob, if present. */
function scoreOf(v: unknown): string | null {
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    if (typeof o.homeGames === 'number' && typeof o.awayGames === 'number') return `${o.homeGames}–${o.awayGames}`
    if (o.status && typeof o.status === 'string' && o.homeGames == null) return String(o.status)
  }
  return null
}

const ACTION_LABEL: Record<string, string> = {
  'match.recordScore': 'Score entered/edited',
  'match.undo': 'Result undone',
  'match.forfeit': 'Forfeit',
  'match.no_show': 'No-show',
  'match.disputed': 'Disputed',
  'match.verify': 'Verified',
  'match.unverify': 'Unverified',
  'match.note': 'Note',
  'match.reschedule': 'Rescheduled',
  'playoff.recordScore': 'Score entered/edited',
  'playoff.undo': 'Result undone',
  'playoff.verify': 'Verified & advanced',
  'playoff.note': 'Note',
}

/**
 * Match history panel — reads the existing audit log (no separate history system).
 * Shows every change: what changed (old → new score/status), who, when, and any
 * reason. The first score is the "original", the latest the "current".
 */
export function MatchHistory({ entries }: { entries: AuditLog[] }) {
  if (!entries.length) return null
  const scores = entries.map((e) => scoreOf(e.newValue)).filter(Boolean) as string[]
  const original = scores[0]
  const current = scores[scores.length - 1]
  return (
    <details className="mt-2 rounded-md border border-border bg-background/40 text-xs">
      <summary className="cursor-pointer px-3 py-1.5 text-muted-foreground select-none">
        History ({entries.length}){original && current && original !== current ? ` · ${original} → ${current}` : ''}
      </summary>
      <ul className="space-y-1.5 border-t border-border px-3 py-2">
        {entries.map((e) => {
          const oldS = scoreOf(e.oldValue)
          const newS = scoreOf(e.newValue)
          return (
            <li key={e.id} className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-medium text-foreground">{ACTION_LABEL[e.action] ?? e.action}</span>
              {oldS && newS && oldS !== newS && <span className="tabular text-muted-foreground">{oldS} → {newS}</span>}
              {!oldS && newS && <span className="tabular text-muted-foreground">{newS}</span>}
              <span className="text-muted-foreground">by {e.actorUsername}</span>
              <span className="text-muted-foreground/70">· {formatDateTime(e.createdAt.toISOString())}</span>
              {e.reason && <span className="w-full text-muted-foreground/80">“{e.reason}”</span>}
            </li>
          )
        })}
      </ul>
    </details>
  )
}
