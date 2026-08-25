'use client'

import { useId, useState, type ReactNode } from 'react'

import { cn } from '@/lib/utils'

/**
 * A tooltip that works from the keyboard.
 *
 * The `title` attribute is not enough here. It appears on hover and, in every current browser, not
 * on keyboard focus — so a reader tabbing through twenty-five column headers would be told nothing
 * at all, which is precisely the reader who most needs "MP" spelled out.
 *
 * So the trigger owns real state: it opens on hover AND on focus, closes on blur, leave and Escape,
 * and is wired to the bubble with `aria-describedby` so a screen reader announces the explanation
 * as part of the control rather than as loose text somewhere on the page.
 *
 * `title` is deliberately NOT also set — a native tooltip and this one would both appear, stacked.
 */
export function Tip({
  text, children, className, side = 'bottom', asChild = false,
}: {
  text: string
  children: ReactNode
  className?: string
  side?: 'top' | 'bottom'
  /** Render the trigger as a plain span rather than a button, for use inside another control. */
  asChild?: boolean
}) {
  const id = useId()
  const [open, setOpen] = useState(false)

  const handlers = {
    onMouseEnter: () => setOpen(true),
    onMouseLeave: () => setOpen(false),
    onFocus: () => setOpen(true),
    onBlur: () => setOpen(false),
    onKeyDown: (e: React.KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) },
  }

  const Trigger = asChild ? 'span' : 'button'

  return (
    <span className={cn('relative inline-flex', className)}>
      <Trigger
        {...(asChild ? {} : { type: 'button' as const })}
        tabIndex={0}
        aria-describedby={open ? id : undefined}
        className="inline-flex items-center gap-1 rounded outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]/60"
        {...handlers}
      >
        {children}
      </Trigger>
      {open && (
        <span
          role="tooltip"
          id={id}
          className={cn(
            'pointer-events-none absolute left-1/2 z-50 w-64 -translate-x-1/2 rounded-md border border-border',
            'bg-popover px-2.5 py-1.5 text-left text-xs font-normal normal-case leading-snug text-popover-foreground shadow-xl',
            side === 'bottom' ? 'top-full mt-1.5' : 'bottom-full mb-1.5',
          )}
        >
          {text}
        </span>
      )}
    </span>
  )
}

/**
 * The same explanation attached to a small information affordance rather than to a label — for
 * places where the thing being explained is a value, not a heading.
 */
export function InfoTip({ text, label }: { text: string; label: string }) {
  return (
    <Tip text={text}>
      <span aria-label={label} className="grid size-4 place-items-center rounded-full border border-border text-[0.6rem] font-bold text-muted-foreground">
        i
      </span>
    </Tip>
  )
}
