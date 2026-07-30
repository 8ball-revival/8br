import Link from 'next/link'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import type { NewsItem } from '@/lib/mock-data'
import { formatDate } from '@/lib/format'

export function NewsCard({ item, featured = false }: { item: NewsItem; featured?: boolean }) {
  return (
    <Link href={`/news/${item.slug}`} className="group block h-full">
      <Card className="h-full transition-colors group-hover:border-gold/40">
        <CardHeader>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Badge variant="muted">{item.category}</Badge>
            <time dateTime={item.date}>{formatDate(item.date)}</time>
          </div>
          <CardTitle
            className={featured ? 'text-xl transition-colors group-hover:text-gold' : 'transition-colors group-hover:text-gold'}
          >
            {item.title}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{item.excerpt}</p>
        </CardContent>
      </Card>
    </Link>
  )
}
