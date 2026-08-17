'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { GitMerge, Trash2, Undo2 } from 'lucide-react'

import { cn } from '@/lib/utils'
import type { MergeCandidate, MergedAccountRow } from '@/lib/players/merge'
import type { DeletionPlan } from '@/lib/players/merge-actions'
import {
  searchMergeCandidatesAction,
  checkMergeAction,
  mergeAccountsAction,
  undoMergeAction,
  deleteAccountSafelyAction,
} from '@/lib/players/merge-actions'

const input =
  'w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/25'

/**
 * Account Actions — merge and delete, at the bottom of the member Overview.
 *
 * This component only decides what to SHOW. Every rule (who may act, which merges are legal,
 * whether a delete archives or removes) is enforced again in the server actions, so a stale dialog
 * or a hand-crafted request cannot get past them.
 */
export function AccountActions({
  userId,
  playerId,
  displayName,
  merged,
  deletionPlan,
  canMerge,
  canDelete,
}: {
  userId: number
  playerId: string | null
  displayName: string
  merged: MergedAccountRow[]
  deletionPlan: DeletionPlan | null
  canMerge: boolean
  canDelete: boolean
}) {
  if (!canMerge && !canDelete) return null
  return (
    <section className="mt-8 rounded-lg border border-border bg-card/40 p-5">
      <p className="eyebrow text-brand">Account Actions</p>
      <div className="mt-4 space-y-6">
        {canMerge && <MergePanel userId={userId} playerId={playerId} displayName={displayName} merged={merged} />}
        {canDelete && deletionPlan && <DeletePanel userId={userId} plan={deletionPlan} />}
      </div>
    </section>
  )
}

// --------------------------------------------------------------------------- merge

