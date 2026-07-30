import { Search } from 'lucide-react'

import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

/**
 * Global search field. A native GET form that submits to /search?q=… — works
 * without any client-side JavaScript (Enter or the browser submits it). On the
 * results page, pass `defaultValue` to prefill the current query. This is a plain
 * shared component (no hooks), so it renders in both server and client contexts.
 */
export function SearchBar({
  className,
  defaultValue,
}: {
  className?: string
  defaultValue?: string
}) {
  return (
    <form role="search" action="/search" method="get" className={cn('relative', className)}>
      <Search
        className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
      <Input
        type="search"
        name="q"
        defaultValue={defaultValue}
        placeholder="Search players, seasons…"
        aria-label="Search players, aliases, seasons, and competitions"
        className="pl-8"
      />
    </form>
  )
}
