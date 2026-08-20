import { Archive, AlertTriangle, CheckCircle2, CircleSlash } from 'lucide-react'

import { cn } from '@/lib/utils'
import type { TemplateStatus } from '@/lib/archive/manifest'

/**
 * What the archive knows about one historical Season.
 *
 * Informational only: nothing here creates an entrant or a result. It exists so the owner can see,
 * before opening a Season, whether it is worth reconstructing yet — and so a Season with partial or
 * blocked source data says so plainly rather than looking identical to a complete one.
 */
export function ArchiveTemplateStatus({ status }: { status: TemplateStatus }) {
  if (!status.exists) {
    return (
      <div className="rounded-lg border border-border bg-card/40 p-3">
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <CircleSlash className="size-4 shrink-0" aria-hidden />
          No verified archive data for this Season.
        </p>
      </div>
    )
  }

  const assignmentsReady = status.groupAssignments === 'complete'
  const resultsReady = status.exactResults === 'complete'

  return (
    <div className="rounded-lg border border-border bg-card/40 p-3">
      <h3 className="mb-2 inline-flex items-center gap-1.5 text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-[var(--gold)]">
        <Archive className="size-3.5" aria-hidden />
        Archive template
      </h3>

      {/* The block comes first: everything below it is moot if Auto Assign cannot run. */}
      {status.sharedStage && (
        <p className="mb-2 flex items-start gap-2 rounded border border-[var(--loss)]/40 bg-[var(--loss)]/5 px-2 py-1.5 text-xs">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-[var(--loss)]" aria-hidden />
          <span>
            <span className="font-semibold">{status.sharedStageMessage}</span>
            <span className="mt-0.5 block text-muted-foreground">
              This Season&rsquo;s group stage was played undivided and only the playoffs split into
              divisions. Applying those groups here and again to the other division would count every
              result twice.
            </span>
          </span>
        </p>
      )}

      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Participants" value={status.participantCount} />
        <Stat label="Groups" value={status.groupCount} />
        <Stat label="Exact results" value={status.exactMatchCount} />
        <Stat label="Unresolved" value={status.unresolvedCount} warn={status.unresolvedCount > 0} />
      </dl>

      <div className="mt-2 flex flex-wrap gap-1.5 text-[0.7rem]">
        <Chip ok={assignmentsReady} label={
          status.groupAssignments === 'complete' ? 'Group assignments ready'
          : status.groupAssignments === 'partial' ? 'Partial group data'
          : status.groupAssignments === 'undivided-source' ? 'Shared group stage'
          : 'No group assignments'
        } />
        <Chip ok={resultsReady} label={
          status.standingsOnly ? 'Standings only — no match scores'
          : status.exactResults === 'complete' ? 'Group results ready'
          : status.exactResults === 'partial' ? 'Partial results'
          : 'No exact results'
        } />
        {status.ambiguousCount > 0 && (
          <Chip ok={false} label={`${status.ambiguousCount} ambiguous archive ${status.ambiguousCount === 1 ? 'handle' : 'handles'}`} />
        )}
      </div>

      {status.unresolved.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
            What the archive could not settle ({status.unresolved.length})
          </summary>
          <ul className="mt-1.5 flex list-disc flex-col gap-1 pl-5 text-xs text-muted-foreground">
            {status.unresolved.map((u, i) => <li key={i}>{u}</li>)}
          </ul>
        </details>
      )}
    </div>
  )
}

function Stat({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <div>
      <dt className="text-[0.65rem] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className={cn('text-base font-bold tabular-nums', warn && value > 0 && 'text-[var(--loss)]')}>{value}</dd>
    </div>
  )
}

function Chip({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={cn(
      'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-medium',
      ok ? 'border-[var(--gold)]/40 text-[var(--gold)]' : 'border-border text-muted-foreground',
    )}>
      {ok
        ? <CheckCircle2 className="size-3" aria-hidden />
        : <AlertTriangle className="size-3" aria-hidden />}
      {label}
    </span>
  )
}
