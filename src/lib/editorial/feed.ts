import 'server-only'
import { prisma } from '@/lib/prisma'
import { absoluteUrl, brandName, SITE_URL } from '@/lib/site'
import { publishedWhere } from './service'
import { sanitizeDocument, documentToPlainText } from './richtext'

/**
 * RSS and Atom for The Break.
 *
 * The feeds carry titles, excerpts and links — not article bodies. A feed reader that renders full
 * content would have to be trusted to escape it, and the article page is where the writing is meant
 * to be read anyway.
 *
 * XML is assembled by hand rather than with a library: the escaping rule is four characters long and
 * applied at exactly one place, which is easier to be sure of than a dependency.
 */

export const FEED_LIMIT = 30

/** Escape text for XML content and attributes. The only escaping in this file. */
export function xmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    // A control character is not legal in XML at all, and would make the whole document unparseable.
    // eslint-disable-next-line no-control-regex -- deliberately matching control characters
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
}

export interface FeedItem {
  title: string
  slug: string
  excerpt: string
  publishAt: Date
  updatedAt: Date
  author: string
  categoryName: string | null
}

/** The most recent published articles, in the shape both feeds need. */
export async function feedItems(limit = FEED_LIMIT): Promise<FeedItem[]> {
  const rows = await prisma.article.findMany({
    where: publishedWhere(),
    orderBy: [{ publishAt: 'desc' }],
    take: limit,
    select: {
      title: true, slug: true, excerpt: true, body: true, publishAt: true, updatedAt: true,
      authorNameSnapshot: true, authorHandleSnapshot: true,
      authorPlayer: { select: { primaryName: true, cueverseId: true } },
      category: { select: { name: true } },
    },
  })

  return rows.map((r) => ({
    title: r.title,
    slug: r.slug,
    excerpt: r.excerpt || documentToPlainText(sanitizeDocument(r.body)).slice(0, 300),
    publishAt: r.publishAt!,
    updatedAt: r.updatedAt,
    author: r.authorPlayer?.cueverseId ?? r.authorHandleSnapshot ?? r.authorPlayer?.primaryName ?? r.authorNameSnapshot,
    categoryName: r.category?.name ?? null,
  }))
}

const DESCRIPTION = `News, predictions, analysis and community stories from ${brandName}.`

export function renderRss(items: FeedItem[]): string {
  const latest = items[0]?.publishAt ?? new Date()
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${xmlEscape(`The Break · ${brandName}`)}</title>
    <link>${xmlEscape(absoluteUrl('/news'))}</link>
    <description>${xmlEscape(DESCRIPTION)}</description>
    <language>en</language>
    <lastBuildDate>${latest.toUTCString()}</lastBuildDate>
    <atom:link href="${xmlEscape(absoluteUrl('/news/feed.xml'))}" rel="self" type="application/rss+xml"/>
${items.map(rssItem).join('\n')}
  </channel>
</rss>
`
}

function rssItem(item: FeedItem): string {
  const url = absoluteUrl(`/news/${item.slug}`)
  return `    <item>
      <title>${xmlEscape(item.title)}</title>
      <link>${xmlEscape(url)}</link>
      <guid isPermaLink="true">${xmlEscape(url)}</guid>
      <pubDate>${item.publishAt.toUTCString()}</pubDate>
      <description>${xmlEscape(item.excerpt)}</description>
      <dc:creator xmlns:dc="http://purl.org/dc/elements/1.1/">${xmlEscape(item.author)}</dc:creator>${
  item.categoryName ? `\n      <category>${xmlEscape(item.categoryName)}</category>` : ''}
    </item>`
}

export function renderAtom(items: FeedItem[]): string {
  const latest = items[0]?.updatedAt ?? new Date()
  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>${xmlEscape(`The Break · ${brandName}`)}</title>
  <subtitle>${xmlEscape(DESCRIPTION)}</subtitle>
  <link href="${xmlEscape(absoluteUrl('/news/atom.xml'))}" rel="self"/>
  <link href="${xmlEscape(absoluteUrl('/news'))}"/>
  <id>${xmlEscape(`${SITE_URL}/news`)}</id>
  <updated>${latest.toISOString()}</updated>
${items.map(atomEntry).join('\n')}
</feed>
`
}

function atomEntry(item: FeedItem): string {
  const url = absoluteUrl(`/news/${item.slug}`)
  return `  <entry>
    <title>${xmlEscape(item.title)}</title>
    <link href="${xmlEscape(url)}"/>
    <id>${xmlEscape(url)}</id>
    <published>${item.publishAt.toISOString()}</published>
    <updated>${item.updatedAt.toISOString()}</updated>
    <author><name>${xmlEscape(item.author)}</name></author>
    <summary>${xmlEscape(item.excerpt)}</summary>
  </entry>`
}
