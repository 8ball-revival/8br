'use client'

import { useActionState, useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { saveDecision, type SaveResult } from '@/lib/archive-review/actions'
import { resolutionLabel, statusLabel, type ReviewCategoryConfig } from '@/lib/archive-review/config'
import { cn } from '@/lib/utils'

interface Props {
  issueId: string
  category: string
  relatedIds: string[]
  categoryConfig: ReviewCategoryConfig
  statuses: string[]
  current: { resolution?: string; status?: string; note?: string | null } | null
}

const initial: SaveResult = { ok: false }

export function DecisionForm({ issueId, category, relatedIds, categoryConfig, statuses, current }: Props) {
  const [state, formAction, pending] = useActionState(saveDecision, initial)
  const [resolution, setResolution] = useState(current?.resolution ?? categoryConfig.resolutions[0])
  const [dirty, setDirty] = useState(false)

  const needsEvidence =
    (categoryConfig.correctionResolutions?.includes(resolution) ?? false) ||
    (categoryConfig.evidenceResolutions?.includes(resolution) ?? false)
  const isCorrection = categoryConfig.correctionResolutions?.includes(resolution) ?? false

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (dirty && !pending) {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [dirty, pending])

  return (
    <form
      action={formAction}
      onChange={() => setDirty(true)}
      onSubmit={() => setDirty(false)}
      className="mt-4 space-y-3 rounded-md border border-border bg-background/40 p-4"
    >
      <input type="hidden" name="issueId" value={issueId} />
      <input type="hidden" name="category" value={category} />
      <input type="hidden" name="relatedIds" value={relatedIds.join(',')} />

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">
          <span className="mb-1 block text-xs font-medium text-muted-foreground">Resolution</span>
          <select
            name="resolution"
            value={resolution}
            onChange={(e) => setResolution(e.target.value)}
            className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
          >
            {categoryConfig.resolutions.map((r) => (
              <option key={r} value={r}>
                {resolutionLabel(r)}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs font-medium text-muted-foreground">Status</span>
          <select name="status" defaultValue={current?.status ?? 'pending'} className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm">
            {statuses.map((s) => (
              <option key={s} value={s}>
                {statusLabel(s)}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="block text-sm">
        <span className="mb-1 block text-xs font-medium text-muted-foreground">
          Reviewer note {isCorrection && <span className="text-gold">(required for corrections)</span>}
        </span>
        <textarea name="note" defaultValue={current?.note ?? ''} rows={2} className="w-full rounded-md border border-input bg-background p-2 text-sm" />
      </label>

      {needsEvidence && (
        <div className="space-y-2 rounded-md border border-gold/30 bg-gold/[0.04] p-3">
          <p className="text-xs font-medium text-gold">Evidence required — cite a source. Original values are preserved.</p>
          <Input name="source" placeholder="Source reference (file:row, URL, or citation)" />
          {isCorrection && (
            <div className="grid grid-cols-2 gap-2">
              <Input name="replacementA" type="number" placeholder="Replacement score A" />
              <Input name="replacementB" type="number" placeholder="Replacement score B" />
            </div>
          )}
        </div>
      )}

      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? 'Saving…' : 'Save decision'}
        </Button>
        {state.ok && !dirty && <Badge variant="success">Saved</Badge>}
        {dirty && !pending && <span className="text-xs text-muted-foreground">Unsaved changes</span>}
        {state.error && <span className={cn('text-xs text-destructive')}>{state.error}</span>}
      </div>
    </form>
  )
}
