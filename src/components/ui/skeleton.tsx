import { cn } from '@/lib/utils'

/** Loading placeholder. Pair with role="status" containers for accessibility. */
export function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('animate-pulse rounded-md bg-muted', className)} {...props} />
}
