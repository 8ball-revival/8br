'use client'

/**
 * The Site Builder control centre.
 *
 * Everything that is about the SYSTEM rather than about one page: what is published, what is
 * drafted, what is scheduled, what is broken, what is in the trash, and the recovery controls.
 * Editing itself happens on the page being edited, not here — this is the map, not the workshop.
 */

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  AlertTriangle, CalendarClock, Check, Clock, ExternalLink, FileStack, History, Loader2, PenLine,
  RotateCcw, Trash2, Undo2,
} from 'lucide-react'

import { cn } from '@/lib/utils'
import type { BuilderOverview, PageOverview } from '@/lib/site-builder/overview'
import {
  bootstrapAction, cancelScheduleAction, purgeTrashAction, rescheduleAction, resetToFactoryAction,
  rollbackAction, runSchedulesNowAction,
} from '@/lib/site-builder/actions'
import { getRevisionsAction, listSchedulesAction } from '@/lib/site-builder/overview-actions'
import type { ScheduleEntry, ScheduleState } from '@/lib/site-builder/scheduler'
import { Dialog } from './palette'

type Tab = 'pages' | 'schedule' | 'reusables' | 'templates' | 'trash' | 'health' | 'help'

export function SiteBuilderControlCentre({ overview }: { overview: BuilderOverview }) {
  const [tab, setTab] = useState<Tab>('pages')
  const router = useRouter()
  const [pending, start] = useTransition()

  const tabs: { key: Tab; label: string; count?: number }[] = [
    { key: 'pages', label: 'Pages', count: overview.pages.length },
    { key: 'schedule', label: 'Schedule', count: overview.pages.reduce((n, p) => n + p.scheduled.length, 0) },
    { key: 'reusables', label: 'Reusable modules', count: overview.reusables.length },
    { key: 'templates', label: 'Templates', count: overview.templates.length },
    { key: 'trash', label: 'Trash', count: overview.trash.length },
    { key: 'health', label: 'Health' },
    { key: 'help', label: 'Guide' },
  ]

  if (!overview.bootstrapped) {
    return (
      <section className="cyber-clip border border-[var(--line-strong)] bg-[var(--graphite)] p-6">
        <h1 className="font-display text-xl font-black uppercase tracking-tight text-foreground">Set up the Site Builder</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          This captures the site exactly as it is today as the first published layout. Nothing about
          the public site changes — the homepage keeps the same rows, the same proportions and the
          same modules. Afterwards you can edit any of it from the page itself.
        </p>
        <button
          type="button"
          disabled={pending}
          onClick={() => start(async () => { await bootstrapAction(); router.refresh() })}
          className="mt-4 flex items-center gap-2 bg-[var(--hot-red)] px-4 py-2 text-xs font-bold uppercase tracking-[0.12em] text-white disabled:opacity-50"
        >
          {pending && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
          Capture the current site
        </button>
      </section>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div role="tablist" aria-label="Site builder sections" className="flex flex-wrap gap-1 border-b border-border">
        {tabs.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              'flex items-center gap-1.5 border-b-2 px-3 py-2 text-[11px] font-bold uppercase tracking-[0.12em] transition',
              tab === t.key ? 'border-[var(--hot-red)] text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {t.label}
            {t.count !== undefined && <span className="tabular text-muted-foreground">{t.count}</span>}
          </button>
        ))}
      </div>

      {tab === 'pages' && <PagesTab overview={overview} />}
      {tab === 'schedule' && <ScheduleTab />}
      {tab === 'reusables' && <ReusablesTab overview={overview} />}
      {tab === 'templates' && <TemplatesTab overview={overview} />}
      {tab === 'trash' && <TrashTab overview={overview} />}
      {tab === 'health' && <HealthTab overview={overview} />}
      {tab === 'help' && <HelpTab />}
    </div>
  )
}

// ── Schedule ────────────────────────────────────────────────────────────────────────────────────