function MergePanel({
  userId,
  playerId,
  displayName,
  merged,
}: {
  userId: number
  playerId: string | null
  displayName: string
  merged: MergedAccountRow[]
}) {
  const router = useRouter()
  const [q, setQ] = useState('')
  const [results, setResults] = useState<MergeCandidate[]>([])
  const [picked, setPicked] = useState<MergeCandidate | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function search(term: string) {
    setQ(term)
    setPicked(null)
    setError(null)
    if (!playerId || term.trim().length < 2) return setResults([])
    setResults(await searchMergeCandidatesAction(playerId, term))
  }

  async function choose(c: MergeCandidate) {
    setError(null)
    if (!playerId) return
    const res = await checkMergeAction(playerId, c.playerId)
    if (res.error) return setError(res.error)
    setPicked(c)
  }

  async function confirmMerge() {
    if (!playerId || !picked) return
    setBusy(true)
    const res = await mergeAccountsAction(playerId, picked.playerId, userId)
    setBusy(false)
    if (res.error) return setError(res.error)
    setPicked(null)
    setQ('')
    setResults([])
    router.refresh()
  }

  async function undo(mergeId: string) {
    setBusy(true)
    const res = await undoMergeAction(mergeId, userId)
    setBusy(false)
    if (res.error) return setError(res.error)
    router.refresh()
  }

  return (
    <div>
      <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <GitMerge className="size-4 text-brand" aria-hidden /> Merge Account
      </h3>

      {!playerId ? (
        <p className="mt-2 text-xs text-muted-foreground">
          This account has no linked player profile, so it cannot take part in a merge.
        </p>
      ) : (
        <>
          <p className="mt-1 text-xs text-muted-foreground">
            <strong className="text-foreground">{displayName}</strong> is always the primary account
            and keeps its login, email and identity. The account you choose becomes a secondary: its
            login is disabled and its history is shown under this profile. Nothing is deleted, and
            the merge can be undone.
          </p>

          <input
            value={q}
            onChange={(e) => void search(e.target.value)}
            placeholder="Search for an account to merge in…"
            className={cn(input, 'mt-3 max-w-sm')}
            aria-label="Search accounts to merge"
          />

          {results.length > 0 && !picked && (
            <ul className="mt-2 max-w-sm divide-y divide-border rounded-md border border-border">
              {results.map((r) => (
                <li key={r.playerId}>
                  <button
                    type="button"
                    onClick={() => void choose(r)}
                    className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-accent"
                  >
                    <span>{r.cueverseId ?? r.primaryName}</span>
                    <span className="text-xs text-muted-foreground">select</span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {picked && (
            <div className="mt-3 max-w-xl rounded-md border border-brand/40 bg-brand/[0.06] p-4">
              <p className="text-sm font-semibold text-foreground">Confirm merge</p>
              <dl className="mt-2 space-y-1 text-xs">
                <div className="flex gap-2">
                  <dt className="w-40 text-muted-foreground">Primary (kept)</dt>
                  <dd className="font-semibold text-foreground">{displayName}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="w-40 text-muted-foreground">Secondary (merged in)</dt>
                  <dd className="font-semibold text-foreground">{picked.cueverseId ?? picked.primaryName}</dd>
                </div>
              </dl>
              <p className="mt-2 text-[0.7rem] text-muted-foreground">
                The secondary&apos;s login will be disabled and its profile hidden from Players lists.
                Its results roll up under {displayName}. Reversible at any time.
              </p>
              <div className="mt-3 flex gap-2">
                <button type="button" onClick={confirmMerge} disabled={busy} className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-50">
                  {busy ? 'Merging…' : 'Merge accounts'}
                </button>
                <button type="button" onClick={() => setPicked(null)} disabled={busy} className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold">
                  Cancel
                </button>
              </div>
            </div>
          )}

          {merged.length > 0 && (
            <div className="mt-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Merged accounts ({merged.length})
              </p>
              <ul className="mt-2 max-w-xl divide-y divide-border rounded-md border border-border">
                {merged.map((m) => (
                  <li key={m.mergeId} className="flex items-center justify-between gap-3 px-3 py-2">
                    <span className="text-sm text-foreground">
                      {m.cueverseId ?? m.primaryName}
                      <span className="ml-2 text-xs text-muted-foreground">
                        merged {new Date(m.mergedAt).toLocaleDateString()}
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() => void undo(m.mergeId)}
                      disabled={busy}
                      className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs font-semibold hover:bg-accent disabled:opacity-50"
                    >
                      <Undo2 className="size-3.5" aria-hidden /> Undo Merge
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      {error && (
        <p role="alert" className="mt-3 max-w-xl rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}

// --------------------------------------------------------------------------- delete

function DeletePanel({ userId, plan }: { userId: number; plan: DeletionPlan }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const permanent = plan.outcome === 'permanent'

  async function run() {
    setBusy(true)
    setError(null)
    const res = await deleteAccountSafelyAction(userId, typed)
    setBusy(false)
    if (res.error) return setError(res.error)
    router.push('/staff/members')
    router.refresh()
  }

  return (
    <div className="border-t border-border pt-5">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-destructive">
        <Trash2 className="size-4" aria-hidden /> Delete Account
      </h3>

      {plan.blockedReason ? (
        <p className="mt-2 max-w-xl rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          {plan.blockedReason}
        </p>
      ) : (
        <>
          <p className="mt-1 max-w-xl text-xs text-muted-foreground">
            {permanent ? (
              <>
                This account has <strong className="text-foreground">no dependent records</strong>, so
                it will be <strong className="text-destructive">permanently deleted</strong>. This
                cannot be undone.
              </>
            ) : (
              <>
                This account has historical data, so it will be{' '}
                <strong className="text-foreground">archived and hidden</strong> rather than deleted —
                its competition history is preserved and the account can be restored.
              </>
            )}
          </p>

          {!permanent && plan.dependencies.length > 0 && (
            <ul className="mt-2 flex max-w-xl flex-wrap gap-x-4 gap-y-1 text-[0.7rem] text-muted-foreground">
              {plan.dependencies.map((d) => (
                <li key={d.label}>
                  {d.label}: <span className="tabular-nums text-foreground">{d.count}</span>
                </li>
              ))}
            </ul>
          )}

          {!open ? (
            <button type="button" onClick={() => setOpen(true)} className="mt-3 rounded-md border border-destructive/50 px-3 py-1.5 text-xs font-semibold text-destructive hover:bg-destructive/10">
              {permanent ? 'Permanently delete…' : 'Archive account…'}
            </button>
          ) : (
            <div className="mt-3 max-w-xl rounded-md border border-destructive/40 bg-destructive/[0.06] p-4">
              <p className="text-xs text-foreground">
                Type <strong className="font-mono">{plan.confirmName}</strong> to confirm.
              </p>
              <input
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                autoFocus
                aria-label="Type the account name to confirm"
                className={cn(input, 'mt-2 max-w-xs')}
              />
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={run}
                  disabled={busy || typed.trim() !== plan.confirmName}
                  className="rounded-md bg-destructive px-3 py-1.5 text-xs font-semibold text-destructive-foreground disabled:opacity-40"
                >
                  {busy ? 'Working…' : permanent ? 'Permanently delete' : 'Archive account'}
                </button>
                <button type="button" onClick={() => { setOpen(false); setTyped('') }} disabled={busy} className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold">
                  Cancel
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {error && (
        <p role="alert" className="mt-3 max-w-xl rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
