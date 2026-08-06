import Link from 'next/link'
import { AlertTriangle } from 'lucide-react'

import { Button } from '@/components/ui/button'

/**
 * ProfileCompletionNotice — shown in place of an editable signup form when a signed-in
 * member cannot enter because their linked profile is missing or incomplete. Directs them
 * to complete their profile (never an editable competition identity form).
 */
export function ProfileCompletionNotice({
  reason,
  missing,
}: {
  reason?: string
  missing?: string[]
}) {
  return (
    <div className="flex items-start gap-3 rounded-md border border-warning/40 bg-warning/10 px-4 py-3 text-sm">
      <AlertTriangle className="mt-0.5 size-5 shrink-0 text-warning" aria-hidden />
      <div>
        <p className="font-medium text-foreground">Complete your profile to enter</p>
        <p className="mt-1 text-muted-foreground">
          {reason ?? 'Your player profile needs a few details before you can join competitions.'}
          {missing && missing.length > 0 && <> Missing: {missing.join(', ')}.</>}
        </p>
        <Button asChild size="sm" className="mt-3">
          <Link href="/account">Complete profile</Link>
        </Button>
      </div>
    </div>
  )
}
