'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Wand2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { convertLegacyCupAction } from '@/lib/competition/cup-actions'

/**
 * Owner/Admin-only. Shown on a legacy (old-format, read-only) cup. Converts it in place
 * into the editable workspace, preserving all history. Disappears once converted.
 */
export function ConvertLegacyBanner({ seasonId }: { seasonId: number }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const convert = () =>
    start(async () => {
      setError(null)
      const r = await convertLegacyCupAction(seasonId)
      if (r.error) return setError(r.error)
      router.refresh() // page now renders as an editable competition
    })

  return (
    <div className="mt-6 rounded-xl border border-gold/40 bg-gold/[0.06] p-4">
      <div className="flex flex-wrap items-center gap-3">
        <Badge variant="gold" className="gap-1"><Wand2 className="size-3.5" aria-hidden /> Admin</Badge>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">This competition uses the old, non-editable format.</p>
          <p className="text-xs text-muted-foreground">
            Convert it into the editable workspace to manage entrants, edit the remaining matches, correct scores, and advance
            players — every completed result, score, bye and bracket position is preserved exactly. This happens once.
          </p>
        </div>
        <Button onClick={convert} disabled={pending}>
          {pending ? 'Converting…' : 'Convert Legacy Competition'}
        </Button>
      </div>
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
    </div>
  )
}
