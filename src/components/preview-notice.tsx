'use client'

import { usePathname } from 'next/navigation'
import { TriangleAlert } from 'lucide-react'

/**
 * Banner making it unmistakable that a page shows temporary sample data, not final
 * historical records. Scoped to the historical ARCHIVE routes only — the Season 2
 * launch pages (home, groups, playoffs, seasons, register, account, rules) present
 * real, honest state and must not be labelled "sample data".
 */
const SAMPLE_PREFIXES = ['/players', '/competitions', '/rankings', '/hall-of-fame', '/news', '/search']

export function PreviewNotice() {
  const pathname = usePathname()
  const showsSample = SAMPLE_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + '/'))
  if (!showsSample) return null

  return (
    <div className="border-b border-gold/25 bg-gold/[0.06] text-gold">
      <div className="mx-auto flex max-w-6xl items-center justify-center gap-2 px-4 py-1.5 text-center text-xs">
        <TriangleAlert className="size-3.5 shrink-0" aria-hidden />
        <span>
          Archive preview — this page shows <strong className="font-semibold">temporary sample data</strong>,
          not final 8 Ball Revival records.
        </span>
      </div>
    </div>
  )
}