const SCHEDULE_WORDS: Record<ScheduleState, { label: string; tone: string; help: string }> = {
  scheduled: { label: 'Scheduled', tone: 'border-[var(--brcam-teal)] text-[var(--brcam-teal)]', help: 'Waiting for its time.' },
  overdue: { label: 'Overdue', tone: 'border-[var(--gold)] text-[var(--gold)]', help: 'Its time has passed and it has not published yet. Run the schedule below, or wait for the next sweep.' },
  activated: { label: 'Published', tone: 'border-[var(--line-strong)] text-muted-foreground', help: 'It went out.' },
  failed: { label: 'Failed', tone: 'border-[var(--hot-red)] text-[var(--hot-red)]', help: 'It could not be published, and the page kept what it already had.' },
  cancelled: { label: 'Cancelled', tone: 'border-[var(--line-strong)] text-muted-foreground', help: 'Called off before it published.' },
}

/**
 * Everything the scheduler has done or is about to do.
 *
 * ── Times are stored in UTC and shown in yours ───────────────────────────────────────────────────
 * Every timestamp crosses the wire as an ISO string ending in Z, and `formatWhen` renders it in the
 * reader's own zone with the zone NAMED. A scheduling interface that shows a bare "3:00" is the one
 * that gets an announcement published in the middle of the night, and the zone is the only part of
 * that sentence anybody would have wanted to check.
 */
function ScheduleTab() {
  const [rows, setRows] = useState<ScheduleEntry[] | null>(null)
  const [sweeping, setSweeping] = useState<string | null>(null)
  const [rescheduling, setRescheduling] = useState<ScheduleEntry | null>(null)
  const router = useRouter()
  const [pending, start] = useTransition()

  const load = () => void listSchedulesAction().then(setRows)
  if (rows === null) load()

  const pendingRows = (rows ?? []).filter((r) => r.state === 'scheduled' || r.state === 'overdue')
  const doneRows = (rows ?? []).filter((r) => r.state !== 'scheduled' && r.state !== 'overdue')

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3 border border-border p-3">
        <div className="min-w-0 max-w-2xl">
          <p className="eyebrow text-muted-foreground">How this runs</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            A scheduled publication goes out on its own — a job runs on the server every few minutes,
            and any page the site serves also activates anything overdue before it renders. You do
            not have to be here for it to happen. If something is <strong className="text-foreground">Overdue</strong> and
            you would rather not wait, run the schedule now.
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Times below are shown in your own time zone. They are stored in UTC.
          </p>
        </div>
        <button
          type="button"
          disabled={pending}
          onClick={() => start(async () => {
            const r = await runSchedulesNowAction()
            setSweeping(r.ok
              ? `Checked ${r.data.considered} due ${r.data.considered === 1 ? 'revision' : 'revisions'}: ${r.data.activated} published, ${r.data.failed} failed.`
              : r.error ?? 'The schedule could not be run.')
            load(); router.refresh()
          })}
          className="flex shrink-0 items-center gap-1.5 border border-border px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground hover:border-[var(--hot-red)] hover:text-foreground disabled:opacity-50"
        >
          {pending && <Loader2 className="size-3 animate-spin" aria-hidden />}
          Run the schedule now
        </button>
      </div>
      {sweeping && <p className="border-l-2 border-[var(--brcam-teal)] pl-2 text-[11px] text-muted-foreground">{sweeping}</p>}

      {rows === null && <p className="text-[11px] text-muted-foreground">Loading…</p>}
      {rows?.length === 0 && (
        <EmptyPanel
          icon={<CalendarClock className="size-5" />}
          title="Nothing is scheduled"
          body="In Edit Mode, use Publish → Schedule to have a page publish itself at a time you choose."
        />
      )}

      {pendingRows.length > 0 && (
        <section>
          <h3 className="eyebrow mb-1.5 text-muted-foreground">Waiting to publish</h3>
          <ul className="flex flex-col gap-1">
            {pendingRows.map((r) => (
              <ScheduleRow
                key={`${r.pageKey}-${r.revisionNumber}`}
                row={r}
                busy={pending}
                onCancel={() => start(async () => {
                  await cancelScheduleAction(r.pageKey, r.revisionNumber)
                  load(); router.refresh()
                })}
                onReschedule={() => setRescheduling(r)}
              />
            ))}
          </ul>
        </section>
      )}

      {doneRows.length > 0 && (
        <section>
          <h3 className="eyebrow mb-1.5 text-muted-foreground">Recently</h3>
          <ul className="flex flex-col gap-1">
            {doneRows.map((r) => (
              <ScheduleRow key={`${r.pageKey}-${r.revisionNumber}-${r.state}`} row={r} busy={pending} />
            ))}
          </ul>
        </section>
      )}

      {rescheduling && (
        <RescheduleDialog
          row={rescheduling}
          onClose={() => setRescheduling(null)}
          onDone={() => { setRescheduling(null); load(); router.refresh() }}
        />
      )}
    </div>
  )
}

