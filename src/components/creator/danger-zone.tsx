'use client'

import { useId, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ShieldAlert, Trash2 } from 'lucide-react'

import type { SeasonDeletionPlan } from '@/lib/seasons/admin'
import { cn } from '@/lib/utils'

/**
 * Permanent deletion, in the panel that describes it.
 *
 * ── Why this exists ──────────────────────────────────────────────────────────────────────────────
 * The Creator's Danger Zone has been a paragraph. It said deletion "asks for the full title first and
 * shows exactly what will be removed", and there was no control of any kind beneath it — the working
 * button lived in a Season settings form that no route renders. So the feature was described in the
 * one place an operator would look for it and available nowhere.
 *
 * ── Why the confirmation is inline rather than a dialog ──────────────────────────────────────────
 * The Settings panel is itself a modal with a focus trap. Opening a second dialog inside it means two
 * traps competing for Tab and two Escape handlers competing for the same key, and the usual result is
 * that Escape closes the wrong one. Expanding in place keeps one trap, one Escape, and one thing on
 * screen — and on a phone it avoids a dialog inside a drawer inside a viewport.
 *
 * ── What the two fields are each for ─────────────────────────────────────────────────────────────
 * They are not redundant. The password proves WHO is asking; the title proves WHAT they are pointing
 * at. The realistic failure here is not a stray click, it is an operator with the wrong Season open —
 * and no amount of re-authentication catches that. Typing the name back is the check that does.
 *
 * Both are verified again on the server, because a disabled button stops nobody who can post a
 * request.
 */
export function SeasonDangerZone({ plan, onDelete }: {
  plan: SeasonDeletionPlan
  onDelete: (input: { password: string; confirmTitle: string }) => Promise<{ ok?: boolean; error?: string; message?: string }>
}) {
  const router = useRouter()
  const [armed, setArmed] = useState(false)
  const [title, setTitle] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const titleId = useId()
  const passwordId = useId()

  /* The same comparison the server makes: trimmed and case-insensitive, so a copied trailing space
     is not treated as a different Season. */
  const titleMatches = title.trim().toLowerCase() === plan.title.trim().toLowerCase()
  const ready = titleMatches && password.length > 0

  const rows: [string, number][] = [
    ['Entrants', plan.counts.entrants],
    ['Groups', plan.counts.groups],
    ['Group placements', plan.counts.groupPlayers],
    ['Group matches', plan.counts.groupMatches],
    ['Playoff matches', plan.counts.playoffMatches],
    ['Standings rows', plan.counts.standings],
    ['Rating ledger entries', plan.counts.ratingLedgerRows],
  ]

  const submit = () => {
    if (!ready) return
    setError(null)
    start(async () => {
      const r = await onDelete({ password, confirmTitle: title })
      if (!r.ok) { setError(r.error ?? 'That could not be deleted.'); return }
      /*
       * Away from a page whose record no longer exists. `refresh()` as well as `push`, because the
       * Creator list is a server component and would otherwise render from cache with the deleted
       * Season still in it.
       */
      router.push('/creator')
      router.refresh()
    })
  }

  const field = 'mt-1 w-full rounded-none border border-border bg-background px-2 py-1.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]'

  return (
    <div className="space-y-3">
      <p className="flex items-start gap-2 text-xs text-destructive">
        <ShieldAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        Permanent deletion removes this Season, every dependent result, its Championship and its
        Rankings contribution. <span className="font-semibold">This cannot be undone.</span>
      </p>

      {!armed ? (
        <button
          type="button"
          onClick={() => setArmed(true)}
          className="inline-flex items-center gap-2 cyber-clip-sm border border-destructive/50 px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-destructive transition-colors hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
        >
          <Trash2 className="size-3.5" aria-hidden />
          Permanently Delete Season
        </button>
      ) : (
        <div className="space-y-3 border border-destructive/40 bg-destructive/[0.04] p-3">
          {/*
            The counts, not a description of them.

            "And all its results" is not something anybody can check against what they meant to do.
            Seeing 2,676 standings rows beside a Season you believed was an empty draft is how the
            wrong record gets caught here rather than afterwards.
          */}
          <div>
            <p className="text-xs font-semibold text-destructive">This will permanently remove:</p>
            <ul className="mt-1.5 space-y-0.5">
              {rows.map(([label, n]) => (
                <li key={label} className="flex items-baseline justify-between gap-3 text-xs">
                  <span className="text-muted-foreground">{label}</span>
                  <span className={cn('tabular font-medium', n > 0 ? 'text-foreground' : 'text-muted-foreground')}>{n}</span>
                </li>
              ))}
            </ul>
            {plan.champion && (
              <p className="mt-2 text-xs text-destructive">
                Its Championship — held by <span className="font-semibold">{plan.champion}</span> — is
                withdrawn, and the Rankings are replayed without this Season.
              </p>
            )}
            {plan.lifecycleState === 'COMPLETED' && !plan.champion && (
              <p className="mt-2 text-xs text-destructive">
                This Season is completed: the Rankings are replayed without it.
              </p>
            )}
          </div>

          <div>
            <label htmlFor={titleId} className="block text-xs text-muted-foreground">
              Type <span className="font-semibold text-foreground">{plan.title}</span> to confirm
            </label>
            <input
              id={titleId} type="text" value={title} spellCheck={false} autoComplete="off"
              onChange={(e) => setTitle(e.target.value)}
              aria-invalid={title.length > 0 && !titleMatches}
              className={cn(field, title.length > 0 && !titleMatches && 'border-destructive/60')}
            />
          </div>

          <div>
            <label htmlFor={passwordId} className="block text-xs text-muted-foreground">
              Your current password
            </label>
            <input
              id={passwordId} type="password" value={password} autoComplete="current-password"
              onChange={(e) => setPassword(e.target.value)}
              className={field}
            />
          </div>

          {error && <p role="alert" className="text-xs text-destructive">{error}</p>}

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={submit}
              disabled={!ready || pending}
              className="inline-flex items-center gap-2 cyber-clip-sm bg-destructive px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-[var(--clean-white)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
            >
              <Trash2 className="size-3.5" aria-hidden />
              {pending ? 'Deleting…' : 'Delete permanently'}
            </button>
            <button
              type="button"
              onClick={() => { setArmed(false); setTitle(''); setPassword(''); setError(null) }}
              disabled={pending}
              className="cyber-clip-sm border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
            >
              Cancel
            </button>
            {/* Says WHY it is disabled, so a stuck button is never a mystery. */}
            {!ready && (
              <span className="text-[0.68rem] text-muted-foreground">
                {!titleMatches ? 'Title must match exactly.' : 'Enter your password.'}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
