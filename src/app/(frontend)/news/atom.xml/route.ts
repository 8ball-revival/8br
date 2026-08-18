import { feedItems, renderAtom } from '@/lib/editorial/feed'

/** /news/atom.xml — the same content as the RSS feed, in Atom. */
export const dynamic = 'force-dynamic'

export async function GET() {
  const body = renderAtom(await feedItems())
  return new Response(body, {
    headers: {
      'content-type': 'application/atom+xml; charset=utf-8',
      'cache-control': 'public, max-age=300, s-maxage=300',
    },
  })
}