function ScheduleRow({ row, busy, onCancel, onReschedule }: {
  row: ScheduleEntry
  busy: boolean
  onCancel?: () => void
  onReschedule?: () => void
}) {
  const word = SCHEDULE_WORDS[row.state]
  return (
    <li className="flex flex-wrap items-start gap-2 border border-border px-2.5 py-2">
      <span className={cn('mt-0.5 shrink-0 border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.08em]', word.tone)}>
        {word.label}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-xs text-foreground">
          <span className="font-semibold">{row.pageTitle}</span>
          <span className="tabular text-muted-foreground"> · revision {row.revisionNumber}</span>
        </p>
        <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
          {row.state === 'activated' && row.activatedAt && <>Published {formatWhen(row.activatedAt)}{row.scheduledFor ? ` (due ${formatWhen(row.scheduledFor)})` : ''}.</>}
          {(row.state === 'scheduled' || row.state === 'overdue') && <>Due {formatWhen(row.scheduledFor)}{row.expiresAt ? `, reverting ${formatWhen(row.expiresAt)}` : ''}.</>}
          {row.state === 'cancelled' && <>Cancelled {formatWhen(row.cancelledAt)}{row.cancelledBy ? ` by ${row.cancelledBy}` : ''}.</>}
          {row.state === 'failed' && <>{row.error ?? 'It could not be published.'}</>}
          {' '}{word.help}
        </p>
      </div>
      {(onCancel || onReschedule) && (
        <div className="flex shrink-0 items-center gap-1">
          {onReschedule && (
            <button
              type="button"
              disabled={busy}
              onClick={onReschedule}
              className="border border-border px-2 py-1 text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground hover:text-foreground disabled:opacity-50"
            >
              Move
            </button>
          )}
          {onCancel && (
            <button
              type="button"
              disabled={busy}
              onClick={onCancel}
              className="border border-border px-2 py-1 text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground hover:border-[var(--hot-red)] hover:text-foreground disabled:opacity-50"
            >
              Cancel
            </button>
          )}
        </div>
      )}
    </li>
  )
}

/**
 * Move a pending publication to a different time.
 *
 * The field is a `datetime-local`, which means the browser presents it in the reader's own zone and
 * hands back a value with no zone attached. `new Date(value).toISOString()` interprets that in the
 * same local zone and converts to UTC — so what the Owner typed is what is stored, and the two ends
 * agree without either of them having to say the zone out loud.
 */
