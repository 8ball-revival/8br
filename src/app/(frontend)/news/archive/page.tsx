import type { Metadata } from 'next'
import Link from 'next/link'

import { pageMetadata } from '@/lib/site'
import { NewsShell, NewsEmpty } from '@/components/editorial/news-shell'
import { listArchiveMonths, listCategories, getModerationQueue } from '@/lib/editorial/queries'
import { currentEditorialActor } from '@/lib/editorial/permissions'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = pageMetadata({
  title: 'Archive · News',
  description: 'Every month of The Break, the 8 Ball Registry news section.',
  path: '/news/archive',
})

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

export default async function ArchiveIndexPage() {
  const actor = await currentEditorialActor()
  const [months, categories] = await Promise.all([listArchiveMonths(), listCategories(false)])
  const queue = actor?.isAdmin ? await getModerationQueue() : null

  // Group by year so a long archive reads as a timeline rather than one very long list.
  const byYear = new Map<number, { month: number; count: number }[]>()
  for (const m of months) {
    const list = byYear.get(m.year) ?? []
    list.push({ month: m.month, count: m.count })
    byYear.set(m.year, list)
  }

  return (
    <NewsShell
      chrome={{ categories, canWrite: actor != null, isAdmin: !!actor?.isAdmin, pendingCount: queue?.total }}
      heading="Archive"
      lede="Everything published, by month."
    >
      {months.length === 0 ? (
        <div className="mt-8"><NewsEmpty message="Nothing has been published yet." /></div>
      ) : (
        <div className="mt-8 space-y-8">
          {[...byYear.entries()].map(([year, list]) => (
            <section key={year}>
              <h2 className="mb-3 border-b border-border pb-2 font-display text-lg font-bold tracking-tight">
                <Link href={`/news/archive/${year}`} className="hover:text-brand">{year}</Link>
              </h2>
              <ul className="flex flex-wrap gap-2">
                {list.map((m) => (
                  <li key={m.month}>
                    <Link
                      href={`/news/archive/${year}/${String(m.month).padStart(2, '0')}`}
                      className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground hover:border-brand/40 hover:text-foreground"
                    >
                      {MONTHS[m.month - 1]}
                      <span className="text-xs opacity-60">{m.count}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </NewsShell>
  )
}
