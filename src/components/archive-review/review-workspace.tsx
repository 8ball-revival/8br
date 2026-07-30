'use client'

import { useState, useTransition } from 'react'

import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { IssueDetail } from '@/components/archive-review/issue-detail'
import { DecisionForm } from '@/components/archive-review/decision-form'
import { saveBatchDecision, type BatchResult } from '@/lib/archive-review/actions'
import type { ReviewCategoryConfig } from '@/lib/archive-review/config'

/* eslint-disable @typescript-eslint/no-explicit-any */
interface Props {
  category: string
  issues: any[]
  categoryConfig: ReviewCategoryConfig
  statuses: string[]
  batchActions: { key: string; label: string }[]
}

export function ReviewWorkspace({ category, issues, categoryConfig, statuses, batchActions }: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [batchAction, setBatchAction] = useState(batchActions[0]?.key ?? '')
  const [note, setNote] = useState('')
  const [reason, setReason] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [result, setResult] = useState<BatchResult | null>(null)
  const [pending, startTransition] = useTransition()

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  function runBatch() {
    startTransition(async () => {
      const res = await saveBatchDecision({ category, batchAction, note, reviewerReason: reason, issueIds: [...selected] })
      setResult(res)
      if (res.ok) {
        setSelected(new Set())
        setConfirming(false)
        setNote('')
        setReason('')
      }
    })
  }

  return (
    <div>
      {/* Batch bar */}
      {batchActions.length > 0 && (
        <Card className="mb-5 border-gold/30 p-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="text-sm">
              <span className="font-semibold">{selected.size}</span> selected
            </div>
            <label className="text-sm">
              <span className="mb-1 block text-xs text-muted-foreground">Batch action</span>
              <select value={batchAction} onChange={(e) => setBatchAction(e.target.value)} className="h-9 rounded-md border border-input bg-background px-2 text-sm">
                {batchActions.map((a) => (
                  <option key={a.key} value={a.key}>{a.label}</option>
                ))}
              </select>
            </label>
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Reviewer note (required)" className="w-64" />
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (optional)" className="w-48" />
            <Button size="sm" disabled={selected.size === 0 || !note.trim() || pending} onClick={() => setConfirming(true)}>
              Apply to selected
            </Button>
            {selected.size > 0 && (
              <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear</Button>
            )}
            {result?.ok && <Badge variant="success">Batch {result.count} applied ({result.batchId})</Badge>}
            {result?.error && <span className="text-xs text-destructive">{result.error}</span>}
          </div>

          {confirming && (
            <div className="mt-3 rounded-md border border-border bg-background/60 p-3 text-sm">
              <p className="font-medium">Confirm batch action</p>
              <p className="mt-1 text-muted-foreground">
                Apply <span className="text-foreground">{batchActions.find((a) => a.key === batchAction)?.label}</span> to{' '}
                <span className="text-foreground">{selected.size}</span> {category} issue{selected.size === 1 ? '' : 's'}. One decision is
                recorded per issue with a shared batch id; each keeps its own history and is reversible via a new decision.
              </p>
              <div className="mt-3 flex gap-2">
                <Button size="sm" disabled={pending} onClick={runBatch}>{pending ? 'Applying…' : 'Confirm'}</Button>
                <Button size="sm" variant="outline" onClick={() => setConfirming(false)}>Cancel</Button>
              </div>
            </div>
          )}
          <p className="mt-2 text-xs text-muted-foreground">
            Safe batch actions only. Merges, score/winner corrections, evidence-required upgrades, and disputed-note publication are never batchable.
          </p>
        </Card>
      )}

      {/* Issues */}
      <div className="space-y-4">
        {issues.length === 0 && <p className="text-sm text-muted-foreground">No issues match.</p>}
        {issues.map((issue) => (
          <Card key={issue.issueId} className="p-5">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <label className="flex min-w-0 items-start gap-2">
                <input type="checkbox" checked={selected.has(issue.issueId)} onChange={() => toggle(issue.issueId)} className="mt-1" aria-label={`Select ${issue.issueId}`} />
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-2">
                    <Badge variant={issue.severity === 'high' ? 'destructive' : issue.severity === 'info' ? 'muted' : 'outline'}>{issue.severity}</Badge>
                    <span className="tabular text-xs text-muted-foreground">{issue.issueId}</span>
                  </span>
                  <span className="mt-1 block text-sm">{issue.reason}</span>
                </span>
              </label>
              {issue.decision && (
                <div className="text-right text-xs">
                  <Badge variant={['approved', 'resolved'].includes(issue.decision.status) ? 'success' : 'muted'}>{issue.decision.status}</Badge>
                  <div className="mt-1 text-muted-foreground">
                    v{issue.decision.version} · {issue.historyCount} in history{issue.decision.batchId ? ' · batch' : ''}
                  </div>
                </div>
              )}
            </div>

            <IssueDetail enriched={issue.enriched} />

            <DecisionForm
              issueId={issue.issueId}
              category={issue.category}
              relatedIds={issue.relatedIds}
              categoryConfig={categoryConfig}
              statuses={statuses}
              current={issue.decision ? { resolution: issue.decision.resolution, status: issue.decision.status, note: issue.decision.note } : null}
            />
          </Card>
        ))}
      </div>
    </div>
  )
}
/* eslint-enable @typescript-eslint/no-explicit-any */