function RescheduleDialog({ row, onClose, onDone }: { row: ScheduleEntry; onClose: () => void; onDone: () => void }) {
  const [when, setWhen] = useState(() => toLocalInput(row.scheduledFor))
  const [expires, setExpires] = useState(() => toLocalInput(row.expiresAt))
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  return (
    <Dialog title={`Move the ${row.pageTitle} schedule`} onClose={onClose}>
      <p className="text-xs text-muted-foreground">
        This changes only <em>when</em> revision {row.revisionNumber} publishes. The layout that goes
        out is the one that was frozen when it was scheduled, not whatever the draft says now.
      </p>
      <label className="flex flex-col gap-1">
        <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">Publish at ({localZone()})</span>
        <input
          type="datetime-local"
          value={when}
          onChange={(e) => setWhen(e.target.value)}
          className="w-full border border-border bg-transparent px-2 py-1.5 text-xs text-foreground focus:border-[var(--hot-red)] focus:outline-none"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">Revert at (optional)</span>
        <input
          type="datetime-local"
          value={expires}
          onChange={(e) => setExpires(e.target.value)}
          className="w-full border border-border bg-transparent px-2 py-1.5 text-xs text-foreground focus:border-[var(--hot-red)] focus:outline-none"
        />
      </label>
      {when && <p className="text-[11px] text-muted-foreground">That is {formatWhen(new Date(when).toISOString())}.</p>}
      {error && <p className="border-l-2 border-[var(--hot-red)] pl-2 text-[11px] text-[var(--hot-red)]">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClose} className="border border-border px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.1em] text-muted-foreground hover:text-foreground">Cancel</button>
        <button
          type="button"
          disabled={busy || !when}
          onClick={async () => {
            setBusy(true); setError(null)
            const result = await rescheduleAction(
              row.pageKey,
              row.revisionNumber,
              new Date(when).toISOString(),
              expires ? new Date(expires).toISOString() : null,
            )
            setBusy(false)
            if (result.ok) onDone(); else setError(result.error)
          }}
          className="flex items-center gap-1.5 bg-[var(--hot-red)] px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.1em] text-white disabled:opacity-40"
        >
          {busy && <Loader2 className="size-3 animate-spin" aria-hidden />}
          Move it
        </button>
      </div>
    </Dialog>
  )
}

/** An ISO instant as the value a `datetime-local` input expects, in the reader's own zone. */
function toLocalInput(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** The reader's zone, named, so a time on screen is never ambiguous. */
function localZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'your time'
  } catch {
    return 'your time'
  }
}

// ── Pages ───────────────────────────────────────────────────────────────────────────────────────

function PagesTab({ overview }: { overview: BuilderOverview }) {
  const statics = overview.pages.filter((p) => p.kind === 'STATIC')
  const templates = overview.pages.filter((p) => p.kind === 'TEMPLATE')
  const globals = overview.pages.filter((p) => p.kind === 'GLOBAL')
  return (
    <div className="flex flex-col gap-6">
      <PageGroup
        title="Everywhere"
        description="The navigation, the footer, the theme and the site-wide banner. These appear on every page, and they use the same drafts, revisions and rollback as everything else."
        pages={globals}
      />
      <PageGroup title="Pages" description="One layout each. Open a page to edit it where it lives." pages={statics} />
      <PageGroup
        title="Dynamic templates"
        description="Each governs every page of its kind that has no override of its own — every Season, every Tournament, every article."
        pages={templates}
      />
    </div>
  )
}

function PageGroup({ title, description, pages }: { title: string; description: string; pages: PageOverview[] }) {
  if (!pages.length) return null
  return (
    <section>
      <h2 className="eyebrow text-foreground">{title}</h2>
      <p className="mb-2 text-xs text-muted-foreground">{description}</p>
      <ul className="flex flex-col gap-1.5">
        {pages.map((p) => <PageRow key={p.key} page={p} />)}
      </ul>
    </section>
  )
}

