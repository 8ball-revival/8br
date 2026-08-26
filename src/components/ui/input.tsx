import * as React from 'react'

import { cn } from '@/lib/utils'

function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      type={type}
      className={cn(
        'cyber-clip-sm flex h-9 w-full rounded-none border border-[var(--neon-line)] bg-[var(--surface)] px-3 py-1 text-sm transition-all duration-200',
        'placeholder:text-muted-foreground/70',
        'hover:border-[var(--neon-cyan)]/60',
        'focus-visible:border-[var(--neon-cyan)] focus-visible:outline-none focus-visible:[box-shadow:var(--glow-cyan)]',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  )
}

export { Input }
