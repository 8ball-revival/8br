'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, ShieldBan, Clock, Trash2, RotateCcw, TriangleAlert } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useConfirm } from '@/components/ui/confirm-dialog'
import {
  warnMemberAction,
  timeoutMemberAction,
  banMemberAction,
  removePenaltyAction,
  deleteAccountAction,
  restoreMemberAction,
  purgeAccountAction,
  type ModResult,
} from '@/lib/moderation/actions'

type Status = 'ACTIVE' | 'TIMED_OUT' | 'BANNED' | 'DELETED'

const FIELD = 'w-full rounded-md border border-input bg-background px-3 py-2 text-sm'

export function MemberModeration({
  userId,
  status,
  activePenaltyId,
  activePenaltyType,
  activeRegistrations,
  canDelete,
  canPurge,
  ipAvailable,
}: {
  userId: number
  status: Status
  activePenaltyId: number | null
  activePenaltyType: 'TIMEOUT' | 'BAN' | null
  activeRegistrations: { tournament: string; status: string }[]
  /** Owner-only: soft-delete + restore an account. */
  canDelete: boolean
  canPurge: boolean
  ipAvailable: boolean
}) {
  const router = useRouter()
  const confirm = useConfirm()
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState<{ ok?: boolean; text: string } | null>(null)

  const go = (fn: () => Promise<ModResult>) => {
    setMsg(null)
    start(async () => {
      const r = await fn()
      if (r.error) setMsg({ text: r.error })
      else { setMsg({ ok: true, text: r.ipShared ? 'Done — note: the IP looked shared/VPN, so IP-protection is weak here.' : 'Done.' }); router.refresh() }
    })
  }

  // Destructive moderation actions confirm through the WCC modal (danger tone, explicit click — never
  // an Enter keypress). `confirmText` becomes the modal message; absence runs immediately.
  const run = (fn: () => Promise<ModResult>, confirmText?: string) => {
    if (!confirmText) { go(fn); return }
    void confirm({ title: 'Confirm this action?', message: confirmText, confirmLabel: 'Confirm', cancelLabel: 'Cancel', tone: 'danger' }).then((res) => { if (res.confirmed) go(fn) })
  }

  return (
    <div className="space-y-5">
      {msg && (
        <p role="status" className={`rounded-md border px-3 py-2 text-sm ${msg.ok ? 'border-success/40 bg-success/10 text-success' : 'border-destructive/40 bg-destructive/10 text-destructive'}`}>
          {msg.text}
        </p>
      )}

      <WithdrawPreview regs={activeRegistrations} />

      {status !== 'DELETED' && <WarningCard userId={userId} run={run} pending={pending} />}

      {status === 'ACTIVE' && (
        <>
          <TimeoutCard userId={userId} run={run} pending={pending} />
          <BanCard userId={userId} run={run} pending={pending} ipAvailable={ipAvailable} />
        </>
      )}

      {status === 'TIMED_OUT' && activePenaltyId != null && (
        <ModCard icon={Clock} title="Timed out" tone="warning">
          <p className="text-sm text-muted-foreground">This member is timed out. Remove it early to restore eligibility immediately.</p>
          <Button variant="outline" size="sm" disabled={pending} onClick={() => run(() => removePenaltyAction(activePenaltyId, userId, 'Timeout removed early by staff'), 'Remove this timeout now and restore the member?')}>
            Remove timeout
          </Button>
        </ModCard>
      )}

      {status === 'TIMED_OUT' && <BanCard userId={userId} run={run} pending={pending} ipAvailable={ipAvailable} />}

      {status === 'BANNED' && activePenaltyId != null && activePenaltyType === 'BAN' && (
        <ModCard icon={ShieldBan} title="Banned" tone="destructive">
          <p className="text-sm text-muted-foreground">Login and registration are blocked. Unban to restore account access.</p>
          <Button variant="outline" size="sm" disabled={pending} onClick={() => run(() => removePenaltyAction(activePenaltyId, userId, 'Ban lifted by staff'), 'Lift this ban and restore account access?')}>
            Unban
          </Button>
        </ModCard>
      )}

      {status !== 'DELETED' && canDelete && <DeleteCard userId={userId} run={run} pending={pending} regCount={activeRegistrations.length} />}

      {status === 'DELETED' && (
        <ModCard icon={RotateCcw} title="Deleted account" tone="muted">
          <p className="text-sm text-muted-foreground">
            Soft-deleted. The Player profile and all history are preserved.
            {canDelete ? ' You can restore the account.' : ' Only the Owner can restore or purge it.'}
          </p>
          {(canDelete || canPurge) && (
            <div className="flex flex-wrap gap-2">
              {canDelete && (
                <Button variant="outline" size="sm" disabled={pending} onClick={() => run(() => restoreMemberAction(userId, 'Account restored by staff'), 'Restore this account to ACTIVE?')}>
                  Restore account
                </Button>
              )}
              {canPurge && <PurgeButton userId={userId} run={run} pending={pending} />}
            </div>
          )}
        </ModCard>
      )}
    </div>
  )
}

