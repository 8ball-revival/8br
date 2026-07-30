'use client'

import { useActionState } from 'react'

import { Button } from '@/components/ui/button'
import type { ActionResult } from '@/lib/competition/actions'

type Action = (prev: ActionResult, fd: FormData) => Promise<ActionResult>
type Variant = 'default' | 'outline' | 'secondary' | 'ghost' | 'destructive'

/**
 * One-click staff action: a tiny form that posts fixed fields to a server action,
 * with inline pending + error feedback. Optional `confirm` gates destructive edits.
 */
export function ActionButton({
  action,
  fields,
  label,
  variant = 'default',
  size = 'sm',
  confirm,
  className,
}: {
  action: Action
  fields: Record<string, string | number>
  label: string
  variant?: Variant
  size?: 'sm' | 'default' | 'lg'
  confirm?: string
  className?: string
}) {
  const [state, formAction, pending] = useActionState(action, {})
  return (
    <form
      action={formAction}
      className="inline-flex items-center gap-2"
      onSubmit={confirm ? (e) => { if (!window.confirm(confirm)) e.preventDefault() } : undefined}
    >
      {Object.entries(fields).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={String(v)} />
      ))}
      <Button type="submit" variant={variant} size={size} disabled={pending} className={className}>
        {pending ? '…' : label}
      </Button>
      {state?.error && <span className="text-xs text-destructive">{state.error}</span>}
    </form>
  )
}
