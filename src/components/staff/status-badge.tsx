import type { MemberStatus } from '@prisma/client'

import { Badge } from '@/components/ui/badge'

/** Shared member-status pill: Active / Timed Out / Banned / Deleted. */
export function StatusBadge({ status }: { status: MemberStatus }) {
  switch (status) {
    case 'ACTIVE':
      return <Badge variant="success">Active</Badge>
    case 'TIMED_OUT':
      return <Badge variant="outline" className="border-warning/40 text-warning">Timed Out</Badge>
    case 'BANNED':
      return <Badge variant="destructive">Banned</Badge>
    case 'DELETED':
      return <Badge variant="muted">Deleted</Badge>
    default:
      return <Badge variant="muted">{status}</Badge>
  }
}
