'use client'

import { useEffect } from 'react'
import Link from 'next/link'

import { Container } from '@/components/ui/container'
import { Button } from '@/components/ui/button'

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <Container className="flex min-h-[60vh] flex-col items-center justify-center py-20 text-center">
      <p className="eyebrow text-destructive">Something went wrong</p>
      <h1 className="mt-4 font-display text-4xl font-bold tracking-tight sm:text-5xl">
        An unexpected error occurred
      </h1>
      <p className="mt-4 max-w-md text-muted-foreground">
        The page failed to load. You can try again, or head back to the homepage.
      </p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Button onClick={reset}>Try again</Button>
        <Button asChild variant="outline">
          <Link href="/">Back to home</Link>
        </Button>
      </div>
    </Container>
  )
}