function PageRow({ page }: { page: PageOverview }) {
  const [history, setHistory] = useState(false)
  const router = useRouter()
  const [pending, start] = useTransition()

  const broken = page.issues.length > 0
  const unknown = page.unknownTypes.length > 0

  return (
    <li className={cn('border p-3', broken ? 'border-[var(--hot-red)]' : 'border-border')}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2">
            <span className="font-display text-sm font-black uppercase tracking-tight text-foreground">{page.title}</span>
            <code className="text-[11px] text-muted-foreground">{page.key}</code>
            {page.draftDirty && (
              <span className="border border-[var(--gold)] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.1em] text-[var(--gold)]">
                Unpublished draft
              </span>
            )}
            {page.scheduled.length > 0 && (
              <span className="flex items-center gap-1 border border-[var(--brcam-teal)] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.1em] text-[var(--brcam-teal)]">
                <Clock className="size-2.5" aria-hidden /> Scheduled
              </span>
            )}
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {page.publishedRevision
              ? <>Revision {page.publishedRevision} · published {formatWhen(page.publishedAt)}{page.publishedBy ? ` by ${page.publishedBy}` : ''} · {page.sectionCount} sections, {page.moduleCount} modules</>
              : 'Never published.'}
            {page.lastEditedAt && <> · last edited {formatWhen(page.lastEditedAt)}{page.lastEditor ? ` by ${page.lastEditor}` : ''}</>}
          </p>
          {broken && (
            <p className="mt-1 border-l-2 border-[var(--hot-red)] pl-2 text-[11px] text-[var(--hot-red)]">
              The published layout does not validate, so the site is serving an earlier revision or the
              built-in layout. {page.issues.join(' · ')}
            </p>
          )}
          {unknown && (
            <p className="mt-1 border-l-2 border-[var(--gold)] pl-2 text-[11px] text-[var(--gold)]">
              Uses module types this build does not have: {page.unknownTypes.join(', ')}. They are kept, and render as a placeholder.
            </p>
          )}
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-1">
          {page.editHref ? (
            <Link
              href={page.editHref}
              /*
                A template's link opens a REAL instance — the newest Season, the latest article —
                because a template edited against a placeholder shows none of the live data the
                layout is actually arranging. The title says so, so the destination is not a surprise.
              */
              title={page.kind === 'TEMPLATE'
                ? `Edit this template on a real page (${page.editHref.replace('?edit=1', '')})`
                : `Edit ${page.title}`}
              className="flex items-center gap-1.5 bg-[var(--hot-red)] px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-white hover:brightness-110"
            >
              <PenLine className="size-3" aria-hidden /> Edit
            </Link>
          ) : (
            <span
              className="px-2 text-[10px] uppercase text-muted-foreground"
              title="This template governs pages that do not exist yet. Publish one and the Edit button appears."
            >
              No example yet
            </span>
          )}
          {page.key.startsWith('/') && (
            <Link
              href={page.key}
              className="border border-border p-1.5 text-muted-foreground hover:text-foreground"
              title="View the published page"
              aria-label={`View ${page.title}`}
            >
              <ExternalLink className="size-3" aria-hidden />
            </Link>
          )}
          <button
            type="button"
            onClick={() => setHistory(true)}
            className="border border-border p-1.5 text-muted-foreground hover:text-foreground"
            title={`Revision history (${page.revisionCount})`}
            aria-label={`Revision history for ${page.title}`}
          >
            <History className="size-3" aria-hidden />
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              if (!window.confirm(`Reset "${page.title}" to the layout defined in code? This creates a draft — nothing is published until you publish it.`)) return
              start(async () => { await resetToFactoryAction(page.key); router.refresh() })
            }}
            className="border border-border p-1.5 text-muted-foreground hover:text-foreground"
            title="Reset to the built-in layout (creates a draft)"
            aria-label={`Reset ${page.title} to the built-in layout`}
          >
            <RotateCcw className="size-3" aria-hidden />
          </button>
        </div>
      </div>

      {page.scheduled.map((s) => (
        <p key={s.number} className="mt-2 flex flex-wrap items-center gap-2 border-l-2 border-[var(--brcam-teal)] pl-2 text-[11px] text-muted-foreground">
          Revision {s.number} publishes {formatWhen(s.at)}{s.expires ? `, and reverts ${formatWhen(s.expires)}` : ''}.
          <button
            type="button"
            onClick={() => start(async () => { await cancelScheduleAction(page.key, s.number); router.refresh() })}
            className="underline underline-offset-2 hover:text-foreground"
          >
            Cancel
          </button>
        </p>
      ))}

      {history && <HistoryDialog page={page} onClose={() => setHistory(false)} />}
    </li>
  )
}

