'use client'
import { useTransition } from 'react'
import { Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { exportMembersAction, exportSeasonsAction, exportTournamentsAction, exportRankingsAction, type ExportResult } from '@/lib/staff/export-actions'
import { exportActivityCsvAction } from '@/lib/staff/activity-actions'

function download(r: ExportResult) {
  if (!r.ok || !r.csv) return
  const blob = new Blob([r.csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href = url; a.download = r.filename ?? 'export.csv'; a.click(); URL.revokeObjectURL(url)
}

export function ExportButtons() {
  const [pending, start] = useTransition()
  const run = (fn: () => Promise<ExportResult>) => start(async () => download(await fn()))
  return (
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" size="sm" disabled={pending} onClick={() => run(exportMembersAction)}><Download className="size-4" /> Members</Button>
      <Button variant="outline" size="sm" disabled={pending} onClick={() => run(exportSeasonsAction)}><Download className="size-4" /> Seasons</Button>
      <Button variant="outline" size="sm" disabled={pending} onClick={() => run(exportTournamentsAction)}><Download className="size-4" /> Tournaments</Button>
      <Button variant="outline" size="sm" disabled={pending} onClick={() => run(exportRankingsAction)}><Download className="size-4" /> Rankings</Button>
      <Button variant="outline" size="sm" disabled={pending} onClick={() => run(() => exportActivityCsvAction({ includeAutomated: true }))}><Download className="size-4" /> Activity Log</Button>
    </div>
  )
}
