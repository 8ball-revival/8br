import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

const buttonVariants = cva(
  /*
   * Every button is chamfered. The corner cut is the small one: buttons sit inline with text, and
   * the large notch reads as damage at this size.
   *
   * The hover sweep was removed from the base. A light streak crossing every control on the page —
   * including the ones inside dense tables — is motion for its own sake, and it competed with the
   * data. Buttons now answer a cursor with colour and edge alone, which is quieter and reads faster.
   */
  "cyber-clip-sm inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-none text-sm font-medium transition-all duration-200 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none aria-invalid:ring-destructive/20 aria-invalid:border-destructive",
  {
    variants: {
      variant: {
        /*
         * The signature action: the acid surface with black ink.
         *
         * No glow. A yellow halo around a yellow button adds nothing on a dark page and, on a page
         * that already carries acid navigation and an acid feature panel, it turns the one control
         * that should stand out into more of the same. Brightness on hover is the whole response.
         */
        default:
          'bg-primary font-semibold uppercase tracking-wider text-primary-foreground hover:bg-[var(--acid-hover)]',
        /*
         * Destructive stays red and stays obviously separate from everything else, per the rule that
         * a destructive control must never be mistakable for a routine one.
         */
        destructive:
          'bg-destructive font-semibold uppercase tracking-wider text-[var(--clean-white)] hover:brightness-110',
        /* The common case: a hairline that warms to cyan on approach. */
        outline:
          'border border-[var(--line-strong)] bg-transparent text-foreground hover:border-[var(--cyan)] hover:text-[var(--cyan)]',
        secondary:
          'border border-[var(--line)] bg-secondary text-secondary-foreground hover:border-[var(--line-strong)] hover:text-[var(--cyan)]',
        ghost: 'hover:bg-accent hover:text-[var(--cyan)]',
        link: 'text-[var(--cyan)] underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-9 px-4 py-2 has-[>svg]:px-3',
        sm: 'h-8 gap-1.5 px-3 has-[>svg]:px-2.5',
        lg: 'h-10 px-6 has-[>svg]:px-4',
        xl: 'h-12 px-8 text-base has-[>svg]:px-6',
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