function WithdrawPreview({ regs }: { regs: { tournament: string; status: string }[] }) {
  if (regs.length === 0) return null
  return (
    <div className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/[0.06] px-3 py-2 text-xs text-muted-foreground">
      <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
      <span>A Timeout, Ban, or Delete will withdraw <strong className="text-foreground">{regs.length}</strong> active registration{regs.length > 1 ? 's' : ''}: {regs.map((r) => r.tournament).join(', ')}. Completed competitions are never affected.</span>
    </div>
  )
}

function ModCard({ icon: Icon, title, tone, children }: { icon: typeof Clock; title: string; tone: 'warning' | 'destructive' | 'muted' | 'default'; children: React.ReactNode }) {
  const border = tone === 'destructive' ? 'border-destructive/30' : tone === 'warning' ? 'border-warning/30' : 'border-border'
  return (
    <div className={`space-y-3 rounded-lg border ${border} bg-card/40 p-4`}>
      <h3 className="flex items-center gap-2 text-sm font-semibold"><Icon className="size-4 text-muted-foreground" aria-hidden /> {title}</h3>
      {children}
    </div>
  )
}

function WarningCard({ userId, run, pending }: { userId: number; run: (fn: () => Promise<ModResult>) => void; pending: boolean }) {
  const [reason, setReason] = useState('')
  const [notes, setNotes] = useState('')
  return (
    <ModCard icon={AlertTriangle} title="Add warning" tone="default">
      <p className="text-xs text-muted-foreground">History only — no penalty. Internal notes are staff-visible only.</p>
      <Input placeholder="Reason (required)" value={reason} onChange={(e) => setReason(e.target.value)} />
      <textarea className={FIELD} rows={2} placeholder="Internal notes (optional, private)" value={notes} onChange={(e) => setNotes(e.target.value)} />
      <Button size="sm" disabled={pending || !reason.trim()} onClick={() => run(async () => { const r = await warnMemberAction(userId, reason, notes || undefined); if (!r.error) { setReason(''); setNotes('') } return r })}>
        Add warning
      </Button>
    </ModCard>
  )
}

const PRESETS: { label: string; hours: number }[] = [
  { label: '1 hour', hours: 1 },
  { label: '24 hours', hours: 24 },
  { label: '3 days', hours: 72 },
  { label: '7 days', hours: 168 },
  { label: '30 days', hours: 720 },
]

function TimeoutCard({ userId, run, pending }: { userId: number; run: (fn: () => Promise<ModResult>, confirm?: string) => void; pending: boolean }) {
  const [hours, setHours] = useState<number>(24)
  const [custom, setCustom] = useState('')
  const [reason, setReason] = useState('')
  // Relative preview only — no clock is read during render (server validates the exact end).
  const preview = custom ? custom.replace('T', ' ') : `${PRESETS.find((p) => p.hours === hours)?.label ?? `${hours}h`} from now`
  const canApply = !!reason.trim() && (custom ? !!custom : true)
  // The exact end time is computed at click time (event handler — allowed to read the clock).
  const computeUntil = () => (custom ? new Date(custom) : new Date(Date.now() + hours * 3600_000))
  return (
    <ModCard icon={Clock} title="Apply timeout" tone="warning">
      <p className="text-xs text-muted-foreground">Blocks tournament signup and withdraws active participation. Expires automatically.</p>
      <div className="flex flex-wrap gap-1.5">
        {PRESETS.map((p) => (
          <button key={p.hours} type="button" onClick={() => { setHours(p.hours); setCustom('') }} className={`rounded-md border px-2.5 py-1 text-xs ${!custom && hours === p.hours ? 'border-brand bg-brand/10 text-brand' : 'border-border text-muted-foreground hover:bg-muted'}`}>{p.label}</button>
        ))}
      </div>
      <label className="block text-xs text-muted-foreground">Or custom end: <input type="datetime-local" value={custom} onChange={(e) => setCustom(e.target.value)} className={`${FIELD} mt-1`} /></label>
      <Input placeholder="Reason (required)" value={reason} onChange={(e) => setReason(e.target.value)} />
      <p className="text-xs text-muted-foreground">Expires: <span className="text-foreground">{preview}</span></p>
      <Button variant="outline" size="sm" disabled={pending || !canApply}
        onClick={() => { const u = computeUntil(); run(async () => { const r = await timeoutMemberAction(userId, u.toISOString(), reason); if (!r.error) setReason(''); return r }, `Apply a timeout until ${u.toLocaleString()}? This withdraws the member's active registrations.`) }}>
        Apply timeout
      </Button>
    </ModCard>
  )
}

