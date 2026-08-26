import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

const badgeVariants = cva(
  /*
   * Chips are chamfered rather than pill-shaped, and their colour lives on the border and the text.
   * A filled chip in this palette is a small block of pure neon, which at this size reads as an
   * error state whatever it says.
   */
  'cyber-clip-sm inline-flex items-center gap-1 rounded-none border px-2.5 py-0.5 text-[0.7rem] font-semibold uppercase tracking-wider whitespace-nowrap transition-all duration-200',
  {
    variants: {
      variant: {
        default: 'border-[var(--neon-line)] bg-secondary text-secondary-foreground',
        gold: 'border-[var(--neon-yellow)] bg-transparent text-[var(--neon-yellow)] [text-shadow:var(--glow-yellow)]',
        solid: 'border-transparent bg-primary text-primary-foreground [box-shadow:var(--glow-yellow)]',
        outline: 'border-[var(--neon-line)] text-foreground',
        muted: 'border-transparent bg-muted text-muted-foreground',
        success: 'border-success/50 bg-transparent text-success [text-shadow:0_0_10px_oklch(0.84_0.21_152/0.5)]',
        destructive: 'border-destructive/60 bg-transparent text-destructive [text-shadow:0_0_10px_oklch(0.63_0.26_18/0.5)]',
      },
    },
    defaultVariants: { variant: 'default' },
  },
)

function Badge({
  className,
  variant,
  ...props
}: React.ComponentProps<'span'> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { Badge, badgeVariants }
