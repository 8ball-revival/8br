import { Container } from '@/components/ui/container'
import { Skeleton } from '@/components/ui/skeleton'

export default function Loading() {
  return (
    <div role="status" aria-label="Loading">
      <div className="border-b border-border bg-card/30">
        <Container className="py-10">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="mt-4 h-10 w-72" />
          <Skeleton className="mt-3 h-4 w-96 max-w-full" />
        </Container>
      </div>
      <Container className="py-12">
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-40 w-full" />
          ))}
        </div>
      </Container>
    </div>
  )
}
