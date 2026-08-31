'use client'

import { useCallback, useEffect, useState, useTransition } from 'react'
import { AlertTriangle, Check, Cloud, History, RotateCcw, Save, Undo2 } from 'lucide-react'

import type { DisplaySettings } from '@/lib/display/settings'
import { normaliseTokens } from '@/lib/theme/presets'
import { verdictFor } from '@/lib/theme/contrast'
import { THEME_TOKEN_REGISTRY } from '@/lib/theme/registry'
import {
  getThemeStateAction, saveThemeDraftAction, publishThemeAction,
  rollbackThemeAction, themeHistoryAction,
  type ThemeState, type ThemeRevision,
} from '@/lib/theme/actions'
import { cn } from '@/lib/utils'

/**
 * The three states a palette can be in, and the way between them.
 *
 * ── Why three and not one ───────────────────────────────────────────────────────────────────────
 * Dragging a colour picker must not change what a stranger sees. Neither must saving. Those are two
 * different promises and they need two different resting places, which is why this is not "a theme
 * with an autosave":
 *
 *   Personal preview   this browser's localStorage. Immediate, private, survives nothing else.
 *   Saved draft        the theme page's DRAFT. Survives sessions and machines. Owner-only.
 *   Published          the theme page's published REVISION. Every visitor, first paint.
 *
 * ── Publishing is the only step that asks ───────────────────────────────────────────────────────
 * Choosing a preset does not publish. Moving a picker does not publish. Saving does not publish.
 * The one action that changes what strangers see is the one that stops and says so, and it says how
 * many people rather than "are you sure" — a confirmation that does not tell you what will happen
 * is a click-through.
 */
