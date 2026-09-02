import { withPayload } from '@payloadcms/next/withPayload'
import type { NextConfig } from 'next'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(__filename)

const nextConfig: NextConfig = {
  /*
   * How large a Server Action's body may be.
   *
   * Unset, Next allows 1 MB and rejects anything larger by throwing INSIDE the framework, which a
   * component cannot catch: an avatar over 1 MB took the whole page down to the error boundary
   * rather than returning a message. Avatars arrive through a Server Action, so this is the number
   * that decides whether an upload is possible at all.
   *
   * It matches `UPLOAD_MAX_BYTES` in src/lib/media/limits.ts, which is where the reasoning lives and
   * which also feeds the validator and the sentence shown to the reader. Not written as an import:
   * this config is read before the app's module graph exists.
   */
  experimental: {
    serverActions: { bodySizeLimit: '4mb' },
  },
  /*
   * Where the build is written, overridable for local verification only.
   *
   * A production build and `next dev` both own `.next`, so building to check a change meant first
   * stopping the dev server — which on this machine also stops the contained Postgres it was
   * launched with. Unset (every deploy, and every ordinary `npm run build`) this is exactly the
   * default, so nothing about a real build changes.
   *
   * One thing to expect when you do use it: Next rewrites tsconfig.json's `include` to add the
   * chosen directory's generated types. That edit is not wanted in a commit — discard it with
   * `git checkout tsconfig.json` once the build has been checked.
   */
  distDir: process.env.NEXT_DIST_DIR || '.next',

  /*
   * Origins the DEV server will serve its client bootstrap to.
   *
   * ── What this fixes, and why it was so hard to see ──────────────────────────────────────────────
   * Next 15.2 began treating a dev request whose origin is not the canonical one as cross-origin and
   * refusing it the development client assets. The canonical origin here is `localhost:3000`, so
   * opening the very same server on `http://127.0.0.1:3000` produced a page that was completely
   * correct and completely dead: the HTML rendered, the inline scripts ran, the RSC flight payload
   * arrived in full — and hydration never completed, because the dev bootstrap and its HMR socket
   * were blocked. No console error, no failed request, nothing in the overlay. Every control was
   * visible and none of them worked.
   *
   * The two are genuinely the same machine, and a developer typing either one expects the same site,
   * so both are allowed. The LAN address is included because `next dev` prints it as the Network URL
   * and inviting somebody to open a URL that cannot work is its own trap.
   *
   * This is development only — `next build` and `next start` ignore it entirely.
   */
  allowedDevOrigins: ['127.0.0.1', 'localhost', '192.168.1.104'],
  images: {
    /*
      Media is served from /api/media/file/** and normally referenced with a relative path, which is
      what localPatterns below allows. But once NEXT_PUBLIC_SITE_URL is configured, Payload returns
      ABSOLUTE urls for uploads (https://8br.gg/api/media/file/...), and an absolute url is a REMOTE
      one as far as the optimizer is concerned — localPatterns does not apply to it. With no
      remotePatterns declared the optimizer refuses the request outright, and every next/image brand
      asset renders as a broken image while the underlying file serves perfectly well on its own.

      That is exactly what happened on the first production deploy: the header logo and the homepage
      hero banner 400'd through /_next/image, while /api/media/file/8br-logo.png returned 200.

      So the site's own origin is declared here too. It is derived from NEXT_PUBLIC_SITE_URL rather
      than hardcoded, so staging and any future domain keep working without another edit.
    */
    remotePatterns: (() => {
      const raw = process.env.NEXT_PUBLIC_SITE_URL
      if (!raw) return []
      try {
        const url = new URL(raw)
        return [{
          protocol: url.protocol.replace(':', '') as 'http' | 'https',
          hostname: url.hostname,
          pathname: '/api/media/file/**',
        }]
      } catch {
        return []
      }
    })(),
    localPatterns: [
      {
        pathname: '/api/media/file/**',
      },
      {
        // 8BR static brand assets in /public (e.g. the homepage hero banner).
        pathname: '/8br-*',
      },
      {
        // Static brand assets in /public/assets/branding (header logo, homepage banner).
        pathname: '/assets/branding/**',
      },
    ],
  },
  webpack: (webpackConfig) => {
    webpackConfig.resolve.extensionAlias = {
      '.cjs': ['.cts', '.cjs'],
      '.js': ['.ts', '.tsx', '.js', '.jsx'],
      '.mjs': ['.mts', '.mjs'],
    }

    return webpackConfig
  },
  turbopack: {
    root: path.resolve(dirname),
  },
  async redirects() {
    return [
      /*
       * Legacy "Cups" URLs live under "Tournaments" again.
       *
       * These two lines are the ONLY place that mapping lives. It matters: the pair briefly existed
       * alongside route handlers under src/app/(frontend)/tournaments that redirected the other way,
       * the two pointed at each other, and every public URL bounced between them until the browser
       * gave up — /cups and /cups/12 were both unreachable. Those handlers are gone. If a
       * /cups/... route file is ever added back, this has to go, or the loop returns.
       *
       * :path* carries the rest of the path; Next preserves the query string on a redirect, which
       * matters here because the query string IS the view on these listings.
       */
      { source: '/cups', destination: '/tournaments', permanent: true },
      { source: '/cups/:path*', destination: '/tournaments/:path*', permanent: true },
      // Canonical host (www → apex) for cueverse.net.
      // Set SITE_WWW_HOST="www.cueverse.net" + SITE_APEX_ORIGIN="https://cueverse.net".
      ...(process.env.SITE_WWW_HOST && process.env.SITE_APEX_ORIGIN
        ? [
            {
              source: '/:path*',
              has: [{ type: 'host' as const, value: process.env.SITE_WWW_HOST }],
              destination: `${process.env.SITE_APEX_ORIGIN}/:path*`,
              permanent: true,
            },
          ]
        : []),
    ]
  },
}

export default withPayload(nextConfig, { devBundleServerPackages: false })
