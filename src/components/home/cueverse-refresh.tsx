'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { RefreshCw } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { formatDateTime } from '@/lib/format'
import { refreshCueVerseAction } from '@/lib/cueverse/actions'

/**
 * Manual refresh of the CueVerse leaderboard mirror.
 *
 * The scheduled job runs daily; this exists for an administrator who wants the current figures now.
 * The action re-checks the capability itself, so this control reflects a permission rather than
 * granting one.
 */
export function CueVerseRefreshPanel({
  fetchedAt, entries, stale,
}: { fetchedAt: string | null; entries: number; stale: boolean }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [message, setMessage] = useState<{ ok?: boolean; text: string } | null>(null)

  const refresh = () => {
    setMessage(null)
    start(async () => {
      const r = await refreshCueVerseAction()
      if (r.error) setMessage({ text: r.error })
      else { setMessage({ ok: true, text: r.message ?? 'Updated.' }); router.refresh() }
    })
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">CueVerse leaderboard:</span>
        {fetchedAt ? (
          <>
            <Badge variant={stale ? 'muted' : 'success'}>{entries} players</Badge>
            <span className="text-xs text-muted-foreground">
              last updated {formatDateTime(fetchedAt)}
            </span>
            {stale && <Badge variant="muted">stale</Badge>}
          </>
        ) : (
          <Badge variant="muted">no snapshot yet</Badge>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        Refreshed automatically once a day at 03:00 Phoenix time. A failed refresh keeps the last good
        snapshot rather than replacing it with nothing.
      </p>

      {message && (
        <p
          role="status"
          className={`rounded-md border px-3 py-2 text-sm ${message.ok ? 'border-success/40 bg-success/10 text-success' : 'border-destructive/40 bg-destructive/10 text-destructive'}`}
        >
          {message.text}
        </p>
      )}

      <Button size="sm" variant="outline" disabled={pending} onClick={refresh}>
        <RefreshCw className={`size-4 ${pending ? 'motion-safe:animate-spin' : ''}`} aria-hidden />
        {pending ? 'Refreshing…' : 'Refresh now'}
      </Button>
    </div>
  )
}