function BanCard({ userId, run, pending, ipAvailable }: { userId: number; run: (fn: () => Promise<ModResult>, confirm?: string) => void; pending: boolean; ipAvailable: boolean }) {
  const [reason, setReason] = useState('')
  const [useIp, setUseIp] = useState(false)
  return (
    <ModCard icon={ShieldBan} title="Ban account" tone="destructive">
      <p className="text-xs text-muted-foreground">Blocks login + registration and withdraws active participation. Permanent until removed.</p>
      <Input placeholder="Reason (required)" value={reason} onChange={(e) => setReason(e.target.value)} />
      {ipAvailable ? (
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input type="checkbox" checked={useIp} onChange={(e) => setUseIp(e.target.checked)} className="size-4 rounded border-input accent-brand" />
          Also store a hashed IP identifier (secondary safeguard). Shared/VPN IPs are flagged and never the sole gate.
        </label>
      ) : (
        <p className="text-xs text-muted-foreground italic">IP-protection unavailable — no trustworthy server IP in this environment.</p>
      )}
      <Button variant="destructive" size="sm" disabled={pending || !reason.trim()}
        onClick={() => run(async () => { const r = await banMemberAction(userId, reason, useIp); if (!r.error) setReason(''); return r }, 'Ban this account? Login and registration will be blocked and active registrations withdrawn.')}>
        Ban account
      </Button>
    </ModCard>
  )
}

function DeleteCard({ userId, run, pending, regCount }: { userId: number; run: (fn: () => Promise<ModResult>, confirm?: string) => void; pending: boolean; regCount: number }) {
  const [reason, setReason] = useState('')
  return (
    <ModCard icon={Trash2} title="Delete account (soft)" tone="destructive">
      <p className="text-xs text-muted-foreground">The Player profile and all completed history <strong className="text-foreground">remain</strong> (the profile is unlinked). {regCount} active registration{regCount === 1 ? '' : 's'} will be withdrawn. This is reversible via Restore.</p>
      <Input placeholder="Reason (required)" value={reason} onChange={(e) => setReason(e.target.value)} />
      <Button variant="destructive" size="sm" disabled={pending || !reason.trim()}
        onClick={() => run(async () => { const r = await deleteAccountAction(userId, reason); if (!r.error) setReason(''); return r }, 'Soft-delete this account? The profile/history are preserved; active registrations are withdrawn.')}>
        Delete account
      </Button>
    </ModCard>
  )
}

function PurgeButton({ userId, run, pending }: { userId: number; run: (fn: () => Promise<ModResult>, confirm?: string) => void; pending: boolean }) {
  const [reason, setReason] = useState('')
  return (
    <div className="w-full space-y-2 rounded-md border border-destructive/40 bg-destructive/[0.06] p-3">
      <p className="text-xs font-medium text-destructive">Owner only — permanent purge (hard delete the account). Player + history remain; this cannot be undone.</p>
      <Input placeholder="Reason (required)" value={reason} onChange={(e) => setReason(e.target.value)} />
      <Button variant="destructive" size="sm" disabled={pending || !reason.trim()}
        onClick={() => run(() => purgeAccountAction(userId, reason), 'PERMANENTLY delete this Payload account? This cannot be undone. The Player profile and history remain.')}>
        Permanently delete
      </Button>
    </div>
  )
}
