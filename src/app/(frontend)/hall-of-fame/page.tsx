import type { Metadata } from 'next'
import { Trophy } from 'lucide-react'

import { Container } from '@/components/ui/container'
import { PageHeader } from '@/components/page-header'
import { pageMetadata } from '@/lib/site'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { hallOfFame } from '@/lib/mock-data'

export const metadata: Metadata = pageMetadata({
  title: 'Hall of Fame',
  description: 'The most decorated players preserved in the CueVerse competitive archive.',
  path: '/hall-of-fame',
})

export default function HallOfFamePage() {
  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Home', href: '/' }, { label: 'Hall of Fame' }]}
        title="Hall of Fame"
        description="Recognition for sustained excellence. Membership is curated and independent of raw championship totals."
        sample
      />
      <Container className="py-12">
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {hallOfFame.map((h) => (
            <Card key={h.slug} className="h-full">
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Trophy className="size-4 text-gold" aria-hidden />
                  <Badge variant="gold">Inducted {h.inductedYear}</Badge>
                </div>
                <CardTitle className="text-xl">{h.handle}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">{h.citation}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </Container>
    </>
  )
}
