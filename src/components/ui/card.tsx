import * as React from 'react'

import { cn } from '@/lib/utils'

function Card({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card"
      className={cn(
        /* The recurring panel: chamfered, hairline edge, with the corner bracket from cyber-panel. */
        'cyber-panel cyber-clip rounded-none text-card-foreground transition-colors duration-150',
        /*
         * The edge brightens; nothing glows.
         *
         * Every card used to throw a cyan halo on hover. On a page of eight cards that is eight
         * light sources competing with the content, and on a card that is not interactive it
         * promises a click that does not exist. A border change says "you are here" for free.
         */
        'hover:border-[var(--line-strong)]',
        className,
      )}
      {...props}
    />
  )
}

function CardHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('flex flex-col gap-1 p-5', className)} {...props} />
}

function CardTitle({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('font-display text-base font-semibold tracking-tight', className)} {...props} />
}

function CardDescription({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('text-sm text-muted-foreground', className)} {...props} />
}

function CardContent({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('p-5 pt-0', className)} {...props} />
}

function CardFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('flex items-center p-5 pt-0', className)} {...props} />
}

export { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter }
