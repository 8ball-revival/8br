'use client'

import { useEffect, useRef } from 'react'

/**
 * Records that this article was read.
 *
 * Fires once, after the page is interactive, and renders nothing. Doing it here rather than during
 * the server render means a router prefetch does not count as a read, a crawler does not count as a
 * read, and the endpoint can set the cookie that suppresses repeat views — which a server component
 * cannot do.
 *
 * Failures are swallowed on purpose: a missed count is not worth telling the reader about.
 */
export function ViewCounter({ articleId }: { articleId: number }) {
  const sent = useRef(false)

  useEffect(() => {
    // React runs effects twice in development; the ref keeps that from double-counting.
    if (sent.current) return
    sent.current = true

    const timer = window.setTimeout(() => {
      void fetch('/api/news/view', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ articleId }),
        keepalive: true,
      }).catch(() => {})
    }, 1500) // a page closed within a second or two was not read

    return () => window.clearTimeout(timer)
  }, [articleId])

  return null
}
