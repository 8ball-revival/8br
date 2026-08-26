import * as React from 'react'

import { cn } from '@/lib/utils'

function Table({ className, ...props }: React.ComponentProps<'table'>) {
  return (
    <div className="w-full overflow-x-auto">
      <table className={cn('w-full caption-bottom text-sm', className)} {...props} />
    </div>
  )
}

function TableHeader({ className, ...props }: React.ComponentProps<'thead'>) {
  return <thead className={cn('[&_tr]:border-b [&_tr]:border-[var(--neon-line)]', className)} {...props} />
}

function TableBody({ className, ...props }: React.ComponentProps<'tbody'>) {
  return <tbody className={cn('[&_tr:last-child]:border-0', className)} {...props} />
}

function TableRow({ className, ...props }: React.ComponentProps<'tr'>) {
  return (
    <tr
      className={cn(
        /*
         * Restraint, because this is the component the site is mostly made of.
         *
         * A row used to animate every property and grow an inset cyan rail on hover. Multiplied by
         * sixty rows of standings it was noise, and `transition-all` meant the browser watched
         * properties nothing was changing. A background step is enough to track a row across twelve
         * columns, which is the only thing the hover state is for.
         */
        'border-b border-[var(--line)] transition-colors duration-100',
        'hover:bg-[var(--accent)]',
        className,
      )}
      {...props}
    />
  )
}

function TableHead({ className, ...props }: React.ComponentProps<'th'>) {
  return (
    <th
      className={cn(
        'h-10 px-3 text-left align-middle text-[0.7rem] font-semibold uppercase tracking-wider text-muted-foreground',
        className,
      )}
      {...props}
    />
  )
}

function TableCell({ className, ...props }: React.ComponentProps<'td'>) {
  return <td className={cn('px-3 py-3 align-middle', className)} {...props} />
}

export { Table, TableHeader, TableBody, TableRow, TableHead, TableCell }