export function ThemePublishPanel({
  settings, edit,
}: {
  settings: DisplaySettings
  edit: (patch: Partial<DisplaySettings>) => void
}) {
  const [state, setState] = useState<ThemeState | null>(null)
  const [history, setHistory] = useState<ThemeRevision[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [blocking, setBlocking] = useState<string[]>([])
  const [notice, setNotice] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [pending, startTransition] = useTransition()

  const local = normaliseTokens(settings.tokens)
  const verdict = verdictFor(local)

  /*
    Reloaded by bumping a counter rather than by calling a shared async function from the effect.

    Two reasons. The effect owns the request, so a response that arrives after the component has
    moved on is dropped instead of overwriting newer state — which is exactly what happens when a
    publish and a rollback are clicked in quick succession. And it keeps the state updates out of
    the synchronous body of the effect, which is what the compiler asks for.
  */
  const [reloadKey, setReloadKey] = useState(0)
  const refresh = useCallback(() => { setReloadKey((n) => n + 1) }, [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const res = await getThemeStateAction()
      if (cancelled) return
      if (res.ok) { setState(res.data); setError(null) }
      else setError(res.error)
    })()
    return () => { cancelled = true }
  }, [reloadKey])

  /*
    Is what is on screen the draft, the published theme, or neither?

    Compared by value rather than by tracking edits, because the answer has to survive a reload, a
    preset, an undo and a second tab. Two palettes that serialise identically ARE the same palette.
  */
  const same = (a: Record<string, string>, b: Record<string, string>) =>
    JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort())

  const matchesDraft = state ? same(local, state.draft) : false
  const matchesPublished = state ? same(local, state.published) : false

  /*
    What "reset to graphite" has to write to actually show graphite.

    Clearing the personal overrides reveals whatever is PUBLISHED underneath. While the built-in
    theme is the published one that is graphite, so an empty map is exactly right and leaves the
    banner reporting no personal changes. Once a different palette has been published it is not:
    clearing would show that palette instead, making this control a duplicate of "Back to published"
    while its label and its notice both claim otherwise. Naming the built-in values explicitly is
    what escapes a published theme.
  */
  const graphiteTarget: Record<string, string> = state && Object.keys(state.published).length > 0
    ? Object.fromEntries(THEME_TOKEN_REGISTRY.map((t) => [t.key, t.fallback]))
    : {}

  const status: 'unsaved' | 'draft' | 'published' | 'loading' =
    !state ? 'loading'
      : matchesPublished ? 'published'
        : matchesDraft ? 'draft'
          : 'unsaved'

  const run = (fn: () => Promise<void>) => {
    setError(null); setBlocking([]); setNotice(null)
    startTransition(() => { void fn() })
  }

  const saveDraft = () => run(async () => {
    const res = await saveThemeDraftAction(local, state?.version ?? 0)
    if (!res.ok) {
      setError(res.error)
      // A conflict means somebody else moved it. Re-read rather than offering to overwrite.
      if (res.conflictVersion != null) refresh()
      return
    }
    setNotice('Saved as a draft. Nothing public has changed.')
    refresh()
  })

  const doPublish = () => run(async () => {
    const res = await publishThemeAction('Site palette')
    if (!res.ok) {
      setError(res.error)
      if (res.blocking) setBlocking(res.blocking)
      return
    }
    setNotice(`Published as revision ${res.data.revisionNumber}. Every visitor sees this now.`)
    setConfirming(false)
    refresh()
    setHistory(null)
  })

  const rollTo = (n: number) => run(async () => {
    const res = await rollbackThemeAction(n)
    if (!res.ok) { setError(res.error); return }
    setNotice(`Rolled back to revision ${n}, published as ${res.data.revisionNumber}.`)
    refresh()
    const h = await themeHistoryAction()
    if (h.ok) setHistory(h.data)
  })

  const openHistory = () => run(async () => {
    const res = await themeHistoryAction()
    if (!res.ok) { setError(res.error); return }
    setHistory(res.data)
  })

  const revertTo = (tokens: Record<string, string>, label: string) => {
    edit({ tokens: { ...tokens }, preset: 'custom' })
    setNotice(label)
  }

  if (state && !state.bootstrapped) {
    return (
      <p className="border border-[var(--line)] p-2 text-[0.66rem] leading-relaxed text-muted-foreground">
        The site theme has not been captured yet. Open Admin &rarr; Site Builder and press
        <strong className="text-foreground"> Capture the current site</strong>, and this palette
        becomes publishable.
      </p>
    )
  }

  return (
    <div className="space-y-2">
      <StatusBanner status={status} state={state} />

      {notice && (
        <p className="border border-[var(--success)] bg-[color-mix(in_oklab,var(--success)_10%,transparent)] p-2 text-[0.66rem] text-foreground" role="status">
          {notice}
        </p>
      )}
      {error && (
        <p className="border border-[var(--hot-red)] bg-[color-mix(in_oklab,var(--hot-red)_10%,transparent)] p-2 text-[0.66rem] text-foreground" role="alert">
          {error}
          {blocking.length > 0 && (
            <span className="mt-1 block space-y-0.5">
              {blocking.map((b) => <span key={b} className="block text-muted-foreground">{b}</span>)}
            </span>
          )}
        </p>
      )}

      {/* ── Save, then publish. Never one button doing both. ───────────────────────────────── */}
      <div className="grid grid-cols-2 gap-1.5">
        <Action
          icon={Save}
          label="Save draft"
          hint="Keeps this palette without changing the public site."
          disabled={pending || matchesDraft}
          onClick={saveDraft}
        />
        <Action
          icon={Cloud}
          label="Publish site-wide"
          hint="Every visitor sees this."
          tone="primary"
          disabled={pending || !verdict.publishable || (state != null && !state.dirty && matchesPublished)}
          onClick={() => setConfirming(true)}
        />
      </div>

      {!verdict.publishable && (
        <p className="flex items-start gap-1.5 text-[0.64rem] text-[var(--hot-red)]">
          <AlertTriangle className="mt-px size-3 shrink-0" aria-hidden />
          {verdict.blocking.length} combination{verdict.blocking.length === 1 ? '' : 's'} would make
          essential text unreadable, so this palette cannot be published. See Legibility below.
        </p>
      )}

      <div className="grid grid-cols-2 gap-1.5">
        <Action
          icon={Undo2}
          label="Back to draft"
          hint="Discard the changes in this browser."
          disabled={pending || !state || matchesDraft}
          onClick={() => revertTo(state!.draft, 'Preview returned to the saved draft.')}
        />
        <Action
          icon={Undo2}
          label="Back to published"
          hint="Show what visitors see."
          disabled={pending || !state || matchesPublished}
          onClick={() => revertTo(state!.published, 'Preview returned to the published theme.')}
        />
      </div>

      <div className="grid grid-cols-2 gap-1.5">
        <Action
          icon={RotateCcw}
          label="Reset to graphite"
          hint="The built-in theme. Does not publish."
          disabled={pending || same(local, graphiteTarget)}
          onClick={() => { edit({ tokens: { ...graphiteTarget }, preset: 'graphite-signal' }); setNotice('Preview reset to the built-in graphite theme. Nothing was published.') }}
        />
        <Action
          icon={History}
          label="Revision history"
          hint="Earlier published themes."
          disabled={pending}
          onClick={openHistory}
        />
      </div>

      {confirming && (
        <ConfirmPublish
          pending={pending}
          onCancel={() => setConfirming(false)}
          onConfirm={doPublish}
        />
      )}

      {history && (
        <RevisionList
          revisions={history}
          pending={pending}
          onRollback={rollTo}
          onClose={() => setHistory(null)}
        />
      )}
    </div>
  )
}

/** Which of the three states this palette is in, said plainly. */
function StatusBanner({ status, state }: { status: string; state: ThemeState | null }) {
  const when = state?.publishedRevision
    ? new Intl.DateTimeFormat('en-GB', {
      day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
      timeZone: 'UTC',
    }).format(new Date(state.publishedRevision.at)) + ' UTC'
    : null

  const copy = {
    loading: { label: 'Checking…', tone: 'muted' as const, detail: '' },
    unsaved: {
      label: 'Personal preview — not saved',
      tone: 'warn' as const,
      detail: 'Only this browser. Nobody else can see it, and it is lost if you reset.',
    },
    draft: {
      label: 'Draft saved — not published',
      tone: 'info' as const,
      detail: 'Kept on your account. Visitors still see the published theme.',
    },
    published: {
      label: 'Published site-wide',
      tone: 'ok' as const,
      detail: 'This is what every visitor is being served.',
    },
  }[status] ?? { label: status, tone: 'muted' as const, detail: '' }

  return (
    <div
      className={cn(
        'border p-2',
        copy.tone === 'ok' && 'border-[var(--success)]',
        copy.tone === 'info' && 'border-[var(--acid)]',
        copy.tone === 'warn' && 'border-[var(--warning)]',
        copy.tone === 'muted' && 'border-[var(--line)]',
      )}
      role="status"
    >
      <p className="flex items-center gap-1.5 text-[0.7rem] font-semibold text-foreground">
        {copy.tone === 'ok' && <Check className="size-3.5 shrink-0 text-[var(--success)]" aria-hidden />}
        {copy.label}
      </p>
      {copy.detail && <p className="mt-0.5 text-[0.64rem] text-muted-foreground">{copy.detail}</p>}
      {state?.publishedRevision && (
        <p className="mt-1 border-t border-[var(--line)] pt-1 text-[0.62rem] text-muted-foreground">
          Live: revision {state.publishedRevision.number} · {when} · by {state.publishedRevision.actor}
        </p>
      )}
    </div>
  )
}

/**
 * The one confirmation on this panel.
 *
 * It names the consequence rather than asking whether you are sure, because "are you sure" is a
 * question people answer without reading. The confirming control also says what it does rather than
 * "OK", so the last thing read before the click is the thing that happens.
 */
