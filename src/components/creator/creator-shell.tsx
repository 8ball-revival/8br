import Link from 'next/link'
import { ArrowLeft, Check, ExternalLink, Settings2 } from 'lucide-react'

import { cn } from '@/lib/utils'
import { Wide } from '@/components/primitives'
import type { StageView } from '@/lib/creator/workflow'

/**
 * The frame every Creator record page renders inside.
 *
 * ── Why a shell rather than a layout ─────────────────────────────────────────────────────────────
 * The stages are nested routes, which a Next layout could wrap — but the shell needs the RECORD to
 * draw itself (its title, its stage, its lifecycle), and a layout cannot see the page's data without
 * fetching it a second time. Each stage page fetches its record once and hands it here, so there is
 * one query and one description of where the reader is.
 *
 * ── The summary is deliberately small ────────────────────────────────────────────────────────────
 * Competition, year, number, division, status. Nothing else. The reader is in the middle of running
 * a competition and needs to know which record they are editing, not to re-read its description on
 * every stage; a summary that explains itself at length is a summary nobody reads at all.
 */
export function CreatorShell({
  kind,
  title,
  summary,
  status,
  workflow,
  publicHref,
  settings,
  actions,
  children,
}: {
  kind: 'season' | 'tournament'
  title: string
  /** Competition · Year · Number · Division — already formatted, already short. */
  summary: string
  /** Lifecycle, in the words the rest of the site uses. */
  status: string
  workflow: StageView[]
  /** The public page for this record, when it has one. */
  publicHref?: string | null
  /** The persistent Settings control, supplied by the page so it can carry the record's own data. */
  settings?: React.ReactNode
  /** Stage-specific controls (Save and Exit, and the like). */
  actions?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <Wide>
      <div className="py-6">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Link
            href="/creator"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]/60"
          >
            <ArrowLeft className="size-4" aria-hidden /> Back to Creator
          </Link>
          <span className="ml-auto flex flex-wrap items-center gap-2">
            {publicHref && (
              <Link
                href={publicHref}
                className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-brand/40 hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]/60"
              >
                <ExternalLink className="size-3.5" aria-hidden /> View Public Page
              </Link>
            )}
            {settings ?? (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs text-muted-foreground/50">
                <Settings2 className="size-3.5" aria-hidden /> Settings
              </span>
            )}
            {actions}
          </span>
        </div>

        <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="font-display text-2xl font-bold text-foreground">{title}</h1>
          <p className="text-sm text-muted-foreground">{summary}</p>
          <span className="rounded-full border border-brand/30 bg-[var(--selected-surface)] px-2.5 py-0.5 text-xs font-medium text-brand">
            {status}
          </span>
        </div>

        <WorkflowBar workflow={workflow} kind={kind} />

        <div className="mt-6">{children}</div>
      </div>
    </Wide>
  )
}

/**
 * Setup → Entrants → Groups → Playoffs → Complete, for whichever of those this record has.
 *
 * A finished stage carries a tick and stays reachable, because going back to fix a group score is
 * ordinary work rather than an exception. A stage that is not reachable yet is rendered as text, not
 * as a dead link: a link that refuses to go anywhere is worse than no link.
 */
function WorkflowBar({ workflow, kind }: { workflow: StageView[]; kind: 'season' | 'tournament' }) {
  return (
    <nav aria-label={`${kind === 'season' ? 'Season' : 'Tournament'} workflow`} className="mt-4">
      <ol className="flex flex-wrap items-center gap-x-1 gap-y-2">
        {workflow.map((s, i) => (
          <li key={s.id} className="flex items-center gap-1">
            {i > 0 && <span aria-hidden className="mr-1 text-muted-foreground/40">→</span>}
            {s.status === 'locked' ? (
              <span
                aria-disabled="true"
                title="Available once the previous stage is finished"
                className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm text-muted-foreground/40"
              >
                {s.label}
              </span>
            ) : (
              <Link
                href={s.href}
                aria-current={s.status === 'current' ? 'step' : undefined}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]/60',
                  s.status === 'current'
                    ? 'bg-[var(--selected-surface)] font-semibold text-[var(--gold)]'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                {s.status === 'done' && <Check className="size-3.5 text-brand" aria-hidden />}
                {s.label}
              </Link>
            )}
          </li>
        ))}
      </ol>
    </nav>
  )
}
