import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

const buttonVariants = cva(
  /*
   * Every button is chamfered and sweeps once on hover.
   *
   * `cyber-sweep` is on the base rather than per variant so a ghost button and a primary button
   * answer a cursor the same way — the thing that makes a set of controls feel like one system. The
   * corner cut is the small one: buttons sit inline with text, and the large notch reads as damage
   * at this size.
   */
  "cyber-sweep cyber-clip-sm inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-none text-sm font-medium transition-all duration-200 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none aria-invalid:ring-destructive/20 aria-invalid:border-destructive",
  {
    variants: {
      variant: {
        /* The signature action: solid yellow with dark ink, throwing its own light. */
        default:
          'bg-primary font-semibold uppercase tracking-wider text-primary-foreground [box-shadow:var(--glow-yellow)] hover:brightness-110 hover:[box-shadow:0_0_6px_oklch(0.9_0.19_100/0.7),0_0_26px_oklch(0.9_0.19_100/0.4)]',
        destructive:
          'bg-destructive font-semibold uppercase tracking-wider text-destructive-foreground [box-shadow:0_0_4px_oklch(0.63_0.26_18/0.5),0_0_18px_oklch(0.63_0.26_18/0.28)] hover:brightness-110',
        /* The common case: a lit hairline that warms to cyan on approach. */
        outline:
          'border border-[var(--neon-line)] bg-transparent text-foreground hover:border-[var(--neon-cyan)] hover:text-[var(--neon-cyan)] hover:[box-shadow:var(--glow-cyan)]',
        secondary:
          'border border-[var(--neon-line)] bg-secondary text-secondary-foreground hover:border-[var(--neon-cyan)] hover:[box-shadow:var(--glow-soft)]',
        ghost: 'hover:bg-accent hover:text-[var(--neon-cyan)]',
        link: 'text-[var(--neon-cyan)] underline-offset-4 hover:underline hover:[text-shadow:var(--glow-cyan)]',
      },
      size: {
        default: 'h-9 px-4 py-2 has-[>svg]:px-3',
        sm: 'h-8 rounded-md gap-1.5 px-3 has-[>svg]:px-2.5',
        lg: 'h-10 rounded-md px-6 has-[>svg]:px-4',
        xl: 'h-12 rounded-md px-8 text-base has-[>svg]:px-6',
        icon: 'size-9',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot : 'button'

  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
