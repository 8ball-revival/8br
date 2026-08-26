import Link from 'next/link'

import { Container } from '@/components/ui/container'
import { Button } from '@/components/ui/button'

export default function NotFound() {
  return (
    <Container className="flex min-h-[60vh] flex-col items-center justify-center py-20 text-center">
      <p className="eyebrow neon-text-magenta neon-pulse">Error 404</p>
      {/* The signal has genuinely failed here, so the wordmark is allowed to break up. */}
      <h1
        className="glitch mt-4 font-display text-6xl font-bold uppercase tracking-tight text-gold neon-text sm:text-7xl"
        data-text="Off the table"
      >
        Off the table
      </h1>
      <p className="mt-4 max-w-md text-muted-foreground">
        The page you’re looking for doesn’t exist or hasn’t been built yet.
      </p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Button asChild>
          <Link href="/">Back to home</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/seasons">Browse seasons</Link>
        </Button>
      </div>
    </Container>
  )
}
