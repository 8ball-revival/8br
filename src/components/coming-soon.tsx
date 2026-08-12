import Link from 'next/link'
import { ArrowLeft, Construction } from 'lucide-react'

import { Container } from '@/components/ui/container'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

/**
 * Shared placeholder for routes whose full page isn't built yet. Lets us wire the
 * final navigation/site architecture now without dead links.
 */
export function ComingSoon({ title, description }: { title: string; description?: string }) {
  return (
    <Container className="flex min-h-[60vh] flex-col items-center justify-center py-24 text-center">
      <span className="mb-6 flex size-16 items-center justify-center rounded-full bg-brand/10 ring-1 ring-brand/20">
        <Construction className="size-7 text-brand" />
      </span>
      <Badge variant="default" className="mb-4">
        Coming Soon
      </Badge>
      <h1 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">{title}</h1>
      {description && <p className="mt-3 max-w-md text-muted-foreground">{description}</p>}
      <Button asChild variant="outline" className="mt-8">
        <Link href="/">
          <ArrowLeft className="size-4" />
          Back to home
        </Link>
      </Button>
    </Container>
  )
}