function ConfirmPublish({ pending, onCancel, onConfirm }: {
  pending: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <div className="border-2 border-[var(--hot-red)] p-2.5" role="alertdialog" aria-label="Publish this palette">
      <p className="text-[0.7rem] font-semibold text-foreground">Publish to everyone?</p>
      <p className="mt-1 text-[0.64rem] leading-relaxed text-muted-foreground">
        Every visitor to the site — signed in or not — starts seeing this palette on their next page
        load. The theme you have published until now is kept, and you can roll back to it from
        Revision history.
      </p>
      <div className="mt-2 grid grid-cols-2 gap-1.5">
        <button
          type="button"
          onClick={onCancel}
          disabled={pending}
          className="border border-[var(--line-strong)] py-1.5 text-[0.66rem] font-semibold text-foreground transition-colors hover:border-[var(--acid)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] disabled:opacity-50"
        >
          Keep it private
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={pending}
          className="bg-[var(--signal-fill)] py-1.5 text-[0.66rem] font-bold uppercase tracking-wider text-[var(--signal-ink)] transition-colors hover:bg-[var(--signal-fill-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] disabled:opacity-50"
        >
          {pending ? 'Publishing…' : 'Publish site-wide'}
        </button>
      </div>
    </div>
  )
}

function RevisionList({ revisions, pending, onRollback, onClose }: {
  revisions: ThemeRevision[]
  pending: boolean
  onRollback: (n: number) => void
  onClose: () => void
}) {
  return (
    <div className="border border-[var(--line)] p-2">
      <div className="flex items-center justify-between">
        <p className="text-[0.7rem] font-semibold text-foreground">Revision history</p>
        <button
          type="button" onClick={onClose}
          className="text-[0.62rem] text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
        >
          Close
        </button>
      </div>
      {revisions.length === 0 && (
        <p className="mt-1 text-[0.64rem] text-muted-foreground">Nothing has been published yet.</p>
      )}
      <ul className="mt-1.5 space-y-1">
        {revisions.map((r) => (
          <li key={r.number} className="flex items-center gap-2 border border-[var(--line)] p-1.5">
            <span className="flex shrink-0 overflow-hidden border border-[var(--line-strong)]" aria-hidden>
              {r.swatches.map((s, i) => (
                <span key={i} className="size-3" style={{ background: s || 'var(--graphite-raised)' }} />
              ))}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[0.66rem] font-semibold text-foreground">
                Revision {r.number}{r.isPublished && ' · live'}
              </span>
              <span className="block truncate text-[0.6rem] text-muted-foreground">
                {new Date(r.at).toISOString().slice(0, 16).replace('T', ' ')} UTC · {r.actor}
              </span>
            </span>
            {!r.isPublished && (
              <button
                type="button"
                onClick={() => onRollback(r.number)}
                disabled={pending}
                className="shrink-0 border border-[var(--line-strong)] px-2 py-1 text-[0.6rem] font-semibold uppercase tracking-wider text-foreground transition-colors hover:border-[var(--acid)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] disabled:opacity-50"
              >
                Roll back
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

function Action({ icon: Icon, label, hint, onClick, disabled, tone }: {
  icon: typeof Save
  label: string
  hint: string
  onClick: () => void
  disabled?: boolean
  tone?: 'primary'
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={hint}
      className={cn(
        'flex flex-col items-start gap-0.5 border p-2 text-left transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]',
        'disabled:cursor-not-allowed disabled:opacity-40',
        tone === 'primary'
          ? 'border-[var(--signal)] hover:bg-[color-mix(in_oklab,var(--signal)_12%,transparent)]'
          : 'border-[var(--line)] hover:border-[var(--line-strong)]',
      )}
    >
      <span className="flex items-center gap-1.5 text-[0.68rem] font-semibold text-foreground">
        <Icon className="size-3.5 shrink-0" aria-hidden />
        {label}
      </span>
      <span className="text-[0.6rem] leading-snug text-muted-foreground">{hint}</span>
    </button>
  )
}
