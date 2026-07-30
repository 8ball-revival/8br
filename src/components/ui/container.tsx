import { cn } from '@/lib/utils'

/** Standard page width + horizontal padding. Used by every section for alignment. */
export function Container({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8', className)} {...props} />
}
