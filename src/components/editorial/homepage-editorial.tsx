import Link from 'next/link'
import { ArrowRight, MessageSquare, ShieldCheck } from 'lucide-react'

import { Wide } from '@/components/primitives'
import { Badge } from '@/components/ui/badge'
import { formatDate } from '@/lib/format'
import { getHomepageEditorial, type ArticleCard } from '@/lib/editorial/queries'

/**
 * The Break, on the homepage.
 *
 * Sits below the banner and above everything else the homepage says about the competition. Each
 * section is optional — turned off by an administrator, or simply empty — and an empty section is
 * hidden rather than shown as a labelled gap. If nothing at all is published, the whole band renders
 * nothing and the homepage reads exactly as it did before The Break existed, which is what a
 * brand-new site needs.
 */
export async function HomepageEditorial() {
  const data = await getHomepageEditorial()
  const { settings } = data

  const featured = settings.showFeatured ? data.featured : null
  const official = settings.showOfficial ? data.official : []
  const predictions = settings.showPredictions ? data.predictions : []
  const community = settings.showCommunity ? data.community : []
  const discussed = settings.showDiscussed ? data.discussed : []

  const anything = featured || data.latest.length || official.length || predictions.length
    || community.length || discussed.length
  if (!anything) return null

  return (
    <section className="border-t border-border py-10 sm:py-14">
      <Wide>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="eyebrow text-gold">The Break</p>
            <h2 className="mt-1 font-display text-2xl font-bold tracking-tight sm:text-3xl">News</h2>
            <p className="mt-1.5 text-sm text-muted-foreground">
              News, predictions, analysis and community stories.
            </p>
          </div>
          <Link href="/news" className="inline-flex items-center gap-1.5 text-sm text-brand hover:underline">
            All articles <ArrowRight className="size-4" aria-hidden />
          </Link>
        </div>

        <div className="mt-7 grid gap-8 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
          <div>
            {featured && <Feature article={featured} />}

            {data.latest.length > 0 && (
              <ul className={featured ? 'mt-6 grid gap-4 sm:grid-cols-2' : 'grid gap-4 sm:grid-cols-2'}>
                {data.latest.map((a) => (
                  <li key={a.id}><Tile article={a} /></li>
                ))}
              </ul>
            )}
          </div>

          <div className="space-y-7">
            <Column title="Official" icon articles={official} />
            <Column title="Predictions" articles={predictions} />
            <Column title="Community" articles={community} />
            <Column title="Most discussed" articles={discussed} showComments />
          </div>
        </div>
      </Wide>
    </section>
  )
}

function Feature({ article }: { article: ArticleCard }) {
  return (
    <article className="group overflow-hidden rounded-none border border-border bg-card/40">
      {article.coverMediaId && (
        <Link href={`/news/${article.slug}`} tabIndex={-1} aria-hidden>
          {/* eslint-disable-next-line @next/next/no-img-element -- Payload media, not a static asset */}
          <img
            src={`/api/media/file/${article.coverMediaId}`}
            alt=""
            className="h-56 w-full object-cover sm:h-64"
          />
        </Link>
      )}
      <div className="p-5">
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          {article.official && <Badge variant="gold">Official</Badge>}
          {article.category && <Badge variant="muted">{article.category.name}</Badge>}
        </div>
        <h3 className="font-display text-xl font-bold leading-tight tracking-tight sm:text-2xl">
          <Link href={`/news/${article.slug}`} className="hover:text-brand">{article.title}</Link>
        </h3>
        {article.excerpt && (
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{article.excerpt}</p>
        )}
        <p className="mt-3 text-xs text-muted-foreground">
          {article.author.handle ?? article.author.name}
          {article.publishAt && <> · {formatDate(article.publishAt.toISOString())}</>}
        </p>
      </div>
    </article>
  )
}

function Tile({ article }: { article: ArticleCard }) {
  return (
    <article className="h-full rounded-none border border-border bg-card/30 p-4 transition-colors hover:border-brand/40">
      {article.category && (
        <p className="mb-1.5 text-[0.7rem] uppercase tracking-wide text-muted-foreground">{article.category.name}</p>
      )}
      <h3 className="text-sm font-semibold leading-snug">
        <Link href={`/news/${article.slug}`} className="hover:text-brand">{article.title}</Link>
      </h3>
      <p className="mt-2 text-xs text-muted-foreground">
        {article.author.handle ?? article.author.name}
        {article.publishAt && <> · {formatDate(article.publishAt.toISOString())}</>}
      </p>
    </article>
  )
}

function Column({
  title, articles, icon, showComments,
}: { title: string; articles: ArticleCard[]; icon?: boolean; showComments?: boolean }) {
  if (articles.length === 0) return null
  return (
    <section>
      <h3 className="mb-2.5 flex items-center gap-1.5 border-b border-border pb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {icon && <ShieldCheck className="size-3.5 text-brand" aria-hidden />}
        {title}
      </h3>
      <ul className="space-y-2.5">
        {articles.map((a) => (
          <li key={a.id}>
            <Link href={`/news/${a.slug}`} className="group block">
              <p className="text-sm leading-snug group-hover:text-brand">{a.title}</p>
              <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span>{a.author.handle ?? a.author.name}</span>
                {showComments && a.commentCount > 0 && (
                  <span className="inline-flex items-center gap-1">
                    <MessageSquare className="size-3" aria-hidden />{a.commentCount}
                  </span>
                )}
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