function HistoryDialog({ page, onClose }: { page: PageOverview; onClose: () => void }) {
  const [rows, setRows] = useState<Awaited<ReturnType<typeof getRevisionsAction>> | null>(null)
  const router = useRouter()
  const [pending, start] = useTransition()

  if (rows === null) void getRevisionsAction(page.key).then(setRows)

  return (
    <Dialog title={`${page.title} — revision history`} onClose={onClose}>
      <p className="text-xs text-muted-foreground">
        Restoring loads that revision as a draft and publishes it as a NEW revision, so nothing is
        overwritten and the restore itself can be undone.
      </p>
      {rows === null && <p className="text-[11px] text-muted-foreground">Loading…</p>}
      {rows?.length === 0 && <p className="text-[11px] text-muted-foreground">No revisions yet.</p>}
      {rows && rows.length > 0 && (
        <ul className="flex max-h-72 flex-col gap-1 overflow-y-auto">
          {rows.map((r) => (
            <li key={r.number} className={cn('flex items-center justify-between gap-2 border px-2 py-1.5', r.isLive ? 'border-[var(--hot-red)]' : 'border-border')}>
              <span className="min-w-0">
                <span className="flex items-center gap-2 text-xs text-foreground">
                  <span className="tabular font-semibold">#{r.number}</span>
                  {r.isLive && <span className="border border-[var(--hot-red)] px-1 text-[9px] uppercase text-[var(--hot-red)]">Live</span>}
                  {r.state === 'SCHEDULED' && <span className="border border-[var(--brcam-teal)] px-1 text-[9px] uppercase text-[var(--brcam-teal)]">Scheduled</span>}
                  {r.state === 'ARCHIVED' && <span className="text-[9px] uppercase text-muted-foreground">Archived</span>}
                </span>
                <span className="block truncate text-[11px] text-muted-foreground">
                  {formatWhen(r.publishedAt)}{r.publishedBy ? ` · ${r.publishedBy}` : ''}{r.summary ? ` · ${r.summary}` : ''}
                </span>
              </span>
              {!r.isLive && (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => {
                    if (!window.confirm(`Restore revision ${r.number}? It is published immediately as a new revision.`)) return
                    start(async () => { await rollbackAction(page.key, r.number); router.refresh(); onClose() })
                  }}
                  className="flex shrink-0 items-center gap-1 border border-border px-2 py-1 text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground hover:border-[var(--hot-red)] hover:text-foreground"
                >
                  <Undo2 className="size-3" aria-hidden /> Restore
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  )
}

// ── Other tabs ──────────────────────────────────────────────────────────────────────────────────

function ReusablesTab({ overview }: { overview: BuilderOverview }) {
  if (!overview.reusables.length) {
    return <EmptyPanel icon={<FileStack className="size-5" />} title="No reusable modules yet" body="In Edit Mode, select a module and choose “Save as reusable” to keep its settings for use on other pages." />
  }
  return (
    <ul className="flex flex-col gap-1.5">
      {overview.reusables.map((r) => (
        <li key={r.id} className="flex items-center justify-between gap-3 border border-border px-3 py-2">
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold text-foreground">{r.name}</span>
            <span className="block truncate text-[11px] text-muted-foreground">{r.moduleType} · updated {formatWhen(r.updatedAt)}</span>
          </span>
          {r.missing && (
            <span className="flex shrink-0 items-center gap-1 border border-[var(--gold)] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.1em] text-[var(--gold)]">
              <AlertTriangle className="size-2.5" aria-hidden /> Module type missing
            </span>
          )}
        </li>
      ))}
    </ul>
  )
}

function TemplatesTab({ overview }: { overview: BuilderOverview }) {
  if (!overview.templates.length) {
    return <EmptyPanel icon={<FileStack className="size-5" />} title="No saved templates" body="Save a section or a whole page as a template from Edit Mode to reuse its structure." />
  }
  return (
    <ul className="flex flex-col gap-1.5">
      {overview.templates.map((t) => (
        <li key={t.id} className="flex items-center justify-between gap-3 border border-border px-3 py-2">
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold text-foreground">{t.name}</span>
            <span className="block text-[11px] text-muted-foreground">{t.scope} · updated {formatWhen(t.updatedAt)}</span>
          </span>
        </li>
      ))}
    </ul>
  )
}

function TrashTab({ overview }: { overview: BuilderOverview }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  if (!overview.trash.length) {
    return <EmptyPanel icon={<Trash2 className="size-5" />} title="The trash is empty" body="Deleted modules and sections are kept here for 30 days before they are removed for good." />
  }
  return (
    <ul className="flex flex-col gap-1.5">
      {overview.trash.map((t) => (
        <li key={t.id} className="flex items-center justify-between gap-3 border border-border px-3 py-2">
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold text-foreground">{t.label}</span>
            <span className="block text-[11px] text-muted-foreground">
              {t.kind} · deleted {formatWhen(t.deletedAt)}{t.deletedBy ? ` by ${t.deletedBy}` : ''}
              {t.purgeAfter ? ` · removed for good ${formatWhen(t.purgeAfter)}` : ''}
            </span>
          </span>
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              if (!window.confirm(`Permanently delete "${t.label}"? This cannot be undone.`)) return
              start(async () => { await purgeTrashAction(t.id); router.refresh() })
            }}
            className="shrink-0 border border-border px-2 py-1 text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground hover:border-[var(--hot-red)] hover:text-[var(--hot-red)]"
          >
            Delete for good
          </button>
        </li>
      ))}
    </ul>
  )
}

function HealthTab({ overview }: { overview: BuilderOverview }) {
  const broken = overview.pages.filter((p) => p.issues.length > 0)
  const unknown = overview.pages.filter((p) => p.unknownTypes.length > 0)
  const unpublished = overview.pages.filter((p) => p.draftDirty)

  return (
    <div className="flex flex-col gap-4">
      <section className="border border-border p-3">
        <h2 className="eyebrow text-foreground">Validation</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Every published layout is re-checked against the current module registry each time this page
          loads, rather than trusting a stored flag — a page can become invalid because a module
          changed, with nobody having edited it.
        </p>
        <ul className="mt-2 flex flex-col gap-1 text-xs">
          <HealthRow ok={broken.length === 0} label={broken.length === 0 ? 'Every published layout validates.' : `${broken.length} page(s) do not validate and are falling back.`} />
          <HealthRow ok={unknown.length === 0} label={unknown.length === 0 ? 'No unknown module types.' : `${unknown.length} page(s) reference module types this build does not have.`} />
          <HealthRow ok={unpublished.length === 0} warn label={unpublished.length === 0 ? 'No unpublished drafts.' : `${unpublished.length} page(s) have unpublished changes.`} />
        </ul>
      </section>

      <section className="border border-border p-3">
        <h2 className="eyebrow text-foreground">Module registry</h2>
        <p className="mt-1 text-xs text-muted-foreground">{overview.registry.total} modules available.</p>
        <ul className="mt-2 grid grid-cols-2 gap-1 sm:grid-cols-4">
          {overview.registry.byCategory.map((c) => (
            <li key={c.category} className="border border-border px-2 py-1.5">
              <span className="block text-[10px] uppercase tracking-[0.1em] text-muted-foreground">{c.category}</span>
              <span className="tabular block font-display text-base font-black text-foreground">{c.count}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="border border-[var(--line-strong)] p-3">
        <h2 className="eyebrow text-foreground">If something goes wrong</h2>
        <ul className="mt-2 flex list-disc flex-col gap-1 pl-4 text-xs text-muted-foreground">
          <li>A layout that fails to validate never reaches visitors — the site serves the last revision that did, and failing that the layout defined in code.</li>
          <li><strong className="text-foreground">Restore</strong> in a page’s revision history brings back any earlier version as a new revision.</li>
          <li><strong className="text-foreground">Reset</strong> on a page returns it to the built-in layout as a draft, so you can review before publishing.</li>
          <li>This page is reachable at <code>/staff/site-builder</code> no matter what the published navigation says.</li>
        </ul>
      </section>
    </div>
  )
}

function HealthRow({ ok, warn, label }: { ok: boolean; warn?: boolean; label: string }) {
  return (
    <li className="flex items-center gap-2">
      {ok
        ? <Check className="size-3.5 shrink-0 text-[var(--brcam-teal)]" aria-hidden />
        : <AlertTriangle className={cn('size-3.5 shrink-0', warn ? 'text-[var(--gold)]' : 'text-[var(--hot-red)]')} aria-hidden />}
      <span className={ok ? 'text-muted-foreground' : 'text-foreground'}>{label}</span>
    </li>
  )
}

function HelpTab() {
  return (
    <div className="flex max-w-3xl flex-col gap-4 text-sm leading-relaxed text-muted-foreground">
      <Step n={1} title="Turn on Edit Mode">
        Open any page on the site and press <strong className="text-foreground">Edit</strong> in the
        header. The page becomes an editing canvas — it is the real page, not a preview.
      </Step>
      <Step n={2} title="Select and change">
        Click a module to select it. Its settings appear on the right. Hover shows what each area is;
        the label above a module names it.
      </Step>
      <Step n={3} title="Move and resize">
        Drag the handle, or use the arrow buttons, or press <kbd>Alt</kbd> with the up and down arrow
        keys. Nothing needs a precise drag. Column proportions are set on the section.
      </Step>
      <Step n={4} title="Replace a module">
        Select it and choose <strong className="text-foreground">Replace</strong>. Position, size and
        shared settings carry across, and Undo brings the original back.
      </Step>
      <Step n={5} title="Check the other layouts">
        The desktop, tablet and phone buttons narrow the page and switch which layout you are editing.
        Tablet and phone follow desktop until you change them, and can be reset back.
      </Step>
      <Step n={6} title="Draft, then publish">
        Everything autosaves as a draft that only you can see. <strong className="text-foreground">Publish</strong> makes
        it live for everyone and keeps the previous version, which you can restore at any time.
      </Step>
      <p className="border-l-2 border-[var(--line-strong)] pl-3">
        The full guide is in the repository at <code>docs/site-builder-user-guide.md</code>, with
        recovery steps in <code>docs/site-builder-recovery.md</code>.
      </p>
    </div>
  )
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="flex gap-3">
      <span className="tabular flex size-6 shrink-0 items-center justify-center bg-[var(--hot-red)] text-xs font-black text-white">{n}</span>
      <span>
        <span className="block font-display text-sm font-black uppercase tracking-tight text-foreground">{title}</span>
        <span className="block">{children}</span>
      </span>
    </section>
  )
}

function EmptyPanel({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className="flex flex-col items-center gap-2 border border-dashed border-border p-8 text-center">
      <span className="text-muted-foreground" aria-hidden>{icon}</span>
      <p className="eyebrow text-foreground">{title}</p>
      <p className="max-w-md text-xs text-muted-foreground">{body}</p>
    </div>
  )
}

/**
 * Dates are rendered on the CLIENT from an ISO string.
 *
 * Formatting on the server would use the server's locale and timezone, which is not the reader's —
 * and in this app it would also be a hydration mismatch, because the two would disagree.
 */
/**
 * An instant, in the reader's own zone, with the zone named.
 *
 * The zone is not decoration. Everything here is stored in UTC and read by somebody who is not in
 * UTC, and "publishes at 3:00" without a zone is the sentence that gets an announcement published
 * in the middle of somebody's night.
 */
function formatWhen(iso: string | null): string {
  if (!iso) return 'never'
  const d = new Date(iso)
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZoneName: 'short' })
}
