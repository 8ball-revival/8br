'use client'

import { useMemo, useState, useTransition } from 'react'
import { Download, RefreshCw, Ban, RotateCcw, KeyRound } from 'lucide-react'

import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import * as A from '@/lib/accounts/actions'
import type { InitialRoster } from '@/lib/accounts/roster'
import type { GenerateResult, ProvisionedAccount } from '@/lib/accounts/provisioning'

export function AccountProvisioning({ accounts }: { accounts: ProvisionedAccount[] }) {
  const [roster, setRoster] = useState<InitialRoster | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [generated, setGenerated] = useState<GenerateResult['created']>([])
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [codeReveals, setCodeReveals] = useState<Record<number, string>>({})
  const [pending, start] = useTransition()

  const loadRoster = () =>
    start(async () => {
      const r = await A.previewRosterAction()
      setRoster(r)
      setSelected(new Set(r.players.filter((p) => p.canGenerate).map((p) => p.playerId)))
      setMsg(null)
    })

  const toggle = (id: string) =>
    setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })

  const generate = () =>
    start(async () => {
      const r = await A.generateAccountsAction([...selected])
      if (r.error) return setMsg({ ok: false, text: r.error })
      setGenerated(r.created)
      setMsg({ ok: true, text: `Created ${r.created.length} account(s); skipped ${r.skipped.length}. Codes are shown once below — export them now.` })
    })

  const enroll = () =>
    start(async () => {
      const r = await A.enrollSeason2Action([...selected])
      setMsg(r.error ? { ok: false, text: r.error } : { ok: true, text: r.message ?? 'Enrolled.' })
    })

  const exportCsv = () => {
    const rows = [['Player', 'Login ID', 'Claim Code', 'Expiration'], ...generated.map((c) => [c.primaryName, c.loginId, c.code, c.expiresAt.slice(0, 10)])]
    const csv = rows.map((r) => r.map((f) => `"${String(f).replace(/"/g, '""')}"`).join(',')).join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    const a = document.createElement('a')
    a.href = url; a.download = 'claim-codes.csv'; a.click()
    URL.revokeObjectURL(url)
  }

  const regenerate = (userId: number) =>
    start(async () => {
      const r = await A.regenerateClaimCodeAction(userId)
      if (r.error || !r.code) return setMsg({ ok: false, text: r.error ?? 'Failed.' })
      setCodeReveals((m) => ({ ...m, [userId]: r.code! }))
      setMsg({ ok: true, text: 'New code generated — copy it now; it is shown once.' })
    })

  const toggleDisabled = (userId: number, disabled: boolean) =>
    start(async () => {
      const r = await A.setAccountDisabledAction(userId, disabled)
      setMsg(r.error ? { ok: false, text: r.error } : { ok: true, text: r.message ?? 'Done.' })
    })

  const selectedGeneratable = useMemo(
    () => (roster ? roster.players.filter((p) => selected.has(p.playerId) && p.canGenerate).length : 0),
    [roster, selected],
  )

  return (
    <div className="space-y-8">
      {msg && (
        <div className={cn('rounded-md border px-3 py-2 text-sm', msg.ok ? 'border-gold/30 bg-gold/[0.06] text-foreground' : 'border-destructive/40 bg-destructive/[0.06] text-destructive')}>
          {msg.text}
        </div>
      )}

      {/* ---- Initial roster ---- */}
      <section>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-display text-lg font-semibold">Initial account roster</h2>
          <Button variant="secondary" size="sm" onClick={loadRoster} disabled={pending}>{roster ? 'Reload roster' : 'Preview roster'}</Button>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">Players from 2026 Season 1, DBT8, 602 Invitational, and the Creampuff Classic. Review before generating accounts.</p>

        {roster && (
          <div className="mt-4 space-y-4">
            <div className="flex flex-wrap gap-2 text-xs">
              <Badge variant="muted">{roster.counts.resolved} resolved</Badge>
              <Badge variant="gold">{roster.counts.generatable} can generate</Badge>
              <Badge variant="muted">{roster.counts.alreadyHaveAccounts} already have accounts</Badge>
              <Badge variant="destructive">{roster.counts.unresolved} unresolved (manual review)</Badge>
            </div>

            <div className="max-h-80 overflow-y-auto rounded-md border border-border">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-card text-left text-xs text-muted-foreground">
                  <tr><th className="w-8 p-2"></th><th className="p-2">CueVerse ID</th><th className="p-2">Player</th><th className="p-2">Competitions</th><th className="p-2">Status</th></tr>
                </thead>
                <tbody>
                  {roster.players.map((p) => (
                    <tr key={p.playerId} className="border-t border-border">
                      <td className="p-2"><input type="checkbox" checked={selected.has(p.playerId)} disabled={p.alreadyHasAccount} onChange={() => toggle(p.playerId)} /></td>
                      <td className="p-2 font-medium">{p.cueverseId}</td>
                      <td className="p-2 text-muted-foreground">{p.primaryName}</td>
                      <td className="p-2 text-xs text-muted-foreground">{p.competitions.join(', ')}</td>
                      <td className="p-2">{p.alreadyHasAccount ? <span className="text-xs text-muted-foreground">has account</span> : <span className="text-xs text-gold">ready</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button onClick={generate} disabled={pending || selectedGeneratable === 0}>Generate {selectedGeneratable} account(s)</Button>
              <Button variant="secondary" onClick={enroll} disabled={pending || selected.size === 0}>Enroll {selected.size} into Season 2</Button>
            </div>

            {roster.unresolved.length > 0 && (
              <details className="rounded-md border border-border p-3">
                <summary className="cursor-pointer text-sm font-medium text-foreground">Unresolved / manual review ({roster.unresolved.length})</summary>
                <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                  {roster.unresolved.map((u, i) => (
                    <li key={i}>{u.name}{u.handle && u.handle !== u.name ? ` (${u.handle})` : ''} — {u.competitions.join(', ')} · {u.reason === 'no-cueverse-id' ? 'no CueVerse ID' : 'unresolved'}</li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}
      </section>

      {/* ---- Generated codes (shown once) ---- */}
      {generated.length > 0 && (
        <section className="rounded-lg border border-gold/40 bg-gold/[0.05] p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-display text-lg font-semibold">Claim codes — shown once</h2>
            <Button size="sm" onClick={exportCsv}><Download className="size-4" /> Download CSV</Button>
          </div>
          <div className="mt-3 max-h-64 overflow-y-auto rounded-md border border-border bg-background">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground"><tr><th className="p-2">Player</th><th className="p-2">Login ID</th><th className="p-2">Claim code</th><th className="p-2">Expires</th></tr></thead>
              <tbody>
                {generated.map((c) => (
                  <tr key={c.playerId} className="border-t border-border">
                    <td className="p-2">{c.primaryName}</td><td className="p-2 font-medium">{c.loginId}</td><td className="p-2 font-mono">{c.code}</td><td className="p-2 text-muted-foreground">{c.expiresAt.slice(0, 10)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ---- Provisioned accounts ---- */}
      <section>
        <h2 className="font-display text-lg font-semibold">Provisioned accounts ({accounts.length})</h2>
        {accounts.length === 0 ? (
          <p className="mt-1 text-sm text-muted-foreground">No accounts generated yet.</p>
        ) : (
          <div className="mt-3 overflow-x-auto rounded-md border border-border">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr><th className="p-2">Login ID</th><th className="p-2">Player</th><th className="p-2">Status</th><th className="p-2">Email</th><th className="p-2">Claimed</th><th className="p-2">Actions</th></tr>
              </thead>
              <tbody>
                {accounts.map((a) => (
                  <tr key={a.userId} className={cn('border-t border-border', a.disabled && 'opacity-50')}>
                    <td className="p-2 font-medium">{a.loginId}</td>
                    <td className="p-2 text-muted-foreground">{a.playerName}</td>
                    <td className="p-2">
                      <Badge variant={a.status === 'CLAIMED' ? 'gold' : 'muted'}>{a.status.toLowerCase()}</Badge>
                      {a.disabled && <Badge variant="destructive" className="ml-1">disabled</Badge>}
                    </td>
                    <td className="p-2 text-xs">{a.emailAdded ? <span className="text-gold">added</span> : <span className="text-muted-foreground">missing</span>}</td>
                    <td className="p-2 text-xs text-muted-foreground">{a.claimedAt ? a.claimedAt.slice(0, 10) : '—'}</td>
                    <td className="p-2">
                      <div className="flex flex-wrap items-center gap-1">
                        {a.status === 'UNCLAIMED' && (
                          <Button size="sm" variant="ghost" onClick={() => regenerate(a.userId)} disabled={pending}><RefreshCw className="size-3.5" /> Code</Button>
                        )}
                        <Button size="sm" variant="ghost" onClick={() => toggleDisabled(a.userId, !a.disabled)} disabled={pending}>
                          {a.disabled ? <><RotateCcw className="size-3.5" /> Restore</> : <><Ban className="size-3.5" /> Disable</>}
                        </Button>
                        {codeReveals[a.userId] && <span className="font-mono text-xs text-gold"><KeyRound className="mr-1 inline size-3" />{codeReveals[a.userId]}</span>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
