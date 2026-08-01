import Link from 'next/link'
import { Megaphone, BookOpen, Trophy, Award, type LucideIcon } from 'lucide-react'

import { Panel } from '@/components/home/primitives'
import type { NewsItem } from '@/lib/home/fixtures'

const KIND: Record<NewsItem['kind'], { icon: LucideIcon; color: string }> = {
  registration: { icon: Megaphone, color: 'text-gold' },
  rulebook: { icon: BookOpen, color: 'text-[var(--chart-2)]' },
  cup: { icon: Trophy, color: 'text-[var(--chart-3)]' },
  hof: { icon: Award, color: 'text-[var(--chart-5)]' },
}

export function NewsPanel({ items }: { items: NewsItem[] }) {
  return (
    <Panel title="News & Announcements" actionLabel="View all" actionHref="/news" bodyClassName="p-0">
      <ul className="divide-y divide-border">
        {items.map((n) => {
          const k = KIND[n.kind]
          const Icon = k.icon
          return (
            <li key={n.id}>
              <Link href={n.href} className="flex gap-3 px-4 py-3 transition-colors hover:bg-muted/40">
                <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-secondary">
                  <Icon className={`size-4 ${k.color}`} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-foreground">{n.title}</p>
                  <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{n.blurb}</p>
                  <p className="mt-1 text-[0.65rem] text-muted-foreground/80">{n.ago}</p>
                </div>
              </Link>
            </li>
          )
        })}
      </ul>
    </Panel>
  )
}
